import type { PrismaClient } from "@prisma/client";
import { bookingTransaction } from "./booking-transaction";
import { recordBookingEvent } from "./booking-events";
import type { RideConfirmationAction } from "./ride-confirmation-policy";

export class RideConfirmationError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function confirmCustomerRide(db: PrismaClient, bookingId: string,
  actor: { uid: string; name: string; role: string }, action: unknown) {
  if (actor.role !== "CUSTOMER") throw new RideConfirmationError("Customer access required.", 403);
  if (action !== "PICKUP" && action !== "DROPOFF") throw new RideConfirmationError("Choose pickup or drop-off confirmation.", 400);
  return bookingTransaction(db, async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.customerId !== actor.uid) throw new RideConfirmationError("Ride booking not found.", 404);
    if (booking.type !== "RIDE" || !booking.riderId) throw new RideConfirmationError("This confirmation is available for an assigned ride.");
    if (booking.status === "CANCELLED") throw new RideConfirmationError("This ride was cancelled.");
    const field = action === "PICKUP" ? "customerPickupConfirmedAt" : "customerDropoffConfirmedAt";
    // A retry after a lost response cannot change the original timestamp or add an audit event.
    if (booking[field]) return booking;
    if (action === "PICKUP" && (!["PICKED_UP", "IN_TRANSIT"].includes(booking.status) || !booking.pickedUpAt))
      throw new RideConfirmationError("Wait for your driver to verify your pickup code, then confirm when you’re on board.");
    if (action === "DROPOFF" && (booking.status !== "IN_TRANSIT" || !booking.customerPickupConfirmedAt))
      throw new RideConfirmationError("Confirm pickup first. You can confirm drop-off once your trip is in progress and you’ve arrived.");
    const now = new Date();
    const updated = await tx.booking.update({ where: { id: bookingId }, data: { [field]: now, updatedAt: now } });
    await recordBookingEvent(tx, bookingId, { ...actor, role: "CUSTOMER" }, {
      action: `CUSTOMER_${action as RideConfirmationAction}_CONFIRMED`, fromStatus: booking.status,
      toStatus: booking.status, riderId: booking.riderId,
      reason: action === "PICKUP" ? "Customer confirmed they are on board." : "Customer confirmed arrival at drop-off.",
    });
    return updated;
  });
}
