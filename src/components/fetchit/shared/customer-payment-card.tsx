"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/customer-booking-ui";
import type { BookingType } from "@/lib/constants";
import { PAYMENT_METHOD_LABEL, cashConfirmationAvailable, isDemoPayment, type PaymentMethod, type PaymentStatus } from "@/lib/payment-policy";

type CustomerPayment = {
  type?: string; dropoffReachedAt?: string | null; paymentMethod: PaymentMethod; paymentStatus: PaymentStatus; status: string; totalFare: number;
  customerPaidAmount: number | null; riderReceivedAmount: number | null;
  customerPaidAt: string | null; riderReceivedAt: string | null; paidAt: string | null; paymentReference: string | null;
};

/** Customer-facing payment details. Rider earnings and payout records stay in the rider app. */
export function CustomerPaymentCard({ bookingId, readOnly = false, type = "DELIVERY", onPaymentStatus }: { bookingId: string; readOnly?: boolean; type?: BookingType; onPaymentStatus?: (status: string) => void }) {
  const person = type === "RIDE" ? "driver" : "rider";
  const [booking, setBooking] = useState<CustomerPayment | null>(null);
  const [amount, setAmount] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  const initialized = useRef(false);
  const version = useRef(0);

  useEffect(() => { onPaymentStatus?.(booking?.paymentStatus ?? ""); }, [booking?.paymentStatus, onPaymentStatus]);

  useEffect(() => {
    if (readOnly) return;
    const controller = new AbortController();
    let refreshing = false;
    async function refresh() {
      if (document.hidden || !navigator.onLine || pending.current || refreshing) return;
      refreshing = true;
      const requestVersion = version.current;
      try {
        const response = await fetch(`/api/bookings/${bookingId}/payment`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Payment details unavailable.");
        if (!controller.signal.aborted && !pending.current && requestVersion === version.current) {
          setBooking(data.booking); setError("");
          if (!initialized.current) { setAmount(Number(data.booking.totalFare).toFixed(2)); initialized.current = true; }
        }
      } catch (failure) { if (!controller.signal.aborted && requestVersion === version.current) setError(failure instanceof Error ? failure.message : "Payment details unavailable."); }
      finally { refreshing = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [bookingId, readOnly, retry]);

  if (readOnly) return <p className="text-sm text-muted-foreground">Reconnect to view payment details.</p>;
  const demo = !!booking && isDemoPayment(booking.paymentMethod);
  const canCheckout = demo && booking && ["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status) && !["PAID", "REFUNDED"].includes(booking.paymentStatus);
  const collectionAvailable = booking && cashConfirmationAvailable(booking.type ?? type, booking.status, booking.dropoffReachedAt);
  const canConfirm = booking && booking.paymentMethod === "CASH" && collectionAvailable && !booking.customerPaidAt && booking.paymentStatus !== "REFUNDED";
  const mismatch = booking && booking.customerPaidAmount !== null && booking.riderReceivedAmount !== null && (booking.customerPaidAmount !== booking.riderReceivedAmount || booking.customerPaidAmount !== booking.totalFare);
  const paymentLabel = !booking ? "Loading…" : booking.paymentStatus === "PAID" ? "Paid" : booking.paymentStatus === "REFUNDED" ? "Refunded" : booking.paymentStatus === "FAILED" ? "Payment failed" : mismatch ? "Needs review" : booking.customerPaidAt ? `You confirmed payment. Waiting for your ${person} to confirm receipt.` : booking.status === "CANCELLED" ? "Booking cancelled" : booking.paymentMethod === "CASH" && type === "DELIVERY" && !collectionAvailable ? "Pay at drop-off. Waiting for the rider to confirm arrival." : booking.paymentStatus === "PENDING" ? "Payment confirmation is pending" : booking.paymentMethod === "CASH" ? `Pay your ${person} in cash` : "Payment needed";

  return <section className="space-y-3 rounded-xl border p-4 text-sm" aria-label="Payment">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{booking ? PAYMENT_METHOD_LABEL[booking.paymentMethod] + (demo ? " (test payment)" : "") : "Payment"}</h3>{booking && <strong>{formatPeso(Number(booking.totalFare))}</strong>}</div>
    <p className="text-muted-foreground" role="status">{paymentLabel}</p>
    {demo && <p className="text-xs text-muted-foreground">Test payment. No money is charged.</p>}
    {booking?.customerPaidAt && !demo && <p>You confirmed {formatPeso(Number(booking.customerPaidAmount))} in cash.</p>}
    {booking?.paidAt && <p className="text-xs text-muted-foreground">Paid {new Date(booking.paidAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (PH time)</p>}
    {booking?.paymentReference && <p className="break-all text-xs text-muted-foreground">Payment reference: {booking.paymentReference}</p>}
    {mismatch && <p role="alert" className="text-amber-700">The cash confirmations do not match the fare. Contact support for a review.</p>}
    {canCheckout && <Button size="sm" disabled={busy} onClick={async () => {
      if (pending.current) return;
      pending.current = true; version.current++; setBusy(true); setError("");
      try {
        const response = await fetch(`/api/bookings/${bookingId}/demo-checkout`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Payment could not be opened.");
        window.location.assign(data.checkoutUrl);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Reconnect to open payment."); }
      finally { pending.current = false; setBusy(false); }
    }}>{busy ? "Opening…" : "Continue to payment"}</Button>}
    {canConfirm && !confirmOpen && <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>Confirm cash payment</Button>}
    {canConfirm && confirmOpen && <form className="space-y-3 border-t pt-3" onSubmit={async event => {
      event.preventDefault();
      if (pending.current) return;
      if (!navigator.onLine) { setError("Reconnect to confirm payment."); return; }
      pending.current = true; version.current++; setBusy(true); setError(""); setNotice("");
      try {
        const response = await fetch(`/api/bookings/${bookingId}/payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Couldn’t confirm payment.");
        setBooking(data.booking); setConfirmOpen(false); setNotice("Your cash confirmation was saved.");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn’t confirm payment."); }
      finally { pending.current = false; setBusy(false); }
    }}>
      <label className="block">Amount you paid (₱)<input required type="number" min="0.01" step="0.01" max="9999999999.99" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} className="mt-2 w-full rounded-md border bg-background p-2" /></label>
      <p className="text-xs text-muted-foreground">Confirm after handing the cash to your {person}. They’ll confirm receipt too.</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy || !amount}>{busy ? "Confirming…" : "I paid this amount"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>Not yet</Button></div>
    </form>}
    {notice && <p role="status">{notice}</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-destructive">{error}</p><Button type="button" size="sm" variant="outline" onClick={() => setRetry(previous => previous + 1)}>Retry payment details</Button></div>}
  </section>;
}
