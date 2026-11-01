import type { PrismaClient } from "@prisma/client";
import { CustomerError } from "./customer-access";

export function sosLocation(value: unknown, now = Date.now()) {
  const fix = value as { lat?: number; lng?: number; accuracy?: number; capturedAt?: number } | null;
  if (!fix || typeof fix.lat !== "number" || !Number.isFinite(fix.lat) || Math.abs(fix.lat) > 90 ||
      typeof fix.lng !== "number" || !Number.isFinite(fix.lng) || Math.abs(fix.lng) > 180 ||
      typeof fix.accuracy !== "number" || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 10000 ||
      typeof fix.capturedAt !== "number" || !Number.isFinite(fix.capturedAt) || now - fix.capturedAt > 60000 || fix.capturedAt > now + 5000)
    throw new CustomerError("A fresh device location is required. Allow location access and retry SOS.", 400);
  return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, capturedAt: fix.capturedAt };
}
export async function sendRideSos(db: PrismaClient, bookingId: string, customerId: string, value: unknown) {
  const fix = sosLocation(value);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findFirst({ where: { id: bookingId, customerId } });
    if (!booking) throw new CustomerError("Booking not found.", 404);
    if (booking.type !== "RIDE" || !["ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(booking.status))
      throw new CustomerError("SOS is available only for an active passenger ride.", 409);
    const existing = await tx.supportTicket.findFirst({ where: { bookingId, customerId, priority: "URGENT", message: { startsWith: "SOS EMERGENCY ALERT\n" }, status: { in: ["OPEN", "IN_PROGRESS"] } } });
    if (existing) return { id: existing.id, createdAt: existing.createdAt };
    const message = `SOS EMERGENCY ALERT\nPassenger requested urgent staff review.\nGPS: ${fix.lat}, ${fix.lng}\nAccuracy: ${Math.round(fix.accuracy)} m\nCaptured: ${new Date(fix.capturedAt).toISOString()}`;
    const ticket = await tx.supportTicket.create({ data: { bookingId, customerId, category: "RIDER", priority: "URGENT", message } });
    return { id: ticket.id, createdAt: ticket.createdAt };
  });
}
