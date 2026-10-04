import { recordBookingEvent } from "@/lib/booking-events";
import { bookingView } from "@/lib/db-data";
// POST /api/bookings/[id]/cancel
// Customer cancels a PENDING or MATCHED booking. Once the rider has picked
// up the cargo (PICKED_UP / IN_TRANSIT), cancellation is blocked.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { omitTicket } from "@/lib/ticket";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireCustomer();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }
    if (session.role !== "CUSTOMER" || booking.customerId !== session.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status)) {
      return NextResponse.json(
        {
          error:
            "Cannot cancel a booking after the package has been picked up.",
        },
        { status: 400 },
      );
    }
    const changed = await db.$transaction(async tx => {
      const changed = await tx.booking.updateMany({
        where: { id, customerId: session.uid, status: booking.status },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      if (changed.count) await recordBookingEvent(tx, id, session, { action: "CANCELLED", fromStatus: booking.status, toStatus: "CANCELLED", riderId: booking.riderId, reason: "Cancelled by customer" });
      return changed;
    });
    if (changed.count === 0) return NextResponse.json({ error: "Booking status changed. Refresh and try again." }, { status: 409 });
    const updated = await db.booking.findUnique({ where: { id } });
    if (!updated) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    return NextResponse.json({ booking: omitTicket(bookingView(updated)) });
  } catch (error) { return customerErrorResponse(error); }
}
