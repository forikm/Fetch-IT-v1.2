"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bookmark, Car, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { readCustomerBooking } from "@/lib/offline-bookings";
import { useBookingUpdates } from "@/hooks/use-booking-updates";
import { useCompletedBookingRatings } from "@/hooks/use-completed-booking-ratings";
import { BookingActions } from "../shared/booking-actions";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { CustomerAppShell } from "../shared/customer-app-shell";
import { StatusBadge } from "../shared/status-badge";
import { RequestError } from "../shared/request-error";
import type { Booking } from "./customer-dashboard";

export function ModeSelect() {
  const user = useAppStore(s => s.user);
  const userId = user?.id ?? "";
  const startBooking = useAppStore(s => s.startBooking);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(s => s.offlineAccess);
  const { ratingBooking, observeRatings, dismissRating } = useCompletedBookingRatings();
  const request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const result = await readCustomerBooking<{ bookings: Booking[] }>(userId, "/api/bookings?filter=active");
      if (sequence !== request.current) return;
      if (!Array.isArray(result.data.bookings)) throw new Error("Bookings unavailable");
      observeRatings(result.data.bookings); setBookings(result.data.bookings); setSavedAt(result.cached ? result.savedAt : null); setError("");
    } catch { if (sequence === request.current) setError("Your active bookings couldn’t load."); }
    finally { if (sequence === request.current) setLoading(false); }
  }, [userId, observeRatings]);
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); const reconnect = () => { void load(); }; window.addEventListener("online", reconnect); return () => { cancelled = true; request.current++; window.removeEventListener("online", reconnect); }; }, [load]);
  const { offline } = useBookingUpdates<Booking>(userId, "ALL", updates => { request.current++; observeRatings(updates); setBookings(updates.filter(booking => !["DELIVERED", "CANCELLED"].includes(booking.status))); setSavedAt(null); setLoading(false); setError(""); });
  return <CustomerAppShell selected="home" title="Home">
    <section aria-labelledby="services-heading" className="space-y-4">
      <div><h2 id="services-heading" className="text-2xl font-semibold tracking-tight">Where to next, {user?.name?.split(" ")[0] ?? "there"}?</h2><p className="mt-1 text-base text-muted-foreground">Choose a ride or send a delivery.</p></div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" aria-label="Book a ride" onClick={() => startBooking("ride")} className="flex min-h-40 min-w-0 flex-col items-start gap-3 rounded-3xl border border-emerald-900/10 bg-[#e0ebe3] p-4 text-left text-[#163c34] transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring dark:border-emerald-200/20 dark:bg-[#1c3d2d] dark:text-[#e6f1e9]"><Car className="h-8 w-8" /><span className="text-xl font-semibold">Ride</span><span className="flex w-full items-center justify-between gap-1 text-sm">Book a ride<ArrowRight className="h-4 w-4 shrink-0" /></span></button>
        <button type="button" aria-label="Book a delivery" onClick={() => startBooking("delivery")} className="flex min-h-40 min-w-0 flex-col items-start gap-3 rounded-3xl border border-orange-900/10 bg-[#f5e8d9] p-4 text-left text-[#7b341c] transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring dark:border-orange-200/20 dark:bg-[#38271f] dark:text-[#ffcfad]"><Package className="h-8 w-8" /><span className="text-xl font-semibold">Delivery</span><span className="flex w-full items-center justify-between gap-1 text-sm">Send a package<ArrowRight className="h-4 w-4 shrink-0" /></span></button>
      </div>
    </section>
    <section aria-labelledby="active-heading" className="space-y-3">
      <h2 id="active-heading" className="text-lg font-semibold">Active bookings</h2>
      {(savedAt || offline || !online) && <p role="status" className="text-sm text-muted-foreground">{savedAt ? "Saved · updated " + new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Updates paused"} · Reconnect for current status.</p>}
      {loading ? <div role="status" className="animate-pulse rounded-2xl border bg-muted p-5 motion-reduce:animate-none">Loading your bookings…</div> : error ? <RequestError message={error} onRetry={() => void load()} /> : bookings.length ? bookings.slice(0, 3).map(booking => <button key={booking.id} type="button" aria-label={`Open booking ${booking.refCode}`} onClick={() => useAppStore.getState().openBookingSummary(booking.id, booking.type === "RIDE" ? "ride" : "delivery", "tracking")} className="flex w-full min-w-0 items-center gap-3 rounded-2xl border bg-card p-4 text-left focus-visible:outline-2 focus-visible:outline-ring">
        {booking.type === "RIDE" ? <Car className="h-6 w-6 shrink-0 text-primary" /> : <Package className="h-6 w-6 shrink-0 text-primary" />}
        <span className="min-w-0 flex-1 space-y-1"><span className="flex flex-wrap items-center gap-2"><StatusBadge status={booking.status} type={booking.type} /><span className="text-xs text-muted-foreground">{booking.refCode}</span></span><span className="block break-words text-base font-semibold">{booking.dropoffLabel}</span><span className="block text-sm text-muted-foreground">{booking.type === "RIDE" ? "View ride & safety" : "Track delivery"}</span></span><ArrowRight className="h-5 w-5 shrink-0" />
      </button>) : <p className="rounded-2xl border bg-card p-4 text-base text-muted-foreground">No active bookings. Choose Ride or Delivery to get started.</p>}
    </section>
    <Button type="button" variant="outline" className="w-full justify-start" onClick={() => useAppStore.getState().setView("onboarding")}><Bookmark />Manage saved places</Button>
    {ratingBooking && <BookingActions key={"home-rating:" + ratingBooking.id} booking={ratingBooking} ratingPrompt onRatingPromptClosed={dismissRating} readOnly={!online || offlineAccess || !!savedAt} />}
  </CustomerAppShell>;
}
