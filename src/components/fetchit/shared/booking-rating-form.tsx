"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { customerResponse } from "@/lib/customer-request";

type Review = { rating: number; comment: string | null };

export function BookingRatingForm({ bookingId, unavailable, onRated }: {
  bookingId: string;
  unavailable?: boolean;
  onRated?: () => void;
}) {
  const commentId = useId();
  const [review, setReview] = useState<Review | null | undefined>();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const url = "/api/bookings/" + encodeURIComponent(bookingId) + "/review";

  useEffect(() => {
    if (unavailable) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const data = await customerResponse<{ review: Review | null }>(response, "Couldn’t load your rating. Please retry.");
        if (controller.signal.aborted) return;
        setReview(data.review);
        if (data.review) onRated?.();
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Couldn’t load your rating.");
      }
    }
    void load();
    return () => controller.abort();
  }, [url, unavailable, onRated, reload]);

  async function submit() {
    if (submitting.current || unavailable || rating < 1 || rating > 5) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment }), signal: AbortSignal.timeout(15000),
      });
      const data = response.status === 409
        ? await customerResponse<{ review: Review | null }>(await fetch(url, { cache: "no-store" }), "Couldn’t load your saved rating.")
        : await customerResponse<{ review: Review }>(response, "Couldn’t submit your rating. Please retry.");
      if (!data.review) throw new Error("Couldn’t save your rating. Please retry.");
      setReview(data.review);
      onRated?.();
    } catch (error) {
      setError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Couldn’t save your rating. Please retry.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (unavailable) return <p role="status" className="text-sm">Reconnect to rate this booking.</p>;
  if (review) return <div role="status" className="rounded-xl bg-muted p-4"><p className="font-medium">Your rating: {review.rating}/5</p><p className="whitespace-pre-wrap break-words text-sm">{review.comment}</p></div>;
  if (review === undefined) return error
    ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" onClick={() => { setError(""); setReload(value => value + 1); }}>Try again</Button></div>
    : <p role="status" className="text-sm text-muted-foreground">Loading rating…</p>;

  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); return submit(); }}>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <fieldset disabled={busy}>
      <legend className="text-sm font-medium">Choose a rating</legend>
      <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5].map(star => <button key={star} type="button" aria-label={star + (star === 1 ? " star" : " stars")} aria-pressed={rating === star} onClick={() => setRating(star)} className={"min-h-12 min-w-12 rounded-md text-3xl focus-visible:outline-2 focus-visible:outline-ring " + (star <= rating ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>★</button>)}</div>
      <p role="status" className="mt-2 text-sm text-muted-foreground">{rating ? rating + " out of 5 stars selected" : "No rating selected"}</p>
    </fieldset>
    <div className="space-y-2"><Label htmlFor={commentId}>Comment (optional)</Label><Textarea id={commentId} maxLength={1000} value={comment} disabled={busy} onChange={event => setComment(event.target.value)} /></div>
    <Button type="submit" disabled={busy || rating === 0}>{busy ? "Submitting…" : "Submit rating"}</Button>
  </form>;
}
