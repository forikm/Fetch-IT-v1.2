import type { Prisma } from "@prisma/client";
import { CustomerError } from "./customer-access";

export function requiredBookingRating(db: Pick<Prisma.TransactionClient, "booking">, customerId: string) {
  return db.booking.findFirst({
    where: { customerId, status: "DELIVERED", riderId: { not: null }, review: { is: null } },
    orderBy: [{ deliveredAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, refCode: true, type: true },
  });
}

export async function requireCompletedBookingRatings(db: Pick<Prisma.TransactionClient, "booking">, customerId: string) {
  if (await requiredBookingRating(db, customerId)) {
    throw new CustomerError("Rate your completed bookings before making a new booking.", 409, "RATING_REQUIRED");
  }
}
