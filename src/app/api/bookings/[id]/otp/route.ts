import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { challengeHash, createChallenge, isPortableChallenge, readChallenge } from "@/lib/delivery-challenge";

// Codes belong to the booking, and are never included in general booking responses.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    const { id } = await params;
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
      const booking = await tx.booking.findFirst({ where: { id, customerId: session.uid } });
      if (!booking) throw new CustomerError("Booking not found.", 404);
      if (booking.type !== "RIDE" || booking.status !== "ACCEPTED" || !booking.riderId)
        throw new CustomerError("Pickup codes are only available for accepted rides before boarding.", 409);
      const now = new Date();
      let challenge = await tx.deliveryChallenge.findUnique({ where: { bookingId: id } });
      if (challenge?.verifiedAt) throw new CustomerError("This code has already been used.", 409);
      if (!challenge || challenge.expiresAt <= now) {
        const data = createChallenge(id, now);
        challenge = await tx.deliveryChallenge.upsert({ where: { bookingId: id },
          create: { bookingId: id, ...data }, update: { ...data, createdAt: now } });
      }
      if (challenge.attempts >= challenge.maxAttempts)
        throw new CustomerError("Too many incorrect attempts. Wait for the code to expire before requesting a new one.", 429);
      let otp: string;
      try { otp = readChallenge(id, challenge.codeCiphertext); }
      catch {
        // An encryption-key rotation must not leave a ride permanently stuck.
        const data = createChallenge(id, now);
        challenge = await tx.deliveryChallenge.update({ where: { bookingId: id }, data: { ...data, attempts: challenge.attempts, createdAt: now } });
        otp = readChallenge(id, challenge.codeCiphertext);
      }
      if (!isPortableChallenge(challenge.codeHash)) {
        // Upgrade the existing digits without resetting attempts or expiry.
        await tx.deliveryChallenge.update({ where: { bookingId: id }, data: { codeHash: challengeHash(id, otp) } });
      }
      return { otp, expiresAt: challenge.expiresAt };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}
