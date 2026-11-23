"use client";

import { useCallback, useState } from "react";
import { useCustomerOverlayHistory } from "@/hooks/use-customer-overlay-history";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { customerResponse } from "@/lib/customer-request";
import { BookingRatingForm } from "./booking-rating-form";
import { SupportCenter } from "./support-center";
import { CustomerPaymentCard } from "./customer-payment-card";
import { customerPaymentVisible } from "@/lib/payment-policy";

export function BookingActions({ booking, readOnly = false, completionReminder = false, onRated }: {
  readOnly?: boolean;
  completionReminder?: boolean;
  onRated?: () => void;
  booking: { id: string; refCode: string; type?: "RIDE" | "DELIVERY"; status: string; riderId: string | null; customerDropoffConfirmedAt?: string | null };
}) {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const unavailable = readOnly || !online || offlineAccess;
  const showPayment = customerPaymentVisible(booking.type, booking.status, booking.customerDropoffConfirmedAt);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"review" | "help" | null>(null);
  const [rated, setRated] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const markRated = useCallback(() => setRated(true), []);
  function closeDialog() {
    setDialog(null);
    if (rated) onRated?.();
  }
  useCustomerOverlayHistory(!!dialog, closeDialog);

  async function downloadReceipt() {
    setDownloading(true);
    setReceiptError("");
    try {
      const response = await fetch("/api/bookings/" + booking.id + "/receipt", { cache: "no-store" });
      if (!response.ok) { await customerResponse(response, "Your receipt couldn’t download. Try again."); return; }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "fetchit-" + booking.refCode + ".pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setReceiptError("Your receipt couldn’t download. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  return <>
    {completionReminder ? <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">Rate booking {booking.refCode} before making a new booking.</p>
      <div className="flex flex-wrap gap-2">
        {booking.type === "DELIVERY" && <Button type="button" variant="outline" disabled={unavailable} onClick={() => useAppStore.getState().openBookingSummary(booking.id, "delivery")}>Review delivery</Button>}
        <Button type="button" variant="outline" disabled={unavailable} onClick={() => setDialog("review")}>Rate booking</Button>
      </div>
    </section> : <>
      {showPayment && <CustomerPaymentCard key={booking.id} bookingId={booking.id} type={booking.type} readOnly={unavailable} onPaymentStatus={setPaymentStatus} />}
      <div className="flex flex-wrap gap-2 border-t pt-2">
        {showPayment && paymentStatus === "PAID" && <Button type="button" size="sm" variant="ghost" disabled={unavailable || downloading} onClick={() => void downloadReceipt()}>
          {downloading ? "Downloading receipt…" : receiptError ? "Retry receipt download" : "Download PDF receipt"}
        </Button>}
        {booking.status === "DELIVERED" && booking.riderId && <Button type="button" size="sm" variant="ghost" disabled={unavailable} onClick={() => setDialog("review")}>Rate {booking.type === "RIDE" ? "driver" : "rider"}</Button>}
        <Button type="button" size="sm" variant="ghost" disabled={unavailable} onClick={() => setDialog("help")}>Get help</Button>
      </div>
      {receiptError && <p role="alert" className="text-xs text-destructive">{receiptError}</p>}
    </>}
    <Dialog open={!!dialog} onOpenChange={open => { if (!open) closeDialog(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialog === "review" ? (booking.type === "RIDE" ? "Rate your driver" : "Rate your rider") : "Booking help"}</DialogTitle>
          <DialogDescription>{booking.refCode} · {dialog === "review" ? "Tell us how your completed booking went." : "Send a request or continue a conversation with Fetch-It Support."}</DialogDescription>
        </DialogHeader>
        {dialog === "review" && <BookingRatingForm key={booking.id} bookingId={booking.id} unavailable={unavailable} onRated={markRated} />}
        {dialog === "review" && rated && <Button type="button" variant="outline" onClick={closeDialog}>Done</Button>}
        {dialog === "help" && <SupportCenter key={booking.id} booking={booking} />}
      </DialogContent>
    </Dialog>
  </>;
}
