"use client";

import { useCallback, useRef, useState } from "react";
import { isActiveBooking } from "@/lib/booking-status-query";

export type RatingBooking = {
  id: string;
  refCode: string;
  type?: "RIDE" | "DELIVERY";
  status: string;
  riderId: string | null;
};

export function useCompletedBookingRatings() {
  const statuses = useRef(new Map<string, string>());
  const prompted = useRef(new Set<string>());
  const [queue, setQueue] = useState<RatingBooking[]>([]);
  const observeRatings = useCallback((bookings: RatingBooking[]) => {
    const completed: RatingBooking[] = [];
    for (const booking of bookings) {
      const previous = statuses.current.get(booking.id);
      statuses.current.set(booking.id, booking.status);
      // History establishes a baseline; only a newly completed trip prompts.
      if (previous && isActiveBooking(previous) && booking.status === "DELIVERED" && booking.riderId && !prompted.current.has(booking.id)) {
        prompted.current.add(booking.id);
        completed.push(booking);
      }
    }
    if (completed.length) setQueue(current => [...current, ...completed]);
  }, []);
  const dismissRating = useCallback(() => setQueue(current => current.slice(1)), []);
  return { ratingBooking: queue[0] ?? null, observeRatings, dismissRating };
}
