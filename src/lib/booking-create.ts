import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { generateTicketId, type TicketType } from "./ticket";
import { generateRefCode } from "./fare";
import { riderSelect } from "./db-data";
import { CustomerError } from "./customer-access";

const include = { customer: { select: { id: true, name: true, phone: true } }, rider: { select: riderSelect } } as const;

// A customer-scoped deterministic primary key makes retries safe across servers
// without an additional table or a database migration. Old clients may omit it.
export function bookingAttemptId(customerId: string, key: string | null) {
  if (key === null) return undefined;
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new CustomerError("Invalid booking request. Refresh and try again.", 400);
  return `booking_${createHash("sha256").update(JSON.stringify([customerId, key])).digest("hex")}`;
}

type RequestDetails = {
  type?: unknown; pickup?: { label?: unknown; lat?: unknown; lng?: unknown };
  dropoff?: { label?: unknown; lat?: unknown; lng?: unknown }; vehicleClass?: unknown;
  cargoWeightKg?: unknown; passengers?: unknown; cargoNotes?: unknown; scheduledAt?: unknown; paymentMethod?: unknown;
};

export async function findBookingAttempt(db: PrismaClient, id: string | undefined, body: RequestDetails) {
  if (!id) return null;
  const booking = await db.booking.findUnique({ where: { id }, include });
  if (!booking) return null;
  const type = body.type ?? "DELIVERY";
  const scheduled = body.scheduledAt ? new Date(String(body.scheduledAt)).getTime() : null;
  if (booking.type !== type || booking.vehicleClass !== body.vehicleClass || booking.paymentMethod !== (body.paymentMethod ?? "CASH") ||
      booking.pickupLabel !== body.pickup?.label || booking.pickupLat !== body.pickup?.lat || booking.pickupLng !== body.pickup?.lng ||
      booking.dropoffLabel !== body.dropoff?.label || booking.dropoffLat !== body.dropoff?.lat || booking.dropoffLng !== body.dropoff?.lng ||
      booking.cargoWeightKg !== (type === "RIDE" ? 0 : Number(body.cargoWeightKg ?? 1)) ||
      booking.passengers !== (type === "RIDE" ? Number(body.passengers ?? 1) : 1) ||
      booking.cargoNotes !== (type === "RIDE" ? null : body.cargoNotes ?? null) ||
      (booking.scheduledAt?.getTime() ?? null) !== scheduled) {
    throw new CustomerError("This booking request was already used for different details. Start a new booking.", 409);
  }
  return booking;
}

export async function createBookingWithRetry(
  db: PrismaClient, type: TicketType, data: Omit<Prisma.BookingUncheckedCreateInput, "refCode" | "ticketId">, body: RequestDetails,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const booking = await db.$transaction(async tx => {
        const ticketId = await generateTicketId(tx, type);
        // Do not load related users while holding the shared counter row lock.
        return tx.booking.create({ data: { ...data, ticketId, refCode: generateRefCode(type === "RIDE" ? "RIDE" : "FIT") } });
      }, { maxWait: 10000, timeout: 15000 });
      // The create committed. A failed detail read can be recovered with the
      // same request key on the next explicit confirmation.
      return await db.booking.findUniqueOrThrow({ where: { id: booking.id }, include });
    } catch (error) {
      const previous = await findBookingAttempt(db, data.id, body);
      if (previous) return previous;
      const code = (error as { code?: string }).code;
      const target = (error as { meta?: { target?: unknown } }).meta?.target;
      const refCollision = code === "P2002" && Array.isArray(target) && target.includes("refCode");
      // Only retry rolled-back transactions or a reference collision. Never
      // automatically repeat an ambiguous write from an old client without a key.
      if (attempt >= 1 || (!refCollision && code !== "P2028" && code !== "P2034")) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 150));
    }
  }
}
