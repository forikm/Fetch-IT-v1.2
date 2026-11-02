import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { schedulePushDelivery } from "@/lib/push-delivery";
import { legacySupportInbox, updateCustomerInbox } from "@/lib/customer-inbox-actions";

const categories = ["DELIVERY", "RIDE", "SUPPORT"] as const;
type Category = typeof categories[number];
export async function GET() {
  try {
    const session = await requireCustomer();
    const asOf = new Date();
    const [pages, counts, support] = await Promise.all([
      Promise.all(categories.map(category => db.customerNotification.findMany({ where: { customerId: session.uid, category, createdAt: { lte: asOf } },
        select: { id: true, sourceId: true, category: true, bookingId: true, ticketId: true, status: true, title: true, body: true, url: true, createdAt: true, readAt: true, dismissedAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }))),
      db.customerNotification.groupBy({ by: ["category"], where: { customerId: session.uid, readAt: null, dismissedAt: null, createdAt: { lte: asOf } }, _count: { _all: true } }),
      legacySupportInbox(db, session.uid, asOf),
    ]);
    const unread = Object.fromEntries(categories.map(category => [category, counts.find(count => count.category === category)?._count._all ?? 0]));
    schedulePushDelivery();
    return NextResponse.json({ items: pages.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(({ readAt, dismissedAt, ...item }) => ({ ...item, read: !!readAt, dismissed: !!dismissedAt })), unread, support, asOf }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireCustomer();
    const body = await request.json().catch(() => null);
    const validIds = (ids: unknown) => Array.isArray(ids) && ids.length <= 100 && ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 100);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      (body.action !== undefined && !["read", "dismiss"].includes(body.action)) ||
      (body.category !== undefined && !categories.includes(body.category)) ||
      (body.ids !== undefined && !validIds(body.ids)) || (body.supportIds !== undefined && !validIds(body.supportIds)) ||
      (body.category === undefined && body.ids === undefined && body.supportIds === undefined) ||
      (body.action === "dismiss" && body.category !== undefined)) throw new CustomerError("Choose valid notifications.", 400);
    const before = body.before === undefined ? new Date() : new Date(body.before);
    if ((body.before !== undefined && typeof body.before !== "string") || !Number.isFinite(before.getTime())) throw new CustomerError("Choose valid notifications.", 400);
    await updateCustomerInbox(db, session.uid, { ids: body.ids, supportIds: body.supportIds, category: body.category as Category | undefined,
      before: new Date(Math.min(before.getTime(), Date.now())), dismiss: body.action === "dismiss" });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}
