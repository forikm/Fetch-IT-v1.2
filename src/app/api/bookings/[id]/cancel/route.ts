// POST /api/bookings/[id]/cancel
// Customer cancels a PENDING or MATCHED booking. Once the rider has picked
// up the cargo (PICKED_UP / IN_TRANSIT), cancellation is blocked.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }
    if (session.role === "CUSTOMER" && booking.customerId !== session.uid) {
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
    const updated = await db.booking.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    return NextResponse.json({ booking: updated });
  } catch (err) {
    console.error("[cancel] error", err);
    return NextResponse.json(
      { error: "Failed to cancel booking." },
      { status: 500 },
    );
  }
}
