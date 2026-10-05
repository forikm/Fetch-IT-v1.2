"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { customerResponse } from "@/lib/customer-request";
import { markSupportRead } from "./support-center";
import { Bell } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useCustomerData } from "@/hooks/use-customer-data";
import { statusLabel } from "@/lib/constants";
import type { BookingNotification } from "@/lib/booking-notifications";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
type SupportNotification = { id: string; ticketId: string; title: string; detail: string; createdAt: string; read: boolean };

export function NotificationInbox({ onBooking }: { onBooking: (id: string, type: "DELIVERY" | "RIDE") => void }) {
  const id = useAppStore((state) => state.user?.id ?? "anonymous");
  const [items, save] = useCustomerData<BookingNotification[]>(id, "notification-inbox-v2", [], true);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [support, setSupport] = useState<SupportNotification[]>([]);
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);
  async function refresh(signal?: AbortSignal) {
    try { const data = await customerResponse<{ items: SupportNotification[] }>(await fetch("/api/support/notifications", { cache: "no-store", signal }), "Couldn’t load support notifications. Please retry.");
      if (!signal?.aborted) { setSupport(data.items); setError(""); }
    } catch (e) { if (!signal?.aborted) setError((e as Error).message); }
  }
  useVisiblePoll(id !== "anonymous" ? `${id}:support-notifications` : "", refresh, 30000);
  useEffect(() => {
    const changed = () => void refresh();
    window.addEventListener("fetchit:support-updated", changed);
    return () => window.removeEventListener("fetchit:support-updated", changed);
  }, [id]);
  const unread = items.filter((item) => !item.read).length + support.filter(item => !item.read).length;
  return <>
    <Button variant="outline" size="icon" className="relative h-9 w-9 shrink-0" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} onClick={() => { setOpen(true); void refresh(); }}>
      <Bell className="h-4 w-4" />
      {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground" aria-hidden>{unread > 99 ? "99+" : unread}</span>}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Notifications</DialogTitle><DialogDescription>Your booking updates and support replies. Support read status follows your account.</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error} <button className="underline" onClick={() => void refresh()}>Retry</button></p>}
      {(items.length > 0 || support.length > 0) && <Button variant="ghost" size="sm" disabled={!unread || marking} onClick={async () => {
        setMarking(true); save(previous => previous.map(item => ({ ...item, read: true })));
        try { await markSupportRead(support.filter(item => !item.read).map(item => item.id)); await refresh(); }
        catch (e) { setError((e as Error).message); } finally { setMarking(false); }
      }}>Mark all as read</Button>}
      {support.length > 0 && <section aria-label="Support replies"><h3 className="mb-2 text-sm font-semibold">Support replies</h3><ul className="divide-y">{support.map(item => <li key={item.id}><button type="button" className={`w-full rounded-lg p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!item.read ? "bg-primary/5" : ""}`} onClick={() => { setOpen(false); router.push(`/help?ticket=${encodeURIComponent(item.ticketId)}`); }}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{item.title}</span>{!item.read && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}</div><p className="mt-1 break-words text-sm">{item.detail}</p><time className="mt-1 block text-xs text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></button></li>)}</ul></section>}
      {items.length > 0 && <h3 className="text-sm font-semibold">Booking updates</h3>}
      {items.length ? <ul className="divide-y">{items.map((item) => <li key={item.id}><button type="button" className={`w-full min-w-0 p-3 text-left rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!item.read ? "bg-primary/5" : ""}`} onClick={() => {
        save((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry)); setOpen(false); onBooking(item.bookingId, item.type);
      }}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{statusLabel(item.status, item.type)}</span>{!item.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}</div><p className="mt-1 text-sm break-words">{item.address || item.refCode}</p><p className="mt-1 text-xs text-muted-foreground">{item.refCode} · {new Date(item.createdAt).toLocaleString()}</p></button></li>)}</ul> : !support.length && !error ? <div className="py-10 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-3 h-7 w-7" /><p>No notifications yet.</p><p className="mt-1">Booking updates and support replies will appear here.</p></div> : null}
    </DialogContent></Dialog>
  </>;
}
