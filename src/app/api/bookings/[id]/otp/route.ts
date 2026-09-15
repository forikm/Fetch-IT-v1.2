// GET  /api/bookings/[id]/otp
// Returns the OTP for this booking. The customer retrieves this code and
// verbally shares it with the rider; the rider submits it via /proof to
// complete the e-POD. Stored on the booking row (added as a derived field
// — we persist it lazily on first request to avoid schema changes).
//
// To keep this self-contained without another model, we store the OTP
// inside DeliveryProof with proofType='OTP' (the FIRST such row for a
// booking is the canonical OTP). If none exists yet, we create one.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { generateOtp } from "@/lib/fare";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (
    (session.role === "CUSTOMER" && booking.customerId !== session.uid) ||
    (session.role === "RIDER" && booking.riderId !== session.uid)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let proof = await db.deliveryProof.findFirst({
    where: { bookingId: id, proofType: "OTP" },
  });
  if (!proof) {
    proof = await db.deliveryProof.create({
      data: {
        bookingId: id,
        riderId: booking.riderId ?? session.uid,
        proofType: "OTP",
        otpCode: generateOtp(),
      },
    });
  }

  return NextResponse.json({ otp: proof.otpCode });
}
