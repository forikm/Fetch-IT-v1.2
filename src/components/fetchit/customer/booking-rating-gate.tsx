"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { customerResponse } from "@/lib/customer-request";
import { BookingRatingForm } from "../shared/booking-rating-form";

type PendingRating = { id: string; refCode: string; type: "RIDE" | "DELIVERY" };
type GateResult = { key: string; booking: PendingRating | null; error?: string };

export function BookingRatingGate({ connected, revision, onRated, children }: {
  connected: boolean;
  revision: number;
  onRated: (id: string) => void;
  children: ReactNode;
}) {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<GateResult | null>(null);
  const [started, setStarted] = useState(!connected);
  const key = revision + ":" + refresh;

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch("/api/bookings/rating-required", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        const { booking } = await customerResponse<{ booking: PendingRating | null }>(response, "Couldn’t check whether a rating is required.");
        if (controller.signal.aborted) return;
        setResult({ key, booking });
        if (!booking) setStarted(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ key, booking: null, error: error instanceof Error ? error.message : "Couldn’t check whether a rating is required." });
      }
    }
    void check();
    return () => controller.abort();
  }, [connected, key]);

  const booking = result?.booking ?? null;
  const saved = useCallback(() => {
    if (!booking) return;
    onRated(booking.id);
    setRefresh(value => value + 1);
  }, [booking, onRated]);
  const error = result?.key === key ? result.error : undefined;
  const checking = connected && result?.key !== key;
  const blocked = checking || !!booking || (connected && !!error);

  return <>
    {(started || !connected) && <div hidden={blocked} className={blocked ? "hidden" : "flex min-h-0 flex-1 flex-col"}>{children}</div>}
    {blocked && <div className="space-y-3 overflow-y-auto px-4 pb-5 sm:px-6">
      {checking ? <p role="status" className="text-sm text-muted-foreground">Checking for completed bookings to rate…</p>
        : error ? <><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" onClick={() => setRefresh(value => value + 1)}>Retry rating check</Button></>
        : booking && <section aria-label="Required booking rating" className="space-y-4 rounded-xl border p-4">
          <div><h3 className="font-semibold">Rate your completed {booking.type === "RIDE" ? "ride" : "delivery"}</h3><p className="mt-1 text-sm text-muted-foreground">{booking.refCode} · Submit a rating to continue booking.</p></div>
          <BookingRatingForm key={booking.id} bookingId={booking.id} unavailable={!connected} onRated={saved} />
        </section>}
    </div>}
  </>;
}
