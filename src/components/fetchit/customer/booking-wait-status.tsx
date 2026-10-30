"use client";

import { useEffect, useRef, useState } from "react";
import { CancelBooking } from "../shared/cancel-booking";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAppStore } from "@/lib/store";
import { customerResponse } from "@/lib/customer-request";
import { bookingWaitFeedback, type WaitingBooking } from "@/lib/booking-wait";
import type { Booking } from "./customer-dashboard";

export function BookingWaitStatus({ booking, updatesPaused = false, onUpdated, onCancelled, readOnly = false }: {
  booking: WaitingBooking;
  updatesPaused?: boolean;
  readOnly?: boolean;
  onCancelled?: () => void;
  onUpdated: (update: Partial<Booking>) => void;
}) {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const feedback = bookingWaitFeedback(booking, now);
  useEffect(() => {
    if (!feedback) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [booking.id, booking.status]);
  useEffect(() => () => { const active = request.current; request.current = null; active?.abort(); }, [booking.id]);
  if (!feedback) return null;
  const disconnected = !online || offlineAccess;
  const paused = disconnected || updatesPaused;
  async function check() {
    if (pending.current || disconnected) return;
    pending.current = true;
    const controller = new AbortController();
    request.current = controller;
    const deadline = setTimeout(() => controller.abort(), 10_000);
    setBusy(true); setError(""); setChecked(false);
    try {
      const response = await fetch("/api/bookings/status?onlyTracked=1&ids=" + encodeURIComponent(booking.id), { cache: "no-store", signal: controller.signal });
      const data = await customerResponse<{ bookings: Booking[] }>(response, "Couldn’t check the latest status. Please retry before making another booking.");
      if (!Array.isArray(data.bookings)) throw new Error("Couldn’t check the latest status. Please retry before making another booking.");
      const latest = data.bookings.find(item => item.id === booking.id);
      if (!latest) throw new Error("This booking couldn’t be found. Refresh your bookings before making another request.");
      if (controller.signal.aborted) return;
      onUpdated(latest); setChecked(true);
    } catch (error) {
      if (request.current === controller) setError(controller.signal.aborted ? "The status check timed out. Please retry before making another booking." : error instanceof Error ? error.message : "Couldn’t check the latest status. Please retry.");
    } finally {
      clearTimeout(deadline);
      if (request.current === controller) { pending.current = false; setBusy(false); request.current = null; }
    }
  }
  return <section aria-label="Booking acceptance" className="space-y-3 rounded-xl border border-amber-300/60 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
    <div role="status" aria-live="polite" aria-atomic="true" className="space-y-1">
      <p className="font-semibold">{paused ? "Booking updates paused" : feedback.title}</p>
      <p className="leading-relaxed text-muted-foreground">{paused ? "Last known status: " + feedback.title + ". Check for an update when connected to see whether your booking has been accepted." : feedback.message}</p>
    </div>
    {!paused && feedback.wait && <p className="text-xs font-medium text-muted-foreground">{feedback.wait}</p>}
    {feedback.kind !== "scheduled" && <p className="text-xs leading-relaxed text-muted-foreground">{paused ? "Reconnect to check this booking. " : "You can keep waiting. "}Cancel this booking before making another request.</p>}
    <div className="grid gap-2 sm:flex sm:flex-wrap [&>button]:min-h-11"><Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={disconnected || busy} onClick={() => void check()}>{busy ? "Checking booking…" : error ? "Retry status check" : "Check for an update"}</Button>
      {onCancelled && <CancelBooking bookingId={booking.id} readOnly={readOnly || offlineAccess} onCancelled={onCancelled} />}
    </div>
    <p className="text-xs text-muted-foreground">Checking updates uses this same booking.</p>
    {checked && !error && <p role="status" className="text-xs text-muted-foreground">Latest booking status checked.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
