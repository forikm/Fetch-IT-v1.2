"use client";
import { useRef, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { customerResponse } from "@/lib/customer-request";
import type { PickupProgress as Progress } from "@/lib/pickup-progress";
import { Button } from "@/components/ui/button";
export function CustomerPickupProgress({ bookingId, compact = false }: { bookingId: string; compact?: boolean }) {
  const online = useOnlineStatus();
  const [progress, setProgress] = useState<(Progress & { etaMinutes?: number | null; etaLocationAt?: string | null }) | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  async function refresh(signal?: AbortSignal) {
    const request = ++sequence.current;
    try {
      const data = await customerResponse<{ pickupProgress: (Progress & { etaMinutes?: number | null; etaLocationAt?: string | null }) | null }>(await fetch("/api/bookings/" + encodeURIComponent(bookingId) + "/pickup-progress", { cache: "no-store", signal }), "Pickup progress couldn’t load. Please retry.");
      if (!signal?.aborted && request === sequence.current) { setProgress(data.pickupProgress); setLoaded(true); setError(""); }
    } catch (error) { if (!signal?.aborted && request === sequence.current) setError(error instanceof Error ? error.message : "Pickup progress couldn’t load."); }
  }
  useVisiblePoll(bookingId + ":pickup-progress", refresh, 5000);
  const heading = loaded && !progress ? "Booking status changed" : progress?.stage === "ARRIVED" ? "Driver reports arrival at pickup" : progress?.stage === "HEADING" ? "Driver heading to pickup" : "Driver accepted";
  if (compact) return <section aria-label="Pickup arrival" className="rounded-2xl border bg-primary/5 p-3"><div role="status"><p className="font-semibold">{heading}</p><p className="mt-1 text-sm text-muted-foreground">{online && !error && progress?.stage === "HEADING" && progress.etaMinutes != null ? "Estimated pickup arrival: about " + progress.etaMinutes + " min" : progress?.stage === "ARRIVED" ? "Check the name and plate before sharing your pickup code." : online ? "Checking pickup arrival…" : "Reconnect for a current pickup estimate."}</p></div><details className="mt-1 text-sm text-muted-foreground"><summary className="min-h-12 cursor-pointer py-3">Pickup updates &amp; estimate details</summary><p>Approximate distance and vehicle-speed estimate. Traffic and waiting time are not included.</p>{progress?.at && <p className="mt-2">Driver update: {new Date(progress.at).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })} (PH time)</p>}{progress?.etaLocationAt && <p className="mt-2">Based on driver location at {new Date(progress.etaLocationAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })} (PH time).</p>}</details>{error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" variant="outline" onClick={() => void refresh()}>Retry pickup progress</Button></div>}</section>;
  return <section className="space-y-2 rounded-xl border bg-primary/5 p-4" aria-label="Pickup arrival">
    <div role="status"><p className="font-semibold">{heading}</p><p className="mt-1 text-sm text-muted-foreground">{progress?.stage === "ARRIVED" ? "Check the driver’s name and plate. Share your pickup code only when you meet, before boarding." : progress?.stage === "HEADING" ? "Your driver confirmed they’re heading to your pickup point." : loaded && !progress ? "Your booking status has changed. Refresh bookings for the latest details." : loaded ? "Waiting for your driver to confirm they’re heading to pickup." : "Checking your driver’s pickup progress…"}</p></div>
    {progress?.at && <p className="text-xs text-muted-foreground">Driver update: {new Date(progress.at).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })} (PH time)</p>}
    {online && !error && progress?.stage === "HEADING" && progress.etaMinutes != null ? <div className="space-y-1"><p className="text-sm font-medium">Estimated pickup arrival: about {progress.etaMinutes} min</p><details className="text-sm text-muted-foreground"><summary className="min-h-12 cursor-pointer py-3">How this estimate works</summary><p>Approximate distance and vehicle-speed estimate. Traffic and waiting time are not included.</p>{progress.etaLocationAt && <p className="mt-2">Based on driver location at {new Date(progress.etaLocationAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })} (PH time).</p>}</details></div> : <p className="text-xs text-muted-foreground">{online ? "Pickup ETA is unavailable." : "Reconnect for a current pickup estimate."} Estimated trip duration is the travel time from pickup to drop-off.</p>}
    {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" variant="outline" onClick={() => void refresh()}>Retry pickup progress</Button></div>}
  </section>;
}
