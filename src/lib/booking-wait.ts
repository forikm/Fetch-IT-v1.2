import type { BookingStatus, BookingType } from "./constants";

export const LONG_BOOKING_WAIT_MS = 3 * 60_000;
export type WaitingBooking = { id: string; type: BookingType; status: BookingStatus; createdAt: string; scheduledAt?: string | null };

export function isAwaitingAcceptance(status: string) {
  return status === "PENDING" || status === "MATCHED";
}

/** Time without acceptance is not evidence that the entire driver pool is unavailable. */
export function bookingWaitFeedback(booking: WaitingBooking, now: number) {
  if (!isAwaitingAcceptance(booking.status)) return null;
  const person = booking.type === "RIDE" ? "driver" : "rider";
  const scheduled = Date.parse(booking.scheduledAt ?? "");
  const created = Date.parse(booking.createdAt);
  if (booking.status === "PENDING" && Number.isFinite(scheduled) && scheduled > now) {
    return { kind: "scheduled", title: "Pickup is scheduled", message: "A " + person + " can accept this booking when pickup is due.", wait: null };
  }
  const start = Math.max(Number.isFinite(created) ? created : now, Number.isFinite(scheduled) ? scheduled : 0);
  const elapsed = Math.max(0, now - start);
  const minutes = Math.floor(elapsed / 60_000);
  const wait = minutes < 1 ? "Waiting less than a minute" : "Waiting " + minutes + (minutes === 1 ? " minute" : " minutes");
  if (booking.status === "MATCHED") return {
    kind: "offered", title: "Waiting for " + person + " confirmation",
    message: "An offer has been sent. Your " + person + " has not accepted yet. If there’s no reply before the offer expires, another " + person + " can accept.", wait,
  };
  return elapsed >= LONG_BOOKING_WAIT_MS ? {
    kind: "long", title: "No " + person + " has accepted yet",
    message: "You’ve been waiting a few minutes. Your request remains open for a " + person + " to accept.", wait,
  } : {
    kind: "waiting", title: "Waiting for a " + person,
    message: "Your request is open. We’ll update this booking when a " + person + " accepts.", wait,
  };
}

/** A late check must not undo a newer acceptance or cancellation. */
export function mergeBookingUpdate<T extends { updatedAt?: string }>(current: T, update: Partial<T>): T {
  const previous = Date.parse(current.updatedAt ?? "");
  const incoming = Date.parse(update.updatedAt ?? "");
  return Number.isFinite(previous) && Number.isFinite(incoming) && incoming < previous ? current : { ...current, ...update };
}
