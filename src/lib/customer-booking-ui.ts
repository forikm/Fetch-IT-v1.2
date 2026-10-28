import type { BookingStatus, BookingType } from "./constants";

const stageIndex: Record<BookingStatus, number> = {
  PENDING: 0, MATCHED: 0, ACCEPTED: 1, PICKED_UP: 2, IN_TRANSIT: 2, DELIVERED: 3, CANCELLED: -1,
};

/** Customer presentation only: matching and transit remain distinct backend states. */
export function customerProgress(status: BookingStatus, type: BookingType, scheduled = false) {
  const ride = type === "RIDE";
  const stages = ["Booked", "Accepted", "Picked up", ride ? "Arrived" : "Delivered"];
  const current = stageIndex[status];
  const messages: Record<BookingStatus, string> = {
    PENDING: scheduled
      ? `Your ${ride ? "ride" : "delivery"} is scheduled. We’ll find a ${ride ? "driver" : "rider"} when pickup is due.`
      : `Waiting for a ${ride ? "driver" : "rider"} to accept your booking.`,
    MATCHED: `A ${ride ? "driver" : "rider"} has been assigned. Waiting for acceptance.`,
    ACCEPTED: ride ? "Your driver is on the way to your pickup." : "Your rider is on the way to collect your package.",
    PICKED_UP: ride ? "You’re on board. Your trip has started." : "Your package has been picked up.",
    IN_TRANSIT: ride ? "You’re on the way to your drop-off." : "Your package is on the way to drop-off.",
    DELIVERED: ride ? "You’ve arrived at your drop-off." : "Your package has been delivered.",
    CANCELLED: `Your ${ride ? "ride" : "delivery"} was cancelled.`,
  };
  return { stages, current, label: current < 0 ? "Cancelled" : stages[current], message: messages[status] };
}

export function customerStatusLabel(status: BookingStatus, type: BookingType = "DELIVERY") {
  return customerProgress(status, type).label;
}

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatPeso(amount: number) { return peso.format(amount); }

/** The existing quote is route duration, not the rider's time to reach pickup. */
export function routeTimeLabel(type: BookingType) { return type === "RIDE" ? "Est. trip duration" : "Est. delivery duration"; }

export function locationUpdateLabel(at: string, now = Date.now(), type: BookingType = "DELIVERY") {
  const person = type === "RIDE" ? "Driver" : "Rider";
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) return `${person} location update unavailable`;
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return `${person} location updated just now`;
  if (minutes < 60) return `${person} location updated ${minutes} min ago`;
  return `${person} location updated ${new Date(timestamp).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (PH time)`;
}
