import type { Prisma } from "@prisma/client";
import { CustomerError } from "./customer-access";

type BookingInput = Omit<Prisma.BookingUncheckedCreateInput, "refCode" | "ticketId">;

export class RecentBookingError extends CustomerError {
  constructor(public existing: { bookingId?: string; checkoutId?: string; repeatOf: string }) {
    super("A matching request was already submitted from your account. Open it or confirm that you want another booking.", 409, "RECENT_BOOKING");
  }
}

export async function lockBookingSubmissions(tx: Prisma.TransactionClient, customerId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${customerId} FOR NO KEY UPDATE`;
}

export async function checkRecentBooking(tx: Prisma.TransactionClient, data: BookingInput, repeatOf?: string) {
  const recent = await tx.booking.findFirst({
    where: {
      customerId: data.customerId, id: { not: data.id }, status: { notIn: ["CANCELLED", "DELIVERED"] },
      createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
      type: data.type, vehicleClass: data.vehicleClass, paymentMethod: data.paymentMethod,
      pickupLabel: data.pickupLabel, pickupLat: data.pickupLat, pickupLng: data.pickupLng,
      dropoffLabel: data.dropoffLabel, dropoffLat: data.dropoffLat, dropoffLng: data.dropoffLng,
      scheduledAt: data.scheduledAt ?? null, cargoWeightKg: data.cargoWeightKg, cargoNotes: data.cargoNotes ?? null, passengers: data.passengers,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true },
  });
  if (recent && recent.id !== repeatOf) throw new RecentBookingError({ repeatOf: recent.id, bookingId: recent.id });
}
