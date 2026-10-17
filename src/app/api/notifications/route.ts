import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { schedulePushDelivery } from "@/lib/push-delivery";

const categories = ["DELIVERY", "RIDE", "SUPPORT"] as const;
type Category = typeof categories[number];
export async function GET() {
  try {
    const session = await requireCustomer();
    const [pages, counts] = await Promise.all([
      Promise.all(categories.map(category => db.customerNotification.findMany({ where: { customerId: session.uid, category },
        select: { id: true, sourceId: true, category: true, bookingId: true, ticketId: true, status: true, title: true, body: true, url: true, createdAt: true, readAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }))),
      db.customerNotification.groupBy({ by: ["category"], where: { customerId: session.uid, readAt: null }, _count: { _all: true } }),
    ]);
    const unread = Object.fromEntries(categories.map(category => [category, counts.find(count => count.category === category)?._count._all ?? 0]));
    schedulePushDelivery();
    return NextResponse.json({ items: pages.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(({ readAt, ...item }) => ({ ...item, read: !!readAt })), unread }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireCustomer();
    const body = await request.json().catch(() => null);
    if (!body || (body.category !== undefined && !categories.includes(body.category)) ||
      (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some((id: unknown) => typeof id !== "string" || id.length > 100))) ||
      (body.category === undefined && body.ids === undefined)) throw new CustomerError("Choose valid notifications.", 400);
    const where = { customerId: session.uid, readAt: null,
      ...(body.category ? { category: body.category as Category } : {}), ...(body.ids ? { id: { in: body.ids as string[] } } : {}),
    };
    await db.$transaction(async tx => {
      const selected = await tx.customerNotification.findMany({ where, select: { id: true, ticketId: true, createdAt: true } });
      const latest = new Map<string, Date>();
      for (const item of selected) if (item.ticketId && (!latest.has(item.ticketId) || item.createdAt > latest.get(item.ticketId)!)) latest.set(item.ticketId, item.createdAt);
      for (const [id, at] of latest) {
        await tx.$executeRaw`UPDATE "SupportTicket" SET "customerReadAt" = ${at}
          WHERE "id" = ${id} AND "customerId" = ${session.uid} AND ("customerReadAt" IS NULL OR "customerReadAt" < ${at})`;
        await tx.customerNotification.updateMany({ where: { customerId: session.uid, ticketId: id, createdAt: { lte: at }, readAt: null }, data: { readAt: new Date() } });
      }
      await tx.customerNotification.updateMany({ where: { customerId: session.uid, id: { in: selected.map(item => item.id) } }, data: { readAt: new Date() } });
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}
