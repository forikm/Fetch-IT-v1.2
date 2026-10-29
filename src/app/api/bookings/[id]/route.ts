import { bookingView, riderSelect } from "@/lib/db-data";
import { deliveryPhotoUrl } from "@/lib/epod-photo";
// /api/bookings/[id]
// GET — fetch a single booking (with customer / rider / proofs / latest tracking).
// NOTE: this is the CUSTOMER app. Riders claim and progress jobs from the
// separate Fetch-It Rider app (PATCH lives there).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { omitTicket } from "@/lib/ticket";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  let session;
  try { session = await requireCustomer(); }
  catch (error) { return customerErrorResponse(error); }
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      rider: { select: riderSelect },
      liveLocation: { select: { lat: true, lng: true, createdAt: true } },
      deliveryProofs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (
    session.role === "CUSTOMER" &&
    booking.customerId !== session.uid
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.role === "RIDER" && booking.riderId !== session.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const view = omitTicket(bookingView(booking));
  // Only this authenticated owner's completed delivery exposes photo references.
  // Never send private Blob paths or historical inline image data to the client.
  const deliveryProofs = booking.type === "DELIVERY" && booking.status === "DELIVERED"
    ? booking.deliveryProofs.map(proof => proof.proofType === "PHOTO"
      ? { ...proof, photoUrl: proof.photoUrl ? deliveryPhotoUrl(booking.id, proof.id) : null }
      : proof)
    : view.deliveryProofs;
  return NextResponse.json({ booking: { ...view, deliveryProofs } }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
