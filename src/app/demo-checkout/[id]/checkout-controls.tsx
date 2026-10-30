"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
export function DemoCheckoutControls({ checkoutId, amount, customerId, draftId, bookingType, retryOnly = false }: { checkoutId: string; amount: string; customerId: string; draftId: string | null; bookingType: string; retryOnly?: boolean }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<"SUCCEEDED" | "FAILED" | "CANCELLED" | null>(null);
  const [returnUrl, setReturnUrl] = useState("/");
  async function pay(outcome: "SUCCEEDED" | "FAILED" | "CANCELLED") {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/checkouts/${checkoutId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment could not be completed. Please retry.");
      if (outcome === "SUCCEEDED" && draftId) {
        // Clear only this paid request's retry key. A subsequent deliberate
        // booking of the same route must get a new key; other tabs keep theirs.
        try {
          const storageKey = `fetchit:${customerId}:${bookingType === "RIDE" ? "ride-booking-submission" : "delivery-booking-submission"}`;
          const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
          if (typeof saved?.key === "string") {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([customerId, saved.key])));
            const id = `booking_${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")}`;
            if (id === draftId && localStorage.getItem(storageKey) === JSON.stringify(saved)) localStorage.removeItem(storageKey);
          }
        } catch { /* Local storage cannot change the committed payment result. */ }
      }
      setResult(outcome); setReturnUrl(data.returnUrl);
    } catch (error) { setError(error instanceof Error ? error.message : "Reconnect and retry your payment."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function retry() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/checkouts/${checkoutId}/retry`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Return to Fetch-It to retry checkout.");
      window.location.replace(data.checkoutUrl);
    } catch (error) { setError(error instanceof Error ? error.message : "Reconnect to retry checkout."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="space-y-3" aria-busy={busy}>
    {result ? <><div role="status" className="rounded-xl bg-muted p-4 text-sm">{result === "SUCCEEDED" ? <p className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-primary" />Simulated payment successful. Your booking is confirmed.</p> : result === "FAILED" ? "Payment unsuccessful. No booking was created." : "Payment cancelled. No booking was created."}</div>{result !== "SUCCEEDED" && <Button className="w-full" disabled={busy} onClick={() => void retry()}>Retry payment</Button>}<Link href={returnUrl} className="block rounded-xl bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground">{result === "SUCCEEDED" ? "View booking" : "Return to Fetch-It"}</Link></> : retryOnly ? <Button className="w-full" disabled={busy} onClick={() => void retry()}>{busy ? "Opening checkout…" : "Retry payment"}</Button> : <>
      <Button className="w-full h-12 rounded-xl" disabled={busy} onClick={() => void pay("SUCCEEDED")}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing simulated payment…</> : `Simulate payment of ₱${amount}`}</Button>
      <Button className="w-full" variant="ghost" disabled={busy} onClick={() => void pay("CANCELLED")}>Cancel payment</Button>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Simulation options</summary><Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={() => void pay("FAILED")}>Simulate unsuccessful payment</Button></details>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
