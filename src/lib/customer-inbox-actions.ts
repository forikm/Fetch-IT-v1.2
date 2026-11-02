import type { Prisma, PrismaClient } from "@prisma/client";
import type { NotificationCategory, SupportInboxItem } from "./notification-inbox";

type InboxDb = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
export type InboxSelection = { ids?: string[]; supportIds?: string[]; category?: NotificationCategory; before: Date; dismiss: boolean };

// Old replies without an event-backed notification remain visible. Existing
// sources (including dismissed ones) must never reappear through this fallback.
export async function legacySupportInbox(db: InboxDb, customerId: string, before = new Date()) {
  return db.$queryRaw<SupportInboxItem[]>`
    SELECT m."id", m."ticketId", 'Support replied' AS "title",
      COALESCE(b."refCode", 'Account help') || ' · ' || LEFT(m."body", 160) AS "detail",
      m."createdAt", COALESCE(m."createdAt" <= t."customerReadAt", FALSE) AS "read"
    FROM "SupportMessage" m JOIN "SupportTicket" t ON t."id" = m."ticketId"
    LEFT JOIN "Booking" b ON b."id" = t."bookingId"
    WHERE t."customerId" = ${customerId} AND m."createdAt" <= ${before} AND m."authorRole"::text IN ('ADMIN','SUPPORT','SUPPORT_SUPERVISOR','SUPERADMIN')
      AND NOT EXISTS (SELECT 1 FROM "CustomerNotification" n WHERE n."sourceId" = 'support:' || m."id")
    ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 100`;
}

async function applySelection(db: InboxDb, customerId: string, selection: InboxSelection) {
  const sources = (selection.supportIds ?? []).map(id => `support:${id}`);
  // One set-based statement replaces a read, per-ticket loops and a trailing
  // notification update. Both tables commit together; later replies stay unread.
  await db.$executeRaw`
    WITH selected AS MATERIALIZED (
      SELECT n."id", n."ticketId", n."createdAt" FROM "CustomerNotification" n
      WHERE n."customerId" = ${customerId} AND n."dismissedAt" IS NULL
        AND n."createdAt" <= ${selection.before}
        AND (${selection.dismiss} OR n."readAt" IS NULL)
        AND (n."id" = ANY(${selection.ids ?? []}::text[]) OR n."sourceId" = ANY(${sources}::text[])
          OR (${selection.category ?? null}::text IS NOT NULL AND n."category"::text = ${selection.category ?? null}))
    ), latest AS (
      SELECT "ticketId", MAX("createdAt") AS at FROM selected WHERE "ticketId" IS NOT NULL GROUP BY "ticketId"
    ), tickets AS (
      UPDATE "SupportTicket" t SET "customerReadAt" = latest.at FROM latest
      WHERE t."id" = latest."ticketId" AND t."customerId" = ${customerId}
        AND (t."customerReadAt" IS NULL OR t."customerReadAt" < latest.at)
    )
    UPDATE "CustomerNotification" n SET "readAt" = COALESCE(n."readAt", CURRENT_TIMESTAMP),
      "dismissedAt" = CASE WHEN ${selection.dismiss} THEN CURRENT_TIMESTAMP ELSE n."dismissedAt" END,
      "pushDeliveredAt" = CASE WHEN ${selection.dismiss} THEN COALESCE(n."pushDeliveredAt", CURRENT_TIMESTAMP) ELSE n."pushDeliveredAt" END
    WHERE n."customerId" = ${customerId} AND (n."id" IN (SELECT "id" FROM selected)
      OR (NOT ${selection.dismiss} AND n."readAt" IS NULL AND EXISTS (
        SELECT 1 FROM latest WHERE latest."ticketId" = n."ticketId" AND n."createdAt" <= latest.at)))`;
}

export async function updateCustomerInbox(db: PrismaClient, customerId: string, selection: InboxSelection) {
  if (!selection.supportIds?.length) return applySelection(db, customerId, selection);
  // A legacy reply needs a durable source row so dismissal also survives on
  // another device. Suppress push for this historical backfill.
  return db.$transaction(async tx => {
    await tx.$executeRaw`
      INSERT INTO "CustomerNotification" ("id", "sourceId", "customerId", "category", "ticketId", "title", "body", "url", "createdAt", "pushDeliveredAt")
      SELECT 'legacy_support_' || m."id", 'support:' || m."id", t."customerId", 'SUPPORT', m."ticketId", 'Support replied',
        LEFT(m."body", 160), '/help?ticket=' || m."ticketId", m."createdAt", CURRENT_TIMESTAMP
      FROM "SupportMessage" m JOIN "SupportTicket" t ON t."id" = m."ticketId"
      WHERE t."customerId" = ${customerId} AND m."id" = ANY(${selection.supportIds}::text[])
        AND m."authorRole"::text IN ('ADMIN','SUPPORT','SUPPORT_SUPERVISOR','SUPERADMIN')
      ON CONFLICT ("sourceId") DO NOTHING`;
    await applySelection(tx, customerId, selection);
  });
}
