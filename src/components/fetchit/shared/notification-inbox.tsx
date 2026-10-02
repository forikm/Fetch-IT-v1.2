"use client";
import { useState } from "react";
import { Bell } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useCustomerData } from "@/hooks/use-customer-data";
import { statusLabel } from "@/lib/constants";
import type { BookingNotification } from "@/lib/booking-notifications";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function NotificationInbox({ onBooking }: { onBooking: (id: string, type: "DELIVERY" | "RIDE") => void }) {
  const id = useAppStore((state) => state.user?.id ?? "anonymous");
  const [items, save] = useCustomerData<BookingNotification[]>(id, "notification-inbox", [], true);
  const [open, setOpen] = useState(false);
  const unread = items.filter((item) => !item.read).length;
  return <>
    <Button variant="outline" size="icon" className="relative h-9 w-9 shrink-0" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} onClick={() => setOpen(true)}>
      <Bell className="h-4 w-4" />
      {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground" aria-hidden>{unread > 99 ? "99+" : unread}</span>}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Notifications</DialogTitle><DialogDescription>Your latest booking updates. Saved on this device.</DialogDescription></DialogHeader>
      {items.length > 0 && <Button variant="ghost" size="sm" disabled={!unread} onClick={() => save((previous) => previous.map((item) => ({ ...item, read: true })))}>Mark all as read</Button>}
      {items.length ? <ul className="divide-y">{items.map((item) => <li key={item.id}><button type="button" className={`w-full min-w-0 p-3 text-left rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!item.read ? "bg-primary/5" : ""}`} onClick={() => {
        save((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry)); setOpen(false); onBooking(item.bookingId, item.type);
      }}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{statusLabel(item.status, item.type)}</span>{!item.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}</div><p className="mt-1 text-sm break-words">{item.address || item.refCode}</p><p className="mt-1 text-xs text-muted-foreground">{item.refCode} · {new Date(item.createdAt).toLocaleString()}</p></button></li>)}</ul> : <div className="py-10 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-3 h-7 w-7" /><p>No notifications yet.</p><p className="mt-1">Booking updates will appear here.</p></div>}
    </DialogContent></Dialog>
  </>;
}
