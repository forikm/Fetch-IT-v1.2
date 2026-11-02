import { withBookingTelemetry, timeBooking, bookingFailure } from "@/lib/booking-telemetry";
import { timedDatabase } from "@/lib/booking-transaction";
import { scheduleReceiptDelivery } from "@/lib/receipt-email";
import { NextRequest, NextResponse } from "next/server";
import { db as rawDb } from "@/lib/db";
const db = timedDatabase(rawDb);
import { requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { confirmCashPayment, dropoffReachedAt, PaymentError } from "@/lib/payments";
import { bookingView } from "@/lib/db-data";
import { omitTicket } from "@/lib/ticket";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
type Params = { params: Promise<{ id: string }> };
async function get(_req: NextRequest, { params }: Params) {
  try {
    const session = await timeBooking("auth", () => requireCustomer());
    const { id } = await params;
    const booking = await db.booking.findFirst({ where: { id, customerId: session.uid } });
    if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    if (booking.paymentStatus === "PAID") scheduleReceiptDelivery(db);
    return NextResponse.json({ booking: { ...omitTicket(bookingView(booking)), dropoffReachedAt: booking.type === "DELIVERY" && booking.paymentMethod === "CASH" ? await dropoffReachedAt(db, booking.id) : null } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}
async function post(req: NextRequest, { params }: Params) {
  try {
    const session = await timeBooking("auth", () => requireCustomer());
    await timeBooking("db.rate_limit", () => limitRequests("customer:payment", session.uid, 30, 60_000));
    const body = await req.json().catch(() => null);
    const { id } = await params;
    const booking = await confirmCashPayment(db, id, session, body?.amount);
    return NextResponse.json({ booking: { ...omitTicket(bookingView(booking)), dropoffReachedAt: booking.dropoffReachedAt } });
  } catch (error) {
    if (!(error instanceof PaymentError) && !(error instanceof RateLimitError)) bookingFailure("payment", error);
    if (error instanceof RateLimitError) throw error;
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return customerErrorResponse(error);
  }
}
export const GET = withBookingTelemetry("payment_read", withRequestLog("customer:payment:GET", get));
export const POST = withBookingTelemetry("cash_payment", withRequestLog("customer:payment:POST", post));
