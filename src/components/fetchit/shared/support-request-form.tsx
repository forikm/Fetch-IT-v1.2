"use client";

import { useId, useRef, useState } from "react";
import { Check, MessageCircle, Package, Bike, UserRound, CircleHelp } from "lucide-react";
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
    if (!canSend) { setError("Select an issue, choose the relevant booking if needed, and describe what happened in at least 10 characters."); return; }
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
    <div><h2 className="text-lg font-semibold">Get help from Fetch-It</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Choose an issue, add the details, and send your request. You can read and reply to our response here.</p></div>

    <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-3 text-sm font-semibold">1. What’s the issue?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {SUPPORT_TOPICS.filter(option => !booking || (option.bookingType && (!booking.type || option.bookingType === booking.type))).map(option => {
          const Icon = topicIcons[option.id as keyof typeof topicIcons];
          const active = option.id === topic?.id;
          return <label key={option.id} className={`relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${active ? "border-primary bg-primary/5" : "border-border"}`}>
            <input className="peer sr-only" type="radio" name={`${formId}-topic`} value={option.id} checked={active} required aria-controls={`${formId}-details`} onChange={() => {
              save({ ...draft, topic: option.id, issue: "", bookingId: booking?.id ?? (option.id === draft.topic ? draft.bookingId : "") }); setError("");
            }} />
            <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{option.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.description}</span></span>
            {active && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />}
          </label>;
        })}
      </div>
    </fieldset>

    <div id={`${formId}-details`} className="space-y-6">
      {topic && <fieldset disabled={busy} className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">2. What happened?</legend>
        <p className="pb-1 text-xs text-muted-foreground">Choose the option that best matches your concern.</p>
        {topic.issues.map(option => <label key={option.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm hover:bg-muted/50 ${issue?.id === option.id ? "border-primary bg-primary/5" : "border-border"}`}>
          <input type="radio" name={`${formId}-issue`} value={option.id} checked={issue?.id === option.id} required onChange={() => { save({ ...draft, issue: option.id }); setError(""); }} className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
          {option.label}
        </label>)}
      </fieldset>}

      {topic && issue && <>
        {needsBooking && <div className="space-y-2">
          <Label htmlFor={booking ? undefined : `${formId}-booking`}>{booking ? "Linked booking" : `Which ${topic.bookingType === "RIDE" ? "ride" : "delivery"} is this about?`}</Label>
          {booking ? <p className="rounded-xl bg-muted/50 p-3 text-sm font-medium">{booking.refCode} · {topic.bookingType === "RIDE" ? "Ride" : "Delivery"}</p> : <>
            <select id={`${formId}-booking`} required disabled={busy || bookingBusy} aria-describedby={`${formId}-booking-hint`} className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={matchingBookings.some(b => b.id === draft.bookingId) ? draft.bookingId : ""} onChange={e => { save({ ...draft, bookingId: e.target.value }); setError(""); }}>
              <option value="">{bookingBusy && !bookingsLoaded ? "Loading your bookings…" : `Select a ${topic.bookingType === "RIDE" ? "ride" : "delivery"}`}</option>
              {matchingBookings.map(b => <option key={b.id} value={b.id}>{b.refCode}{b.createdAt ? ` · ${new Date(b.createdAt).toLocaleDateString()}` : ""}{b.pickupLabel && b.dropoffLabel ? ` · ${b.pickupLabel} → ${b.dropoffLabel}` : ""}</option>)}
            </select>
            <p id={`${formId}-booking-hint`} className="text-xs text-muted-foreground">Only your {topic.bookingType === "RIDE" ? "rides" : "deliveries"} are shown. Linking a booking helps us find the right trip.</p>
            {bookingError && <p role="alert" className="text-sm text-destructive">{bookingError} <button type="button" disabled={bookingBusy || busy} className="underline" onClick={() => void loadBookings()}>Try again</button></p>}
            {bookingsLoaded && !bookingError && matchingBookings.length === 0 && <p role="status" className="rounded-xl bg-muted/50 p-3 text-sm">No {topic.bookingType === "RIDE" ? "rides" : "deliveries"} found{bookingCursor ? " on this page. Load older bookings below." : ". Check that you’re signed in to the account used to book. For help without a booking, choose Account or app help above."}</p>}
            {bookingCursor && <Button type="button" variant="outline" size="sm" disabled={bookingBusy || busy} onClick={() => void loadBookings(undefined, bookingCursor)}>{bookingBusy ? "Loading…" : "Load older bookings"}</Button>}
          </>}
        </div>}

        <div className="space-y-2">
          <Label htmlFor={`${formId}-message`}>3. Tell us more</Label>
          <p id={`${formId}-prompt`} className="text-sm leading-relaxed text-muted-foreground">{issue.prompt}</p>
          <Textarea id={`${formId}-message`} rows={5} minLength={10} maxLength={maxLength} required disabled={busy} aria-describedby={`${formId}-prompt ${formId}-message-hint ${formId}-privacy`} value={draft.message} onChange={e => save({ ...draft, message: e.target.value })} placeholder="What happened, and how can we help?" />
          <div id={`${formId}-message-hint`} className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{draft.message.trim().length < 10 ? "Add at least 10 characters to describe the issue." : draft.message.length > maxLength ? "Please shorten your message to fit the limit." : "Your draft is saved in this browser tab."}</span><span>{draft.message.length.toLocaleString()} / {maxLength.toLocaleString()} characters</span></div>
          <p id={`${formId}-privacy`} className="text-xs leading-relaxed text-muted-foreground">Keep passwords, sign-in codes, delivery verification codes, and full payment details private.</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3 text-sm"><p className="flex items-center gap-2 font-medium"><MessageCircle aria-hidden="true" className="h-4 w-4" />What happens next?</p><p className="mt-1 leading-relaxed text-muted-foreground">Your request opens as a conversation. Find it under Your requests and check the notification bell for replies. Add any updates in the same conversation.</p></div>
      </>}
    </div>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="space-y-2"><Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={busy || !canSend}>{busy ? "Sending request…" : "Send support request"}</Button>{!canSend && <p className="text-xs text-muted-foreground">{!topic ? "Choose an issue to get started." : !issue ? "Choose what happened to continue." : !validBooking ? "Select the booking you need help with." : "Add a description within the character limit to send your request."}</p>}</div>
  </form>;
}
