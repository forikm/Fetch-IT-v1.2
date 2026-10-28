"use client";

import { useId, useState } from "react";
import { MessageCircle, ArrowLeft, ChevronRight } from "lucide-react";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useAppStore } from "@/lib/store";
import { customerResponse } from "@/lib/customer-request";
import { supportSubject } from "@/lib/support-input";
import { NewSupportRequest, type SupportBooking as Booking } from "./support-request-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
  const [created, setCreated] = useState(false);
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
  if (selected) return <SupportConversation key={selected} id={selected} justCreated={created} onBack={() => { setSelected(""); setCreated(false); void refresh(); }} />;
  const onCreated = (id: string) => { setComposing(false); setCreated(true); setSelected(id); window.dispatchEvent(new Event("fetchit:support-updated")); };
  if (composing) return <div className="space-y-4"><Button variant="ghost" size="sm" onClick={() => setComposing(false)}><ArrowLeft className="h-4 w-4" />All requests</Button><NewSupportRequest booking={booking} onCreated={onCreated} /></div>;
  return <div className="space-y-6">
    <section aria-label="Your support requests" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Your requests</h2><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button>{page?.tickets.length !== 0 && <Button size="sm" onClick={() => setComposing(true)}>Get help</Button>}</div></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!page && !error && <p className="text-sm text-muted-foreground">Loading requests…</p>}
      {page?.tickets.length === 0 && <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-2 h-6 w-6" />No support requests yet. Choose an issue below to start your first conversation.</div>}
      {page?.tickets.map(ticket => <button key={ticket.id} type="button" className="w-full rounded-xl border p-4 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setCreated(false); setSelected(ticket.id); }}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{supportSubject(ticket)} {ticket.unread && <span className="ml-2 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">New reply</span>}</p><p className="mt-1 text-xs text-muted-foreground">{ticket.booking?.refCode ?? "General support"} · {status(ticket.status)}</p><p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{ticket.preview}</p></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></div>
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

function SupportConversation({ id, onBack, justCreated = false }: { id: string; onBack: () => void; justCreated?: boolean }) {
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
      await markSupportRead(next.messages.filter(m => m.authorRole !== "CUSTOMER" && (!next.ticket.customerReadAt || m.createdAt > next.ticket.customerReadAt)).map(m => m.id));
    } catch (e) { if (!signal?.aborted) setError((e as Error).message); }
  }
  useVisiblePoll(userId ? `${userId}:conversation:${id}` : "", refresh, 10000);
  return <section className="space-y-4" aria-label="Support conversation">
    {justCreated && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">Your request has been sent. You can add details below. Check this conversation or your notification bell for a reply.</p>}
    <div className="flex items-center justify-between gap-2"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />All requests</Button><Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!data && !error && <p className="text-sm text-muted-foreground">Loading conversation…</p>}
    {data && <>
      <div className="rounded-xl bg-muted/50 p-4"><h2 className="font-semibold">{supportSubject(data.ticket)}</h2><p className="mt-1 text-sm text-muted-foreground">{data.ticket.booking?.refCode ?? "General support"} · {status(data.ticket.status)}</p></div>
      <div className="space-y-3" role="log" aria-label="Messages" aria-live="polite">
        <MessageBubble body={data.ticket.message} at={data.ticket.createdAt} customer />
        {data.nextCursor && <Button size="sm" variant="outline" disabled={olderBusy} onClick={async () => {
          setOlderBusy(true);
          try { const older = await customerResponse<Conversation>(await fetch(`/api/support/${encodeURIComponent(id)}?cursor=${encodeURIComponent(data.nextCursor!)}`, { cache: "no-store" }), "Couldn’t load earlier messages.");
            setData(previous => previous ? { ...previous, messages: [...older.messages.filter(m => !previous.messages.some(p => p.id === m.id)), ...previous.messages], nextCursor: older.nextCursor } : previous);
            await markSupportRead(older.messages.filter(m => m.authorRole !== "CUSTOMER" && (!older.ticket.customerReadAt || m.createdAt > older.ticket.customerReadAt)).map(m => m.id));
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
        <Label htmlFor={`${formId}-reply`}>Your reply</Label><Textarea id={`${formId}-reply`} rows={3} minLength={1} maxLength={2000} required disabled={busy} aria-describedby={`${formId}-reply-hint`} placeholder="Add an update or ask a follow-up question…" value={reply} onChange={e => saveReply(e.target.value)} />
        <p id={`${formId}-reply-hint`} className="text-xs text-muted-foreground">{reply.length.toLocaleString()} / 2,000 characters · Keep verification codes and payment details private.</p>
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        <Button type="submit" className="min-h-11" disabled={busy || !reply.trim()}>{busy ? "Sending…" : data.ticket.status === "RESOLVED" ? "Send reply & reopen request" : "Send reply"}</Button>
      </form>
    </>}
  </section>;
}

function MessageBubble({ body, at, customer }: { body: string; at: string; customer: boolean }) {
  return <article className={`rounded-xl border p-4 ${customer ? "ml-4 bg-background" : "mr-4 border-primary/15 bg-primary/5"}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{customer ? "You" : "Fetch-It support"}</strong><time className="text-xs text-muted-foreground" dateTime={at}>{stamp(at)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</p></article>;
}
