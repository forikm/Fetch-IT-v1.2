import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { getRiderProfile } from "@/lib/rider-profile";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    const booking = await db.booking.findFirst({ where: { id: (await params).id, customerId: session.uid }, select: { riderId: true } });
    if (!booking?.riderId) throw new CustomerError("Assigned rider not found.", 404);
    const profile = await getRiderProfile(db, booking.riderId);
    if (!profile) throw new CustomerError("Rider profile unavailable.", 404);
    return NextResponse.json({ profile }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}
