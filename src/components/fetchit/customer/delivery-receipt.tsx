"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { customerResponse } from "@/lib/customer-request";
import { useAppStore } from "@/lib/store";

type Receipt = { confirmedAt: string | null; ticketId: string | null };

export function DeliveryReceipt({ bookingId }: { bookingId: string }) {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const available = online && !offlineAccess;
  const fieldId = useId();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [reporting, setReporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const revision = useRef(0);
  const url = "/api/bookings/" + encodeURIComponent(bookingId) + "/delivery-receipt";

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    const readRevision = revision.current;
    const current = () => !controller.signal.aborted && !submitting.current && readRevision === revision.current;
    async function load() {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const saved = await customerResponse<Receipt>(response, "Couldn’t load your delivery response.");
        if (current()) { setReceipt(saved); setError(""); }
      } catch (error) {
        if (current()) setError(error instanceof Error ? error.message : "Couldn’t load your delivery response.");
      }
    }
    void load();
    return () => controller.abort();
  }, [available, reload, url]);

  async function respond(action: "CONFIRM" | "REPORT") {
    if (!available || submitting.current) return;
    submitting.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "REPORT" ? { message } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      const saved = await customerResponse<Receipt>(response, "Couldn’t save your response. Please retry.");
      setReceipt(saved);
      if (saved.ticketId) window.dispatchEvent(new Event("fetchit:support-updated"));
    } catch (error) {
      setError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Couldn’t save your response. Please retry.");
    } finally {
      revision.current++;
      submitting.current = false;
      setBusy(false);
    }
  }

  return <section aria-labelledby={fieldId + "-heading"} className="space-y-3 rounded-2xl border bg-card p-4 text-sm">
    <h3 id={fieldId + "-heading"} className="text-base font-semibold">Parcel receipt</h3>
    {receipt?.confirmedAt ? <p role="status">You confirmed that your parcel was received.</p>
      : receipt?.ticketId ? <><p role="status">Your delivery report was sent to Fetch-It Support.</p><Button asChild variant="outline"><Link href={"/help?ticket=" + encodeURIComponent(receipt.ticketId)}>View support request</Link></Button></>
      : !available ? <p>Reconnect to confirm receipt or report a problem.</p>
      : receipt ? <>
        <p className="text-muted-foreground">Your rider marked this parcel delivered. Did you receive it in good condition?</p>
        {reporting ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void respond("REPORT"); }}>
          <Label htmlFor={fieldId}>What happened?</Label>
          <Textarea id={fieldId} value={message} onChange={event => setMessage(event.target.value)} disabled={busy} minLength={10} maxLength={1800} required placeholder="Describe what is missing, damaged, or incorrect." />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || message.trim().length < 10}>{busy ? "Sending report…" : "Send report"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setReporting(false); setError(""); }}>Back</Button>
          </div>
        </form> : <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void respond("CONFIRM")}>{busy ? "Confirming…" : "Confirm receipt"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setReporting(true); setError(""); }}>Report a problem</Button>
        </div>}
      </> : !error && <p role="status">Checking your delivery response…</p>}
    {available && error && <div className="space-y-2"><p role="alert" className="text-destructive">{error}</p><Button type="button" variant="outline" onClick={() => { setError(""); setReceipt(null); setReload(count => count + 1); }}>Refresh receipt status</Button></div>}
  </section>;
}
