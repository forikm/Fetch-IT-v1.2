"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Package, Bike, MessageCircle } from "lucide-react";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { customerResponse } from "@/lib/customer-request";
import { useAppStore } from "@/lib/store";
import { useCustomerData } from "@/hooks/use-customer-data";
import type { BookingNotification } from "@/lib/booking-notifications";
import { combineInbox, NOTIFICATION_CATEGORIES, NOTIFICATION_LABELS, type InboxItem, type InboxPage, type NotificationCategory, type SupportInboxItem } from "@/lib/notification-inbox";
import { ensureCustomerPush, setPushAccount } from "@/lib/customer-push";
import { markSupportRead } from "./support-center";
import { NotificationSettings } from "./notification-settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
const empty: InboxPage = { items: [], unread: { DELIVERY: 0, RIDE: 0, SUPPORT: 0 } };
const icons = { DELIVERY: Package, RIDE: Bike, SUPPORT: MessageCircle };
function Badge({ count }: { count: number }) {
  return count > 0 ? <span aria-hidden="true" className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">{count > 99 ? "99+" : count}</span> : null;
}

export function NotificationInbox({ onBooking }: { onBooking: (id: string, type: "DELIVERY" | "RIDE") => void }) {
  const id = useAppStore(state => state.user?.id ?? "anonymous");
  const owner = useRef(id);
  useEffect(() => {
    owner.current = id;
    void setPushAccount(id === "anonymous" ? null : id).catch(() => {});
    return () => { owner.current = ""; };
  }, [id]);
  const version = useRef(0);
  const [legacy, saveLegacy] = useCustomerData<BookingNotification[]>(id, "notification-inbox-v2", [], true);
  const [preferences] = useCustomerData(id, "notifications", { inApp: true, browser: false }, true);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<NotificationCategory>("DELIVERY");
  const [state, setState] = useState<{ owner: string; page: InboxPage; support: SupportInboxItem[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const current = state?.owner === id ? state : null;
  const inbox = combineInbox(current?.page ?? empty, legacy, current?.support ?? []);
  const unread = NOTIFICATION_CATEGORIES.reduce((total, key) => total + inbox.unread[key], 0);
  async function refresh(signal?: AbortSignal) {
    if (id === "anonymous" || !navigator.onLine) return;
    const request = ++version.current;
    try {
      const [page, support] = await Promise.all([
        fetch("/api/notifications", { cache: "no-store", signal }).then(response => customerResponse<InboxPage>(response, "Couldn’t load notifications. Please retry.")),
        fetch("/api/support/notifications", { cache: "no-store", signal }).then(response => customerResponse<{ items: SupportInboxItem[] }>(response, "Couldn’t load support replies. Please retry.")),
      ]);
      if (signal?.aborted || owner.current !== id || request !== version.current) return;
      setState({ owner: id, page, support: support.items }); setError("");
    } catch (failure) { if (!signal?.aborted && owner.current === id && request === version.current) setError((failure as Error).message); }
  }
  useVisiblePoll(id !== "anonymous" ? `${id}:notifications` : "", refresh, 15000);
  useEffect(() => {
    const changed = () => void refresh();
    const pushed = (event: MessageEvent) => { if (event.data?.type === "FETCHIT_PUSH" && event.data.customerId === id) changed(); };
    window.addEventListener("fetchit:support-updated", changed);
    window.addEventListener("fetchit:notifications-updated", changed);
    navigator.serviceWorker?.addEventListener("message", pushed);
    return () => {
      window.removeEventListener("fetchit:support-updated", changed);
      window.removeEventListener("fetchit:notifications-updated", changed);
      navigator.serviceWorker?.removeEventListener("message", pushed);
    };
  }, [id]);
  useEffect(() => {
    if (id !== "anonymous" && preferences.browser && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
      void ensureCustomerPush(id).catch(() => { if (owner.current === id) setError("Background alerts couldn’t reconnect. Open notification preferences to enable them again."); });
    }
  }, [id, preferences.browser]);
  async function markRead(item?: InboxItem) {
    if (busy) return;
    setBusy(true);
    try {
      const selected = item ? [item] : inbox.items.filter(entry => entry.category === category);
      await customerResponse(await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item ? { ids: item.legacy ? [] : [item.id] } : { category }) }), "Couldn’t mark notifications as read. Please retry.");
      const supportIds = selected.filter(entry => entry.legacy === "support" && !entry.read).map(entry => entry.id);
      if (supportIds.length) await markSupportRead(supportIds);
      if (owner.current !== id) return;
      const legacyIds = new Set(selected.filter(entry => entry.legacy === "booking").map(entry => entry.id));
      saveLegacy(previous => previous.map(entry => legacyIds.has(entry.id) ? { ...entry, read: true } : entry));
      await refresh();
    } catch (failure) { if (owner.current === id) setError((failure as Error).message); }
    finally { if (owner.current === id) setBusy(false); }
  }
  return <>
    <Button variant="outline" size="icon" className="relative h-9 w-9 shrink-0" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} onClick={() => { setOpen(true); void refresh(); }}>
      <Bell className="h-4 w-4" /><span className="absolute -right-1 -top-1"><Badge count={unread} /></span>
    </Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Notifications</DialogTitle><DialogDescription>Choose a service to see its updates. Unread updates have a red badge.</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error} <button className="underline" onClick={() => void refresh()}>Retry</button></p>}
      <Tabs value={category} onValueChange={value => setCategory(value as NotificationCategory)}>
        <TabsList aria-label="Notification categories" className="grid h-auto w-full grid-cols-3 gap-1">
          {NOTIFICATION_CATEGORIES.map(key => { const Icon = icons[key]; return <TabsTrigger key={key} value={key} className="min-w-0 flex-wrap gap-1 px-1 py-2 text-xs sm:text-sm" aria-label={`${NOTIFICATION_LABELS[key]}${inbox.unread[key] ? `, ${inbox.unread[key]} unread` : ""}`}><Icon className="h-4 w-4" />{NOTIFICATION_LABELS[key]}<Badge count={inbox.unread[key]} /></TabsTrigger>; })}
        </TabsList>
        {NOTIFICATION_CATEGORIES.map(key => <TabsContent key={key} value={key}>
          <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{NOTIFICATION_LABELS[key]}</h3><Button variant="ghost" size="sm" disabled={!inbox.unread[key] || busy} onClick={() => void markRead()}>Mark as read</Button></div>
          {!current && !error ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading updates…</p> : inbox.items.some(item => item.category === key) ? <ul className="divide-y">{inbox.items.filter(item => item.category === key).map(item => <li key={`${item.legacy ?? "server"}:${item.id}`}>
            <button type="button" disabled={busy} className={`w-full rounded-lg p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.read ? "" : "bg-red-50 dark:bg-red-950/20"}`} onClick={() => {
              void markRead(item); setOpen(false);
              if (item.category === "SUPPORT" && item.ticketId) router.push(`/help?ticket=${encodeURIComponent(item.ticketId)}`);
              else if (item.bookingId && item.category !== "SUPPORT") onBooking(item.bookingId, item.category);
            }}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{item.title}</span>{!item.read && <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" aria-label="Unread" />}</div><p className="mt-1 break-words text-sm">{item.body}</p><time className="mt-1 block text-xs text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></button>
          </li>)}</ul> : <p className="py-8 text-center text-sm text-muted-foreground">No {NOTIFICATION_LABELS[key].toLowerCase()} updates yet.</p>}
        </TabsContent>)}
      </Tabs>
      <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Notification preferences</summary><div className="mt-3"><NotificationSettings /></div></details>
    </DialogContent></Dialog>
  </>;
}
