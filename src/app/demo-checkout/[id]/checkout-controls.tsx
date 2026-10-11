"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
export function DemoCheckoutControls({ checkoutId }: { checkoutId: string }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  async function simulate(outcome: "SUCCEEDED" | "FAILED" | "CANCELLED") {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/demo-checkouts/${checkoutId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Demo result could not be recorded.");
      setResult(outcome === "SUCCEEDED" ? "Demo payment succeeded. Your booking is ready for a rider. No real money moved." : outcome === "FAILED" ? "Demo payment failed. Return to your booking to retry checkout." : "Demo checkout cancelled. Your booking remains unpaid; you can retry checkout.");
    } catch (error) { setError(error instanceof Error ? error.message : "Reconnect and retry this demo result."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="space-y-3">{result ? <p role="status" className="rounded-lg bg-muted p-4">{result}</p> : <><p className="text-sm text-muted-foreground">Choose a test result for this payment.</p><div className="grid gap-3"><Button disabled={busy} onClick={() => void simulate("SUCCEEDED")}>{busy ? "Recording…" : "Simulate successful payment"}</Button><Button variant="outline" disabled={busy} onClick={() => void simulate("FAILED")}>Simulate failed payment</Button><Button variant="outline" disabled={busy} onClick={() => void simulate("CANCELLED")}>Cancel demo checkout</Button></div></>}{error && <p role="alert" className="text-destructive">{error}</p>}</div>;
}
