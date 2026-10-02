"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { customerResponse } from "@/lib/customer-request";

type Ticket = { id: string; category: string; message: string; status: string; adminReply: string | null; createdAt: string };
type Review = { rating: number; comment: string | null };
export function BookingActions({ booking }: { booking: { id: string; refCode: string; status: string; riderId: string | null } }) {
  const [dialog, setDialog] = useState<"review" | "help" | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [category, setCategory] = useState("BOOKING");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  async function open(kind: "review" | "help") {
    setDialog(kind); setError(""); setNotice(""); setLoaded(false); setBusy(true);
    try {
      if (kind === "review") {
        const data = await customerResponse<{ review: Review | null }>(await fetch(`/api/bookings/${booking.id}/review`, { cache: "no-store" }), "Couldn’t load your review. Please retry.");
        setReview(data.review);
      } else {
        const data = await customerResponse<{ tickets: Ticket[] }>(await fetch(`/api/support?bookingId=${booking.id}`, { cache: "no-store" }), "Couldn’t load your help requests. Please retry.");
        setTickets(data.tickets);
      }
      setLoaded(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Service unavailable."); }
    finally { setBusy(false); }
  }
  return <>
    <div className="flex flex-wrap gap-2 pt-2 border-t">
      <Button type="button" size="sm" variant="ghost" onClick={async () => {
        setError("");
        try {
          const response = await fetch(`/api/bookings/${booking.id}/receipt`, { cache: "no-store" });
          if (!response.ok) { await customerResponse(response, "Couldn’t download your receipt. Please retry."); return; }
          const url = URL.createObjectURL(await response.blob());
          const link = document.createElement("a"); link.href = url; link.download = `fetchit-${booking.refCode}.txt`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { setError("Couldn’t download your receipt. Please retry."); }
      }}>Download receipt</Button>
      {booking.status === "DELIVERED" && booking.riderId && <Button type="button" size="sm" variant="ghost" onClick={() => void open("review")}>Rate rider</Button>}
      <Button type="button" size="sm" variant="ghost" onClick={() => void open("help")}>Get help</Button>
    </div>
    {!dialog && error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{dialog === "review" ? "Rate your rider" : "Booking help"}</DialogTitle><DialogDescription>{booking.refCode} · {dialog === "review" ? "Tell us how your completed booking went." : "Send a request to the Fetch-It support inbox. Check here for a reply."}</DialogDescription></DialogHeader>
        {error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p>{!loaded && <Button disabled={busy} onClick={() => dialog && void open(dialog)} variant="outline">Try again</Button>}</div>}
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        {busy && !loaded && <p className="text-sm text-muted-foreground">Loading…</p>}
        {loaded && dialog === "review" && (review ? <div className="rounded-xl bg-muted p-4"><p className="font-medium">Your rating: {review.rating}/5</p><p className="text-sm whitespace-pre-wrap break-words">{review.comment}</p></div> : <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault(); if (busy) return; setBusy(true); setError("");
          try {
            const data = await customerResponse<{ review: Review }>(await fetch(`/api/bookings/${booking.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, comment }) }), "Couldn’t submit your rating. Your comment is kept; please retry.");
            setReview(data.review); setNotice("Thanks — your rating was saved.");
          } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save your rating."); }
          finally { setBusy(false); }
        }}>
          <fieldset><legend className="text-sm font-medium mb-2">Choose a rating</legend><div className="flex gap-2">{[1, 2, 3, 4, 5].map((star) => <button key={star} type="button" aria-label={`${star} star${star === 1 ? "" : "s"}`} aria-pressed={rating === star} onClick={() => setRating(star)} className={`text-3xl ${star <= rating ? "text-amber-500" : "text-muted-foreground"}`}>★</button>)}</div></fieldset>
          <div className="space-y-2"><Label htmlFor="review-comment">Comment (optional)</Label><Textarea id="review-comment" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <Button disabled={busy} type="submit">{busy ? "Submitting…" : "Submit rating"}</Button>
        </form>)}
        {loaded && dialog === "help" && <>
          {tickets.map((ticket) => <div key={ticket.id} className="rounded-xl border p-3 space-y-2 text-sm"><p className="font-medium">{ticket.category.replaceAll("_", " ")} · {ticket.status}</p><p className="text-xs text-muted-foreground">{new Date(ticket.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{ticket.message}</p>{ticket.adminReply && <p className="rounded-lg bg-muted p-3 whitespace-pre-wrap break-words"><strong>Support reply: </strong>{ticket.adminReply}</p>}</div>)}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void open("help")}>Refresh replies</Button>
          <form className="space-y-3" onSubmit={async (event) => {
            event.preventDefault(); if (busy) return; setBusy(true); setError("");
            try {
              const data = await customerResponse<{ ticket: Ticket }>(await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: booking.id, category, message }) }), "Couldn’t send your request. Your message is kept; please retry.");
              setTickets((previous) => [data.ticket, ...previous.filter((ticket) => ticket.id !== data.ticket.id)]); setMessage(""); setNotice("Request saved in the support inbox. Check here for updates.");
            } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t submit your request."); }
            finally { setBusy(false); }
          }}>
            <div className="space-y-2"><Label htmlFor="help-category">What do you need help with?</Label><select id="help-category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-10 border rounded-lg bg-background px-3 text-sm">{["BOOKING", "FARE", "RIDER", "LOST_ITEM", "OTHER"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="help-message">Describe the issue</Label><Textarea id="help-message" minLength={10} maxLength={2000} required value={message} onChange={(e) => setMessage(e.target.value)} /></div>
            <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send help request"}</Button>
          </form>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
