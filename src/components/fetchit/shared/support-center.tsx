"use client";

import { useId, useState } from "react";
import { MessageCircle, ArrowLeft, ChevronRight } from "lucide-react";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useAppStore } from "@/lib/store";
import { customerResponse } from "@/lib/customer-request";
import { SUPPORT_CATEGORIES, SUPPORT_LABELS } from "@/lib/support-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Booking = { id: string; refCode: string; type?: "RIDE" | "DELIVERY" };
type Ticket = { id: string; category: string; status: string; message: string; createdAt: string; customerReadAt?: string | null; booking: Booking | null; preview?: string; unread?: boolean };
type Message = { id: string; body: string; authorRole: string; createdAt: string };
type Conversation = { ticket: Ticket; messages: Message[]; nextCursor: string | null };
type TicketPage = { tickets: Ticket[]; nextCursor: string | null };
const stamp = (at: string) => new Date(at).toLocaleString();
const status = (value: string) => ({ OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved" }[value] ?? value);

export async function markSupportRead(ids: string[]) {
  if (!ids.length) return;
  await customerResponse(await fetch("/api/support/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }) }), "Couldn’t mark replies as read. Please retry.");
  window.dispatchEvent(new Event("fetchit:support-updated"));
}

export function SupportCenter({ booking, initialTicketId }: { booking?: Booking; initialTicketId?: string }) {
  const userId = useAppStore(s => s.user?.id ?? "");
  const [selected, setSelected] = useState(initialTicketId ?? "");
  const [composing, setComposing] = useState(false);
  const [page, setPage] = useState<TicketPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/support${booking ? `?bookingId=${encodeURIComponent(booking.id)}` : ""}`;
  async function refresh(signal?: AbortSignal) {
    try {
      const data = await customerResponse<TicketPage>(await fetch(url, { cache: "no-store", signal }), "Couldn’t load your requests. Please retry.");
      if (!signal?.aborted) {
        setPage(previous => {
          const seen = new Set(data.tickets.map(t => t.id));
          const older = previous?.tickets.filter(t => !seen.has(t.id) && t.createdAt <= (data.tickets.at(-1)?.createdAt ?? "")) ?? [];
          return { tickets: [...data.tickets, ...older], nextCursor: older.length ? previous!.nextCursor : data.nextCursor };
        });
        setError("");
      }
    } catch (e) { if (!signal?.aborted) setError((e as Error).message); }
  }
  useVisiblePoll(!selected && !composing && userId ? `${userId}:${url}` : "", refresh, 30000);
  if (selected) return <SupportConversation key={selected} id={selected} onBack={() => { setSelected(""); void refresh(); }} />;
  const onCreated = (id: string) => { setComposing(false); setSelected(id); window.dispatchEvent(new Event("fetchit:support-updated")); };
  if (composing) return <div className="space-y-4"><Button variant="ghost" size="sm" onClick={() => setComposing(false)}><ArrowLeft className="h-4 w-4" />All requests</Button><NewSupportRequest booking={booking} onCreated={onCreated} /></div>;
  return <div className="space-y-6">
    <section aria-label="Your support requests" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Your requests</h2><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button><Button size="sm" onClick={() => setComposing(true)}>New request</Button></div></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!page && !error && <p className="text-sm text-muted-foreground">Loading requests…</p>}
      {page?.tickets.length === 0 && <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-2 h-6 w-6" />No requests yet. Send a message below whenever you need help.</div>}
      {page?.tickets.map(ticket => <button key={ticket.id} type="button" className="w-full rounded-xl border p-4 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelected(ticket.id)}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{SUPPORT_LABELS[ticket.category]} {ticket.unread && <span className="ml-2 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">New reply</span>}</p><p className="mt-1 text-xs text-muted-foreground">{ticket.booking?.refCode ?? "Account help"} · {status(ticket.status)}</p><p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{ticket.preview}</p></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></div>
      </button>)}
      {page?.nextCursor && <Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const next = await customerResponse<TicketPage>(await fetch(`${url}${booking ? "&" : "?"}cursor=${encodeURIComponent(page.nextCursor!)}`, { cache: "no-store" }), "Couldn’t load older requests.");
          setPage(previous => ({ tickets: [...(previous?.tickets ?? []), ...next.tickets], nextCursor: next.nextCursor })); setError("");
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>Load older requests</Button>}
    </section>
    {page?.tickets.length === 0 && <NewSupportRequest key={booking?.id ?? "general"} booking={booking} onCreated={onCreated} />}
  </div>;
}

function NewSupportRequest({ booking, onCreated }: { booking?: Booking; onCreated: (id: string) => void }) {
  const userId = useAppStore(s => s.user?.id ?? "");
  const formId = useId();
  const [draft, save] = useCustomerData(userId, `support-draft:${booking?.id ?? "general"}`, { bookingId: booking?.id ?? "", category: booking ? "BOOKING" : "OTHER", message: "" });
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingCursor, setBookingCursor] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function loadBookings(signal?: AbortSignal, cursor?: string) {
    try {
      const data = await customerResponse<{ bookings: Booking[]; nextCursor: string | null }>(await fetch(`/api/bookings?filter=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal }), "Couldn’t load bookings. You can still send an account question.");
      if (!signal?.aborted) {
        setBookings(previous => cursor ? [...previous, ...data.bookings.filter(b => !previous.some(p => p.id === b.id))] : [...data.bookings, ...previous.filter(b => !data.bookings.some(p => p.id === b.id))]);
        if (cursor || bookings.length <= 100) setBookingCursor(data.nextCursor);
        setBookingError("");
      }
    } catch (e) { if (!signal?.aborted) setBookingError((e as Error).message); }
  }
  useVisiblePoll(!booking && userId ? `${userId}:support-bookings` : "", loadBookings, 60000);
  return <form className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const data = await customerResponse<{ ticket: Ticket }>(await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, bookingId: booking?.id ?? (draft.bookingId || null) }) }), "Couldn’t send your request. Your message is kept; please retry.");
      save({ ...draft, message: "" }); onCreated(data.ticket.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    <div><h2 className="text-lg font-semibold">Send a help request</h2><p className="mt-1 text-sm text-muted-foreground">Tell us what happened. Replies will appear here and in your notifications.</p></div>
    {!booking && <div className="space-y-2"><Label htmlFor={`${formId}-booking`}>What is this about?</Label><select id={`${formId}-booking`} disabled={busy} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={draft.bookingId} onChange={e => save({ ...draft, bookingId: e.target.value, category: e.target.value ? "BOOKING" : "OTHER" })}><option value="">Account or general question</option>{draft.bookingId && !bookings.some(b => b.id === draft.bookingId) && <option value={draft.bookingId}>Previously selected booking</option>}{bookings.map(b => <option key={b.id} value={b.id}>{b.refCode} · {b.type === "RIDE" ? "Ride" : "Delivery"}</option>)}</select>{bookingError && <p role="alert" className="text-xs text-destructive">{bookingError} <button type="button" className="underline" onClick={() => void loadBookings()}>Retry</button></p>}{bookingCursor && <Button type="button" variant="ghost" size="sm" onClick={() => void loadBookings(undefined, bookingCursor)}>Load older bookings</Button>}</div>}
    {(booking || draft.bookingId) && <div className="space-y-2"><Label htmlFor={`${formId}-category`}>Issue</Label><select id={`${formId}-category`} disabled={busy} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={draft.category} onChange={e => save({ ...draft, category: e.target.value })}>{SUPPORT_CATEGORIES.map(c => <option key={c} value={c}>{SUPPORT_LABELS[c]}</option>)}</select></div>}
    <div className="space-y-2"><Label htmlFor={`${formId}-message`}>Describe the issue</Label><Textarea id={`${formId}-message`} rows={4} minLength={10} maxLength={2000} required disabled={busy} value={draft.message} onChange={e => save({ ...draft, message: e.target.value })} placeholder="Include what happened and how we can help." /><p className="text-xs text-muted-foreground">Please keep passwords and delivery verification codes private.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send help request"}</Button>
  </form>;
}

