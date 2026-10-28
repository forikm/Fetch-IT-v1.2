import { buildBookingReceipt } from "@/lib/booking-receipt";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    const { id } = await params;
    const booking = await db.booking.findFirst({ where: { id, customerId: session.uid }, include: { customer: { select: { name: true } }, rider: { select: { name: true } } } });
    if (!booking) throw new CustomerError("Booking not found.", 404);
    if (booking.paymentStatus !== "PAID") throw new CustomerError("Receipts are available after payment is confirmed.", 409);
    const receipt = await buildBookingReceipt(booking, booking.paidAt ?? new Date());
    return new NextResponse(Buffer.from(receipt), { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="fetchit-${booking.refCode.replace(/[^a-zA-Z0-9-]/g, "")}.pdf"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return customerErrorResponse(error); }
}
