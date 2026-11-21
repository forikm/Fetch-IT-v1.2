import { dispatchSelect } from '@/lib/matching-policy';
import { bookingView, riderSelect } from "@/lib/db-data";
import { NextRequest, NextResponse } from "next/server";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { bookingStatusWhere } from "@/lib/booking-status-query";
import { expireRiderOffers } from "@/lib/dispatch";
import { timeBooking, withBookingTelemetry } from "@/lib/booking-telemetry";
import { bookingAttemptId, bookingAttemptInclude } from "@/lib/booking-create";
import { omitTicket } from "@/lib/ticket";

function privateResult(data: unknown) {
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

async function readAttempt(customerId: string, id: string) {
  const where = { id, customerId };
  const booking = await db.booking.findUnique({ where, include: bookingAttemptInclude });
  if (booking) return privateResult({ booking: omitTicket(bookingView(booking)) });
  const draft = await db.checkoutDraft.findUnique({
    where,
    select: {
      expiresAt: true,
      booking: { include: bookingAttemptInclude },
      checkouts: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  });
  // Payment can finish between reading the booking and reading the checkout.
  if (draft?.booking) return privateResult({ booking: omitTicket(bookingView(draft.booking)) });
  if (draft && draft.expiresAt <= new Date()) return privateResult({ expired: true });
  const checkout = draft?.checkouts[0];
  return privateResult(checkout ? { checkoutUrl: `/checkout/${checkout.id}` } : { pending: true });
}

async function get(req: NextRequest) {
  try {
    const session = await timeBooking("auth", requireCustomer);
    const attemptId = bookingAttemptId(session.uid, req.headers.get("Idempotency-Key"));
    if (attemptId) return await timeBooking("db.booking_attempt_status", () => readAttempt(session.uid, attemptId));
    const ids = [...new Set((req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean))];
    if (ids.length > 100 || ids.some((id) => id.length > 100)) throw new CustomerError("Too many booking IDs.", 400);
    await timeBooking("db.expiry", () => expireRiderOffers(db));
    const onlyTracked = req.nextUrl.searchParams.get("onlyTracked") === "1";
    const bookings = await timeBooking("db.booking_status", () => db.booking.findMany({
      where: bookingStatusWhere(session.uid, ids, onlyTracked),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { dispatch: { select: dispatchSelect },
        id: true, refCode: true, type: true, status: true, updatedAt: true,
        createdAt: true, cancellationReason: true, scheduledAt: true, dropoffLabel: true, etaMinutes: true, riderId: true,
        customerPickupConfirmedAt: true, customerDropoffConfirmedAt: true,
        rider: { select: riderSelect },
        // Coordinates are needed only while the tracking dialog is open.
        ...(onlyTracked ? { liveLocation: { select: { lat: true, lng: true, createdAt: true } } } : {}),
      },
    }));
    return privateResult({ bookings: bookings.map(bookingView) });
  } catch (error) { return customerErrorResponse(error); }
}
export const GET = withBookingTelemetry("status", get);
