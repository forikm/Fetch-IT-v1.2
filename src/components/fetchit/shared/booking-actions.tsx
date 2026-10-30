"use client";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAppStore } from "@/lib/store";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { customerResponse } from "@/lib/customer-request";
import { SupportCenter } from "./support-center";
import { CustomerPaymentCard } from "./customer-payment-card";

type Review = { rating: number; comment: string | null };
export function BookingActions({ booking, readOnly = false, ratingPrompt = false, onRatingPromptClosed }: { ratingPrompt?: boolean; onRatingPromptClosed?: () => void; readOnly?: boolean; booking: { id: string; refCode: string; type?: "RIDE" | "DELIVERY"; status: string; riderId: string | null } }) {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const unavailable = readOnly || !online || offlineAccess;
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"review" | "help" | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [rating, setRating] = useState(0);
  const submitting = useRef(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [receiptFailed, setReceiptFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!ratingPrompt || unavailable) return;
    const controller = new AbortController();
    let started = false;
    const otherDialogOpen = () => typeof document !== "undefined" && !!document.querySelector('[role="dialog"][data-state="open"]');
    const check = async () => {
      if (started || controller.signal.aborted || otherDialogOpen()) return;
      started = true;
      try {
        const response = await fetch("/api/bookings/" + encodeURIComponent(booking.id) + "/review", { cache: "no-store", signal: controller.signal });
        const data = await customerResponse<{ review: Review | null }>(response, "Couldn’t load your rating. Please retry.");
        if (controller.signal.aborted) return;
        if (data.review) { onRatingPromptClosed?.(); return; }
        if (otherDialogOpen()) { started = false; return; }
        setLoaded(true); setDialog("review");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (otherDialogOpen()) { started = false; return; }
        setLoaded(false); setDialog("review");
        setError(error instanceof Error ? error.message : "Couldn’t load your rating.");
      }
    };
    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(() => { void check(); }) : null;
    if (typeof document !== "undefined") observer?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    void check();
    return () => { controller.abort(); observer?.disconnect(); };
  }, [booking.id, ratingPrompt, unavailable, onRatingPromptClosed]);
  function closeDialog() {
    if (submitting.current) return;
    setDialog(null);
    if (ratingPrompt) onRatingPromptClosed?.();
  }
  async function open(kind: "review" | "help") {
    setDialog(kind); setError(""); setNotice(""); setLoaded(false); setBusy(true);
    try {
      if (kind === "review") {
        const data = await customerResponse<{ review: Review | null }>(await fetch(`/api/bookings/${booking.id}/review`, { cache: "no-store" }), "Couldn’t load your review. Please retry.");
        setReview(data.review);
      }
      setLoaded(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Service unavailable."); }
    finally { setBusy(false); }
  }
  return <>
    {!ratingPrompt && <>
    <CustomerPaymentCard key={booking.id} bookingId={booking.id} type={booking.type} readOnly={unavailable} onPaymentStatus={setPaymentStatus} />
    <div className="flex flex-wrap gap-2 pt-2 border-t">
      {paymentStatus === "PAID" && <Button type="button" size="sm" variant="ghost" disabled={unavailable || downloading} onClick={async () => {
        setDownloading(true); setReceiptFailed(false); setError("");
        try {
          const response = await fetch(`/api/bookings/${booking.id}/receipt`, { cache: "no-store" });
          if (!response.ok) { await customerResponse(response, "Your receipt couldn’t download. Try again."); return; }
          const url = URL.createObjectURL(await response.blob());
          const link = document.createElement("a"); link.href = url; link.download = `fetchit-${booking.refCode}.pdf`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { setReceiptFailed(true); setError("Your receipt couldn’t download. Try again."); }
        finally { setDownloading(false); }
      }}>{downloading ? "Downloading receipt…" : receiptFailed ? "Retry receipt download" : "Download PDF receipt"}</Button>}
      {booking.status === "DELIVERED" && booking.riderId && <Button type="button" size="sm" variant="ghost" disabled={unavailable} onClick={() => void open("review")}>Rate {booking.type === "RIDE" ? "driver" : "rider"}</Button>}
      <Button type="button" size="sm" variant="ghost" disabled={unavailable} onClick={() => void open("help")}>Get help</Button>
    </div>
    {!dialog && error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </>}
    <Dialog open={!!dialog} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{dialog === "review" ? `Rate your ${booking.type === "RIDE" ? "driver" : "rider"}` : "Booking help"}</DialogTitle><DialogDescription>{booking.refCode} · {dialog === "review" ? "Tell us how your completed booking went." : "Send a request or continue a conversation with Fetch-It support."}</DialogDescription></DialogHeader>
        {error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p>{!loaded && <Button disabled={busy} onClick={() => dialog && void open(dialog)} variant="outline">Try again</Button>}</div>}
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        {busy && !loaded && <p className="text-sm text-muted-foreground">Loading…</p>}
        {loaded && dialog === "review" && (review ? <div className="rounded-xl bg-muted p-4"><p className="font-medium">Your rating: {review.rating}/5</p><p className="text-sm whitespace-pre-wrap break-words">{review.comment}</p><Button type="button" variant="outline" onClick={closeDialog}>Done</Button></div> : <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault(); if (submitting.current || busy || unavailable || rating < 1 || rating > 5) return; submitting.current = true; setBusy(true); setError("");
          try {
            const data = await customerResponse<{ review: Review }>(await fetch(`/api/bookings/${booking.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, comment }) }), "Couldn’t submit your rating. Your comment is kept; please retry.");
            setReview(data.review); setNotice("Thanks — your rating was saved.");
          } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save your rating."); }
          finally { submitting.current = false; setBusy(false); }
        }}>
          <fieldset disabled={busy || unavailable}><legend className="text-sm font-medium mb-2">Choose a rating</legend><div className="flex gap-2">{[1, 2, 3, 4, 5].map((star) => <button key={star} type="button" aria-label={`${star} star${star === 1 ? "" : "s"}`} aria-pressed={rating === star} onClick={() => setRating(star)} className={`min-h-11 min-w-11 rounded-md text-3xl focus-visible:outline-2 focus-visible:outline-ring ${star <= rating ? "text-amber-500" : "text-muted-foreground"}`}>★</button>)}</div></fieldset>
          <div className="space-y-2"><Label htmlFor="review-comment">Comment (optional)</Label><Textarea id="review-comment" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <Button disabled={busy || unavailable || rating === 0} type="submit">{busy ? "Submitting…" : "Submit rating"}</Button>
        </form>)}
        {ratingPrompt && !review && <Button type="button" variant="ghost" disabled={busy} onClick={closeDialog}>Not now</Button>}
        {loaded && dialog === "help" && <SupportCenter key={booking.id} booking={booking} />}
      </DialogContent>
    </Dialog>
  </>;
}
