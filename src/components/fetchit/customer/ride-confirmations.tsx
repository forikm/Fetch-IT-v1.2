"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { customerResponse } from "@/lib/customer-request";
import { savedMutation } from "@/lib/booking-mutation-client";
import { startBookingTiming } from "@/lib/booking-client-timing";
import type { RideConfirmationAction } from "@/lib/ride-confirmation-policy";
import type { Booking } from "./customer-dashboard";

type ConfirmationUpdate = Pick<Booking, "id" | "status" | "updatedAt" | "customerPickupConfirmedAt" | "customerDropoffConfirmedAt">;

export function CustomerRideConfirmations({ ride, disabled = false, onUpdated }: {
  ride: Booking; disabled?: boolean; onUpdated: (update: Partial<Booking>) => void;
}) {
  const [confirming, setConfirming] = useState<RideConfirmationAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  async function confirm(action: RideConfirmationAction) {
    if (pending.current || disabled || !navigator.onLine) {
      if (!navigator.onLine) setError("Reconnect before confirming your ride.");
      return;
    }
    const timing = startBookingTiming("ride_confirmation");
    const controller = new AbortController();
    request.current = controller;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    let uncertain = true;
    let outcome: "confirmed" | "recovered" | "failed" | "uncertain" = "uncertain";
    const field = action === "PICKUP" ? "customerPickupConfirmedAt" : "customerDropoffConfirmedAt";
    const fallback = "Couldn’t verify your confirmation. Refresh your ride before trying again.";
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(ride.id)}/ride-confirmation`, {
        method: "POST", headers: { "Content-Type": "application/json", ...timing.headers },
        body: JSON.stringify({ action }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      timing.response(response); uncertain = response.ok || response.status >= 500;
      const data = await customerResponse<{ booking: ConfirmationUpdate }>(response, fallback);
      if (data.booking?.id !== ride.id || !data.booking[field]) throw new Error(fallback);
      if (controller.signal.aborted) return;
      onUpdated(data.booking); setConfirming(null); outcome = "confirmed";
      setNotice(action === "PICKUP" ? "Pickup confirmed. Your driver can start the trip." : "Arrival confirmed. Your driver can complete the ride after payment is confirmed.");
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (uncertain) {
        setNotice("Checking whether your confirmation was saved…");
        const saved = await savedMutation<{ booking: ConfirmationUpdate }>(`/api/bookings/${encodeURIComponent(ride.id)}`,
          data => data.booking?.id === ride.id && !!data.booking[field]);
        if (controller.signal.aborted) return;
        if (saved) { onUpdated(saved.booking); setConfirming(null); setNotice("Your confirmation is saved."); outcome = "recovered"; return; }
      }
      setNotice(""); outcome = uncertain ? "uncertain" : "failed";
      setError(uncertain ? fallback : failure instanceof Error ? failure.message : fallback);
    } finally {
      pending.current = false; request.current = null;
      if (!controller.signal.aborted) setBusy(false);
      timing.finish(outcome);
    }
  }

  async function reportDropoffIssue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || disabled || issue == null || !navigator.onLine) return;
    const controller = new AbortController();
    request.current = controller;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(ride.id)}/dropoff-issue`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: issue }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const data = await customerResponse<{ booking: Partial<Booking> }>(response, "Couldn’t send your report. Try again.");
      if (!controller.signal.aborted) {
        onUpdated(data.booking);
        setIssue(null);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn’t send your report. Try again.");
    } finally {
      pending.current = false;
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function refresh() {
    if (pending.current || disabled || !navigator.onLine) return;
    pending.current = true; setBusy(true);
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(ride.id)}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      const data = await customerResponse<{ booking: Booking }>(response, "Couldn’t refresh your ride. Reconnect and try again.");
      if (data.booking?.id !== ride.id) throw new Error("Ride unavailable. Reopen your booking.");
      if (!controller.signal.aborted) { onUpdated(data.booking); setConfirming(null); setError(""); setNotice("Ride details refreshed."); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn’t refresh your ride.");
    } finally { pending.current = false; request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  if (ride.type !== "RIDE" || !["PICKED_UP", "IN_TRANSIT"].includes(ride.status)) return null;
  const pickupConfirmed = !!ride.customerPickupConfirmedAt;
  const arrived = !!ride.customerDropoffConfirmedAt;
  const action: RideConfirmationAction | null = !pickupConfirmed ? "PICKUP" : ride.status === "IN_TRANSIT" && !arrived ? "DROPOFF" : null;
  const stageValid = confirming === "PICKUP" ? !pickupConfirmed : confirming === "DROPOFF" && pickupConfirmed && ride.status === "IN_TRANSIT" && !arrived;
  const dropoffReported = !!ride.riderDropoffReportedAt;
  const title = !pickupConfirmed ? "Are you on board?" : arrived ? "Arrival confirmed" : ride.status === "PICKED_UP" ? "Pickup confirmed" : dropoffReported ? "Your driver reported drop-off" : "At your drop-off?";
  const message = !pickupConfirmed ? "Your pickup code was verified. Confirm only after you’re inside the correct vehicle."
    : arrived ? "Your driver can complete the ride after payment is confirmed."
    : ride.status === "PICKED_UP" ? "Your driver can now start the trip."
    : dropoffReported ? "Confirm if you’ve arrived, or send an issue to support. You can respond even after your driver becomes available again."
    : "Confirm only when you’ve reached your booked drop-off and can safely get out.";

  return <section aria-label="Your ride confirmations" className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
    <div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{message}</p></div>
    {pickupConfirmed && <p className="text-sm">✓ You confirmed pickup{arrived ? " and drop-off" : ""}.</p>}
    {action && <Button type="button" className="min-h-12 w-full" disabled={disabled || busy} onClick={() => { setConfirming(action); setError(""); setNotice(""); }}>
      {action === "PICKUP" ? "I’m on board" : "I’ve arrived at drop-off"}
    </Button>}
    {dropoffReported && (ride.rideDropoffIssueReportedAt
      ? <p role="status" className="text-sm">Drop-off issue sent. <a className="underline" href="/help">View support requests</a></p>
      : issue === null
        ? <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => setIssue("")}>Report a drop-off issue</Button>
        : <form className="space-y-2" onSubmit={reportDropoffIssue}>
            <label htmlFor={`dropoff-issue-${ride.id}`} className="text-sm font-medium">What happened at drop-off?</label>
            <textarea id={`dropoff-issue-${ride.id}`} className="w-full rounded-md border bg-background p-2" rows={3}
              required minLength={10} maxLength={1800} value={issue} onChange={event => setIssue(event.target.value)} disabled={busy} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setIssue(null)}>Cancel</Button>
              <Button type="submit" disabled={disabled || busy || issue.trim().length < 10}>{busy ? "Sending…" : "Send to support"}</Button>
            </div>
          </form>)}
    {disabled && action && <p role="status" className="text-sm text-muted-foreground">Reconnect and wait for current ride details before confirming.</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button type="button" variant="outline" className="min-h-12" disabled={disabled || busy} onClick={refresh}>Refresh ride</Button></div>}
    <Dialog open={!!confirming && stageValid} onOpenChange={open => { if (!open && !pending.current) setConfirming(null); }}>
      <DialogContent showCloseButton={!busy} onEscapeKeyDown={event => { if (pending.current) event.preventDefault(); }} onInteractOutside={event => { if (pending.current) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{confirming === "PICKUP" ? "Confirm you’re on board?" : "Confirm arrival at drop-off?"}</DialogTitle>
          <DialogDescription>{confirming === "PICKUP" ? "Confirm only after boarding the correct vehicle. This lets your driver start the trip." : `Confirm only after reaching ${ride.dropoffLabel}. Payment confirmation is a separate step.`}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <DialogFooter><Button type="button" variant="outline" className="min-h-12" autoFocus disabled={busy} onClick={() => setConfirming(null)}>Not yet</Button>
          <Button type="button" className="min-h-12" disabled={disabled || busy || !stageValid} onClick={() => confirming ? confirm(confirming) : undefined}>{busy ? "Saving confirmation…" : confirming === "PICKUP" ? "Confirm pickup" : "Confirm drop-off"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
