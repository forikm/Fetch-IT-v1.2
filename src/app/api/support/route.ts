import { withRequestLog, RateLimitError } from "@/lib/request-guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CustomerError, requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { supportInput } from "@/lib/support-input";

async function handleGET(request: NextRequest) {
  try {
    const session = await requireCustomer();
    const bookingId = request.nextUrl.searchParams.get("bookingId");
    const cursor = request.nextUrl.searchParams.get("cursor");
    const where = { customerId: session.uid, ...(bookingId ? { bookingId } : {}) };
    if (cursor && !await db.supportTicket.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))
      throw new CustomerError("Request not found.", 404);
    const tickets = await db.supportTicket.findMany({ where,
      include: { booking: { select: { refCode: true } }, messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return NextResponse.json({ tickets: tickets.slice(0, 20).map(({ messages, ...ticket }) => ({ ...ticket,
      preview: messages[0]?.body ?? ticket.message,
      unread: !!ticket.lastAdminReplyAt && (!ticket.customerReadAt || ticket.lastAdminReplyAt > ticket.customerReadAt),
    })), nextCursor: tickets.length > 20 ? tickets[19].id : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return customerErrorResponse(error);
  }
}
async function handlePOST(request: NextRequest) {
  try {
    const session = await requireCustomer();
    let input: ReturnType<typeof supportInput>;
    try { input = supportInput(await request.json().catch(() => null)); }
    catch (error) {
      throw new CustomerError((error as Error).message, 400);
    }
    const ticket = await db.$transaction(async (tx) => {
      // Serializes duplicate submissions, including general requests without a booking.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.uid} FOR UPDATE`;
      const booking = input.bookingId ? await tx.booking.findFirst({ where: { id: input.bookingId, customerId: session.uid }, select: { status: true } }) : null;
      if (input.bookingId && !booking) throw new CustomerError("Booking not found.", 404);
      const existing = await tx.supportTicket.findFirst({ where: { bookingId: input.bookingId, customerId: session.uid,
        status: { in: ["OPEN", "IN_PROGRESS"] }, category: input.category } });
      if (existing) throw new CustomerError("You already have an open request for this issue. Open it in your requests to add a reply.", 409);
      return tx.supportTicket.create({ data: { customerId: session.uid, ...input,
        priority: booking && !["DELIVERED", "CANCELLED"].includes(booking.status) ? "HIGH" : "NORMAL" } });
    });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return customerErrorResponse(error);
  }
}

export const GET = withRequestLog("customer:support:GET", handleGET);
export const POST = withRequestLog("customer:support:POST", handlePOST);
