"use client";

import { useId, useRef, useState } from "react";
import { Check, Package, Bike, UserRound, CircleHelp } from "lucide-react";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useAppStore } from "@/lib/store";
import { customerResponse } from "@/lib/customer-request";
import { SUPPORT_TOPICS, supportTopic, supportIssue, supportContext } from "@/lib/support-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type SupportBooking = { id: string; refCode: string; type?: "RIDE" | "DELIVERY"; createdAt?: string; pickupLabel?: string; dropoffLabel?: string };
type Draft = { bookingId: string; topic?: string; issue?: string; message: string };
const topicIcons = { delivery: Package, ride: Bike, account: UserRound, general: CircleHelp };
const topicLabels = { delivery: "Delivery", ride: "Ride", account: "Account or app", general: "Something else" };

export function NewSupportRequest({ booking, onCreated }: { booking?: SupportBooking; onCreated: (id: string) => void }) {
  const userId = useAppStore(s => s.user?.id ?? "");
  const formId = useId();
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [draft, save] = useCustomerData<Draft>(userId, `support-draft:${booking?.id ?? "general"}`, {
    bookingId: booking?.id ?? "", topic: "", issue: "", message: "",
  });
  const [bookings, setBookings] = useState<SupportBooking[]>([]);
  const [bookingCursor, setBookingCursor] = useState<string | null>(null);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const topic = supportTopic(draft.topic);
  const issue = supportIssue(draft.topic, draft.issue);
  const matchingBookings = bookings.filter(b => b.type === topic?.bookingType);
  const chosenBooking = booking ?? matchingBookings.find(b => b.id === draft.bookingId);
  const maxLength = 2000 - supportContext(draft.topic, draft.issue).length;
  const needsBooking = !!topic?.bookingType;
  const validBooking = !needsBooking || !!chosenBooking && (!chosenBooking.type || chosenBooking.type === topic?.bookingType);
  const canSend = !!topic && !!issue && validBooking && draft.message.trim().length >= 10 && draft.message.length <= maxLength;
  const showCount = draft.message.length >= maxLength - 150;

  async function loadBookings(signal?: AbortSignal, cursor?: string) {
    setBookingBusy(true);
    try {
      const data = await customerResponse<{ bookings: SupportBooking[]; nextCursor: string | null }>(await fetch(`/api/bookings?filter=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal }), "Couldn’t load your bookings. Try again to link your ride or delivery.");
      if (!signal?.aborted) {
        setBookings(previous => cursor ? [...previous, ...data.bookings.filter(b => !previous.some(p => p.id === b.id))] : [...data.bookings, ...previous.filter(b => !data.bookings.some(p => p.id === b.id))]);
        // A background refresh of the first page must not rewind pagination.
        if (cursor || !bookingsLoaded) setBookingCursor(data.nextCursor);
        setBookingsLoaded(true);
        setBookingError("");
      }
    } catch (e) { if (!signal?.aborted) setBookingError((e as Error).message); }
    finally { setBookingBusy(false); }
  }
  useVisiblePoll(!booking && userId && needsBooking ? `${userId}:support-bookings` : "", loadBookings, 60000);

  return <form className="space-y-6 rounded-2xl border bg-card p-4 sm:p-6" aria-label="New support request" aria-busy={busy} onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    if (!canSend) return;
    setBusy(true); setError("");
    try {
      const data = await customerResponse<{ ticket: { id: string } }>(await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        topic: topic!.id, issue: issue!.id, bookingId: needsBooking ? chosenBooking!.id : null, message: draft.message,
      }) }), "Couldn’t send your request. Your draft is saved in this tab. Please try again.");
      save({ bookingId: booking?.id ?? "", topic: "", issue: "", message: "" });
      onCreated(data.ticket.id);
    } catch (e) { setError((e as Error).message); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { setBusy(false); }
  }}>
    <h2 className="text-lg font-semibold">New support request</h2>

    <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">What do you need help with?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {SUPPORT_TOPICS.filter(option => !booking || (option.bookingType && (!booking.type || option.bookingType === booking.type))).map(option => {
          const Icon = topicIcons[option.id as keyof typeof topicIcons];
          const active = option.id === topic?.id;
          return <label key={option.id} className={`relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${active ? "border-primary bg-primary/5" : "border-border"}`}>
            <input className="peer sr-only" type="radio" name={`${formId}-topic`} value={option.id} checked={active} required aria-controls={`${formId}-details`} onChange={() => {
              save({ ...draft, topic: option.id, issue: "", bookingId: booking?.id ?? (option.id === draft.topic ? draft.bookingId : "") }); setError("");
            }} />
            <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-sm font-medium">{topicLabels[option.id as keyof typeof topicLabels]}</span>
            {active && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
          </label>;
        })}
      </div>
    </fieldset>

    <div id={`${formId}-details`} className="space-y-6">
      {topic && <fieldset disabled={busy} className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">What happened?</legend>
        {topic.issues.map(option => <label key={option.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm hover:bg-muted/50 ${issue?.id === option.id ? "border-primary bg-primary/5" : "border-border"}`}>
          <input type="radio" name={`${formId}-issue`} value={option.id} checked={issue?.id === option.id} required onChange={() => { save({ ...draft, issue: option.id }); setError(""); }} className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
          {option.label}
        </label>)}
      </fieldset>}

      {topic && issue && <>
        {needsBooking && <div className="space-y-2">
          <Label htmlFor={booking ? undefined : `${formId}-booking`}>{booking ? "Linked booking" : `Which ${topic.bookingType === "RIDE" ? "ride" : "delivery"} is this about?`}</Label>
          {booking ? <p className="rounded-xl bg-muted/50 p-3 text-sm font-medium">{booking.refCode} · {topic.bookingType === "RIDE" ? "Ride" : "Delivery"}</p> : <>
            <select id={`${formId}-booking`} required disabled={busy || bookingBusy} className="min-h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-ring" value={matchingBookings.some(b => b.id === draft.bookingId) ? draft.bookingId : ""} onChange={e => { save({ ...draft, bookingId: e.target.value }); setError(""); }}>
              <option value="">{bookingBusy && !bookingsLoaded ? "Loading your bookings…" : `Select a ${topic.bookingType === "RIDE" ? "ride" : "delivery"}`}</option>
              {matchingBookings.map(b => <option key={b.id} value={b.id}>{b.refCode}{b.createdAt ? ` · ${new Date(b.createdAt).toLocaleDateString()}` : ""}{b.pickupLabel && b.dropoffLabel ? ` · ${b.pickupLabel} → ${b.dropoffLabel}` : ""}</option>)}
            </select>
            {bookingError && <p role="alert" className="text-sm text-destructive">{bookingError} <button type="button" disabled={bookingBusy || busy} className="underline" onClick={() => void loadBookings()}>Try again</button></p>}
            {bookingsLoaded && !bookingError && matchingBookings.length === 0 && <p role="status" className="rounded-xl bg-muted/50 p-3 text-sm">No {topic.bookingType === "RIDE" ? "rides" : "deliveries"} found{bookingCursor ? " on this page." : ". Choose Account or app for help without a booking."}</p>}
            {bookingCursor && <Button type="button" variant="outline" size="sm" disabled={bookingBusy || busy} onClick={() => void loadBookings(undefined, bookingCursor)}>{bookingBusy ? "Loading…" : "Load older bookings"}</Button>}
          </>}
        </div>}

        <div className="space-y-2">
          <Label htmlFor={`${formId}-message`}>Message</Label>
          <p id={`${formId}-prompt`} className="text-sm leading-relaxed text-muted-foreground">{issue.prompt}</p>
          <Textarea id={`${formId}-message`} rows={4} minLength={10} maxLength={maxLength} required disabled={busy} aria-describedby={`${formId}-prompt ${formId}-privacy ${formId}-message-hint`} value={draft.message} onChange={e => save({ ...draft, message: e.target.value })} />
          <p id={`${formId}-privacy`} className="text-sm text-muted-foreground">Leave out passwords, verification codes, payment details, and ID documents.</p>
          <p id={`${formId}-message-hint`} className="text-xs text-muted-foreground">
            {draft.message.length > maxLength ? "Shorten your message to fit the limit." : showCount ? `${(maxLength - draft.message.length).toLocaleString()} characters left` : draft.message.length > 0 && draft.message.trim().length < 10 ? "Enter at least 10 characters." : null}
          </p>
        </div>
      </>}
    </div>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
    {topic && issue && <Button type="submit" className="min-h-12 w-full sm:w-auto" disabled={busy || !canSend}>{busy ? "Sending…" : "Send request"}</Button>}
  </form>;
}
