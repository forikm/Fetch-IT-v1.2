import { bookingView, riderSelect } from "@/lib/db-data";
import { NextRequest, NextResponse } from "next/server";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { bookingStatusWhere } from "@/lib/booking-status-query";
import { expireRiderOffers } from "@/lib/dispatch";

export async function GET(req: NextRequest) {
  try {
    const session = await requireCustomer();
    const ids = [...new Set((req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean))];
    if (ids.length > 100 || ids.some((id) => id.length > 100)) throw new CustomerError("Too many booking IDs.", 400);
    await expireRiderOffers(db);
    const onlyTracked = req.nextUrl.searchParams.get("onlyTracked") === "1";
    const bookings = await db.booking.findMany({
      where: bookingStatusWhere(session.uid, ids, onlyTracked),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true, refCode: true, type: true, status: true, updatedAt: true,
        createdAt: true, dropoffLabel: true, etaMinutes: true, riderId: true,
        rider: { select: riderSelect },
        // Coordinates are needed only while the tracking dialog is open.
        ...(onlyTracked ? { liveLocation: { select: { lat: true, lng: true, createdAt: true } } } : {}),
      },
    });
    return NextResponse.json({ bookings: bookings.map(bookingView) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}
