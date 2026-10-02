import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CustomerError, requireCustomer, customerErrorResponse } from "@/lib/customer-access";

export async function GET(request: NextRequest) {
  try {
    const session = await requireCustomer();
    const bookingId = request.nextUrl.searchParams.get("bookingId");
    const tickets = await db.supportTicket.findMany({ where: { customerId: session.uid, ...(bookingId ? { bookingId } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
    return NextResponse.json({ tickets });
  } catch (error) { return customerErrorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const session = await requireCustomer();
    const body = await request.json().catch(() => null);
    if (!body || typeof body.bookingId !== "string" || !["BOOKING", "FARE", "RIDER", "LOST_ITEM", "OTHER"].includes(body.category) || typeof body.message !== "string" || body.message.trim().length < 10 || body.message.length > 2000) throw new CustomerError("Choose a category and describe your issue in 10–2,000 characters.", 400);
    const booking = await db.booking.findFirst({ where: { id: body.bookingId, customerId: session.uid } });
    if (!booking) throw new CustomerError("Booking not found.", 404);
    const ticket = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
      const existing = await tx.supportTicket.findFirst({ where: { bookingId: booking.id, customerId: session.uid, status: { in: ["OPEN", "IN_PROGRESS"] }, category: body.category } });
      if (existing) throw new CustomerError("You already have an open request for this category. Check it above for updates.", 409);
      return tx.supportTicket.create({ data: { customerId: session.uid, bookingId: booking.id, category: body.category, message: body.message.trim() } });
    });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) { return customerErrorResponse(error); }
}
