import type { BookingNotification } from "./booking-notifications";
import { statusLabel } from "./constants";
export const NOTIFICATION_CATEGORIES = ["DELIVERY", "RIDE", "SUPPORT"] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export const NOTIFICATION_LABELS: Record<NotificationCategory, string> = { DELIVERY: "Deliveries", RIDE: "Rides", SUPPORT: "Support" };
export type InboxItem = { id: string; sourceId?: string; category: NotificationCategory; bookingId?: string | null; ticketId?: string | null;
  status?: string | null; title: string; body: string; createdAt: string; read: boolean; legacy?: "booking" | "support" };
export type InboxPage = { items: InboxItem[]; unread: Record<NotificationCategory, number> };
export type SupportInboxItem = { id: string; ticketId: string; title: string; detail: string; createdAt: string; read: boolean };
export function combineInbox(page: InboxPage, bookings: BookingNotification[], replies: SupportInboxItem[]) {
  const sources = new Set(page.items.map(item => item.sourceId));
  const existingBookings = new Set(page.items.map(item => `${item.bookingId}:${item.status}`));
  const legacy: InboxItem[] = [
    ...bookings.filter(item => !existingBookings.has(`${item.bookingId}:${item.status}`)).map(item => ({
      ...item, category: item.type, title: statusLabel(item.status, item.type), body: item.refCode, legacy: "booking" as const,
    })),
    ...replies.filter(item => !sources.has(`support:${item.id}`)).map(item => ({
      ...item, category: "SUPPORT" as const, body: item.detail, legacy: "support" as const,
    })),
  ];
  return { items: [...page.items, ...legacy].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    unread: Object.fromEntries(NOTIFICATION_CATEGORIES.map(category => [category, page.unread[category] + legacy.filter(item => item.category === category && !item.read).length])) as InboxPage["unread"],
  };
}
