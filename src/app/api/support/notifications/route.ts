import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CustomerError, requireCustomer, customerErrorResponse } from "@/lib/customer-access";

export async function GET() {
  try {
    const session = await requireCustomer();
    const messages = await db.supportMessage.findMany({ where: { authorRole: "ADMIN", ticket: { customerId: session.uid } },
      select: { id: true, ticketId: true, body: true, createdAt: true,
        ticket: { select: { category: true, customerReadAt: true, booking: { select: { refCode: true } } } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    });
    return NextResponse.json({ items: messages.map(m => ({ id: m.id, ticketId: m.ticketId, title: "Support replied",
      detail: `${m.ticket.booking?.refCode ?? "Account help"} · ${m.body.slice(0, 160)}`, createdAt: m.createdAt,
      read: !!m.ticket.customerReadAt && m.createdAt <= m.ticket.customerReadAt })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireCustomer();
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some((id: unknown) => typeof id !== "string"))
      throw new CustomerError("Choose valid notifications.", 400);
    const messages = await db.supportMessage.findMany({ where: { id: { in: body.ids }, authorRole: "ADMIN", ticket: { customerId: session.uid } },
      select: { ticketId: true, createdAt: true } });
    const latest = new Map<string, Date>();
    for (const m of messages) if (!latest.has(m.ticketId) || m.createdAt > latest.get(m.ticketId)!) latest.set(m.ticketId, m.createdAt);
    // Reading must not invalidate an admin's unsaved form or mark a later reply as read.
    await db.$transaction([...latest].map(([id, at]) => db.$executeRaw`
      UPDATE "SupportTicket" SET "customerReadAt" = ${at}
      WHERE "id" = ${id} AND "customerId" = ${session.uid}
      AND ("customerReadAt" IS NULL OR "customerReadAt" < ${at})`));
    return NextResponse.json({ ok: true });
  } catch (error) { return customerErrorResponse(error); }
}
