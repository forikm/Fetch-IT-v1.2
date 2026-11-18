import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { confirmCustomerRide, RideConfirmationError } from "@/lib/ride-confirmations";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
import { timeBooking, withBookingTelemetry } from "@/lib/booking-telemetry";

async function post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await timeBooking("auth", requireCustomer);
    await limitRequests("customer:ride-confirmation", session.uid, 30, 60000);
    const body = await req.json().catch(() => null);
    const { id } = await params;
    const booking = await confirmCustomerRide(db, id, session, body?.action);
    return NextResponse.json({ booking: {
      id: booking.id, status: booking.status, updatedAt: booking.updatedAt,
      customerPickupConfirmedAt: booking.customerPickupConfirmedAt,
      customerDropoffConfirmedAt: booking.customerDropoffConfirmedAt,
    } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (error instanceof RideConfirmationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return customerErrorResponse(error);
  }
}
export const POST = withBookingTelemetry("ride_confirmation", withRequestLog("customer:ride-confirmation:POST", post));
