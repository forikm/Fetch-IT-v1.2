import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CustomerError, requireCustomer, customerErrorResponse } from "@/lib/customer-access";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const session = await requireCustomer();
    const { id } = await params;
    const booking = await db.booking.findFirst({ where: { id, customerId: session.uid } });
    if (!booking) throw new CustomerError("Booking not found.", 404);
    return NextResponse.json({ review: await db.customerReview.findUnique({ where: { bookingId: id } }) });
  } catch (error) { return customerErrorResponse(error); }
}
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await requireCustomer();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 || (body.comment != null && (typeof body.comment !== "string" || body.comment.length > 1000))) throw new CustomerError("Choose 1–5 stars and a comment of up to 1,000 characters.", 400);
    const review = await db.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({ where: { id, customerId: session.uid } });
      if (!booking) throw new CustomerError("Booking not found.", 404);
      if (booking.status !== "DELIVERED" || !booking.riderId) throw new CustomerError("You can rate a rider after your booking is completed.", 400);
      // Serialize reviews per rider so simultaneous ratings cannot overwrite the average.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${booking.riderId} FOR UPDATE`;
      if (await tx.customerReview.findUnique({ where: { bookingId: id } })) throw new CustomerError("You already reviewed this booking.", 409);
      const saved = await tx.customerReview.create({ data: { bookingId: id, customerId: session.uid, riderId: booking.riderId, rating: body.rating, comment: body.comment?.trim() || null } });
      const average = await tx.customerReview.aggregate({ where: { riderId: booking.riderId }, _avg: { rating: true } });
      await tx.riderProfile.update({ where: { userId: booking.riderId }, data: { rating: average._avg.rating ?? body.rating } });
      return saved;
    });
    return NextResponse.json({ review }, { status: 201 });
  } catch (error) { return customerErrorResponse(error); }
}
