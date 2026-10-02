import type { BookingStatus } from "./constants";

export type BookingNotification = { id: string; bookingId: string; refCode: string; type: "DELIVERY" | "RIDE"; status: BookingStatus; address: string; createdAt: string; read: boolean };
export type NotificationBooking = { id: string; refCode: string; type: "DELIVERY" | "RIDE"; status: BookingStatus; dropoffLabel?: string; updatedAt?: string };

export function createBookingNotifications(bookings: NotificationBooking[], previous: Record<string, BookingStatus> | null, now: string): BookingNotification[] {
  if (!previous) return [];
  return bookings.filter((booking) => previous[booking.id] !== booking.status).map((booking) => ({
    id: `${booking.id}:${booking.status}:${booking.updatedAt ?? now}`,
    bookingId: booking.id, refCode: booking.refCode, type: booking.type, status: booking.status,
    address: booking.dropoffLabel ?? "", createdAt: now, read: false,
  }));
}

export function mergeBookingNotifications(current: BookingNotification[], incoming: BookingNotification[]) {
  const known = new Set(current.map((item) => item.id));
  return [...incoming.filter((item) => !known.has(item.id)), ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}
