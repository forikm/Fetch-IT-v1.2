import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { pickupEstimate } from "@/lib/pickup-eta";
import { pickupEvents, pickupProgress } from "@/lib/pickup-progress";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    const booking = await db.booking.findFirst({ where: { id: (await params).id, customerId: session.uid },
      select: { type: true, status: true, riderId: true, matchedAt: true, createdAt: true, vehicleClass: true, pickupLat: true, pickupLng: true, liveLocation: { select: { riderId: true, lat: true, lng: true, createdAt: true } }, events: pickupEvents } });
    if (!booking) throw new CustomerError("Booking not found.", 404);
    const progress = pickupProgress(booking);
    const estimate = progress?.stage === "HEADING" ? pickupEstimate({ ...booking, lat: booking.pickupLat, lng: booking.pickupLng }, booking.liveLocation) : null;
    return NextResponse.json({ pickupProgress: progress ? { ...progress, etaMinutes: estimate?.minutes ?? null, etaLocationAt: estimate?.locationAt ?? null } : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}