function SupportConversation({ id, onBack }: { id: string; onBack: () => void }) {
  const userId = useAppStore(s => s.user?.id ?? "");
  const formId = useId();
  const [data, setData] = useState<Conversation | null>(null);
  const [reply, saveReply] = useCustomerData(userId, `support-reply:${id}`, "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  async function refresh(signal?: AbortSignal) {
    try {
      const next = await customerResponse<Conversation>(await fetch(`/api/support/${encodeURIComponent(id)}`, { cache: "no-store", signal }), "Couldn’t load this conversation. Please retry.");
      if (signal?.aborted) return;
      setData(previous => {
        // Keep older pages when a new reply arrives during polling.
        const seen = new Set(next.messages.map(m => m.id));
        const older = previous?.messages.filter(m => !seen.has(m.id) && m.createdAt <= (next.messages[0]?.createdAt ?? "")) ?? [];
        return { ...next, messages: [...older, ...next.messages], nextCursor: older.length ? previous!.nextCursor : next.nextCursor };
      });
      setError("");
      await markSupportRead(next.messages.filter(m => m.authorRole === "ADMIN" && (!next.ticket.customerReadAt || m.createdAt > next.ticket.customerReadAt)).map(m => m.id));
    } catch (e) { if (!signal?.aborted) setError((e as Error).message); }
  }
  useVisiblePoll(userId ? `${userId}:conversation:${id}` : "", refresh, 10000);
  return <section className="space-y-4" aria-label="Support conversation">
    <div className="flex items-center justify-between gap-2"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />All requests</Button><Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!data && !error && <p className="text-sm text-muted-foreground">Loading conversation…</p>}
    {data && <>
      <div className="rounded-xl bg-muted/50 p-4"><h2 className="font-semibold">{SUPPORT_LABELS[data.ticket.category]}</h2><p className="mt-1 text-sm text-muted-foreground">{data.ticket.booking?.refCode ?? "Account help"} · {status(data.ticket.status)}</p></div>
      <div className="space-y-3" role="log" aria-label="Messages" aria-live="polite">
        <MessageBubble body={data.ticket.message} at={data.ticket.createdAt} customer />
        {data.nextCursor && <Button size="sm" variant="outline" disabled={olderBusy} onClick={async () => {
          setOlderBusy(true);
          try { const older = await customerResponse<Conversation>(await fetch(`/api/support/${encodeURIComponent(id)}?cursor=${encodeURIComponent(data.nextCursor!)}`, { cache: "no-store" }), "Couldn’t load earlier messages.");
            setData(previous => previous ? { ...previous, messages: [...older.messages.filter(m => !previous.messages.some(p => p.id === m.id)), ...previous.messages], nextCursor: older.nextCursor } : previous);
            await markSupportRead(older.messages.filter(m => m.authorRole === "ADMIN" && (!older.ticket.customerReadAt || m.createdAt > older.ticket.customerReadAt)).map(m => m.id));
          } catch (e) { setError((e as Error).message); } finally { setOlderBusy(false); }
        }}>Load earlier messages</Button>}
        {data.messages.map(m => <MessageBubble key={m.id} body={m.body} at={m.createdAt} customer={m.authorRole === "CUSTOMER"} />)}
      </div>
      <form className="space-y-3 border-t pt-4" onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setError(""); setNotice("");
        try {
          const result = await customerResponse<{ message: Message; reopened: boolean }>(await fetch(`/api/support/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: reply }) }), "Couldn’t send your reply. Your message is kept; please retry.");
          saveReply(""); setNotice(result.reopened ? "Reply sent. Your request has been reopened." : "Reply sent.");
          setData(previous => previous ? { ...previous, ticket: { ...previous.ticket, status: result.reopened ? "OPEN" : previous.ticket.status }, messages: [...previous.messages.filter(m => m.id !== result.message.id), result.message] } : previous);
          window.dispatchEvent(new Event("fetchit:support-updated"));
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>
        {data.ticket.status === "RESOLVED" && <p className="text-sm text-muted-foreground">Still need help? Sending a reply will reopen this request.</p>}
        <Label htmlFor={`${formId}-reply`}>Your reply</Label><Textarea id={`${formId}-reply`} rows={3} minLength={1} maxLength={2000} required disabled={busy} value={reply} onChange={e => saveReply(e.target.value)} />
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reply"}</Button>
      </form>
    </>}
  </section>;
}

function MessageBubble({ body, at, customer }: { body: string; at: string; customer: boolean }) {
  return <article className={`rounded-xl border p-4 ${customer ? "ml-4 bg-background" : "mr-4 border-primary/15 bg-primary/5"}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{customer ? "You" : "Fetch-It support"}</strong><time className="text-xs text-muted-foreground" dateTime={at}>{stamp(at)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</p></article>;
}
