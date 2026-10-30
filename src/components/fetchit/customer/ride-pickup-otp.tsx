"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FetchItLoader } from "../shared/loading";

// Mounted only while an accepted ride awaits boarding. Unmounting clears the
// code and ignores pending responses when the ride advances or is cancelled.
export function RidePickupOtp({ bookingId }: { bookingId: string }) {
  const [otp, setOtp] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);
  useEffect(() => () => { requestSequence.current++; }, []);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => {
      setOtp(null); setExpiresAt(null);
      setError("This code expired. Reveal a new code when your driver arrives.");
    }, Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  async function reveal() {
    const request = ++requestSequence.current;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/otp`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not retrieve your pickup code.");
      if (request === requestSequence.current) { setOtp(data.otp); setExpiresAt(data.expiresAt); }
    } catch (error) {
      if (request === requestSequence.current) setError(error instanceof Error ? error.message : "Please retry.");
    } finally { if (request === requestSequence.current) setLoading(false); }
  }

  return (
    <Card className="border-primary/30 bg-primary/5 py-0">
      <CardContent className="space-y-3 p-4">
        <p className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4" /> Pickup verification code</p>
        <p className="text-sm text-muted-foreground">Check your driver's name and vehicle. Share this code only when you meet at pickup, before boarding.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {otp ? <>
          <p aria-label="Your ride pickup code" className="rounded-lg border bg-card py-3 text-center font-mono text-3xl tracking-[0.25em]">{otp}</p>
          {expiresAt && <p className="text-xs text-muted-foreground">Valid until {new Date(expiresAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" })} Philippine time.</p>}
          <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={reveal}>{loading ? "Checking code…" : "Refresh pickup code"}</Button>
        </> : <Button variant="outline" className="min-h-11" disabled={loading} onClick={reveal}>{loading ? <FetchItLoader className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />} Show pickup code</Button>}
      </CardContent>
    </Card>
  );
}
