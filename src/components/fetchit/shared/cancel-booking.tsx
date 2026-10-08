"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { customerResponse } from "@/lib/customer-request";
const reasons = ["Booked by mistake", "Plans changed", "Waiting too long", "Wrong pickup or destination", "Other"];
export function CancelBooking({ bookingId, readOnly, onCancelled }: { bookingId: string; readOnly?: boolean; onCancelled: () => void }) {
  const online = useOnlineStatus();
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <>
    <Button size="sm" variant="outline" disabled={readOnly || !online} onClick={() => setOpen(true)}>Cancel booking</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending.current) setOpen(value); }}>
      <DialogContent><DialogHeader><DialogTitle>Cancel this booking?</DialogTitle><DialogDescription>Your rider will be notified. If payment is already recorded, contact support about a refund.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault();
          if (pending.current || readOnly || !online) return;
          pending.current = true; setBusy(true); setError("");
          try {
            await customerResponse(await fetch(`/api/bookings/${bookingId}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason === "Other" ? detail.trim() : reason }) }), "Cancellation failed. Please retry.");
            setOpen(false); onCancelled();
          } catch (error) { setError(error instanceof Error ? error.message : "Cancellation failed."); }
          finally { pending.current = false; setBusy(false); }
        }}>
          <label className="block text-sm space-y-2">Reason<select required value={reason} disabled={busy} onChange={event => setReason(event.target.value)} className="w-full rounded-md border bg-background p-3"><option value="">Choose a reason</option>{reasons.map(value => <option key={value}>{value}</option>)}</select></label>
          {reason === "Other" && <label className="block text-sm space-y-2">Tell us why<textarea required maxLength={500} disabled={busy} value={detail} onChange={event => setDetail(event.target.value)} className="w-full rounded-md border bg-background p-3" /></label>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Keep booking</Button><Button type="submit" variant="destructive" disabled={busy || !online || !reason || (reason === "Other" && !detail.trim())}>{busy ? "Cancelling…" : "Confirm cancellation"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
