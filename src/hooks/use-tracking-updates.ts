"use client";
import { useEffect, useRef } from "react";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { customerResponse } from "@/lib/customer-request";
import { isActiveBooking } from "@/lib/booking-status-query";

export function useTrackingUpdates<T extends { status: string }>(id: string, onUpdate: (booking: Partial<T>) => void) {
  const finished = useRef(false);
  useEffect(() => { finished.current = false; }, [id]);
  useVisiblePoll(id, async (signal) => {
    if (finished.current) return;
    const response = await fetch(`/api/bookings/status?onlyTracked=1&ids=${encodeURIComponent(id)}`, { cache: "no-store", signal });
    const data = await customerResponse<{ bookings: (Partial<T> & { status: string })[] }>(response, "Tracking unavailable");
    let booking = data.bookings[0];
    if (!booking || signal.aborted) return;
    const terminal = !isActiveBooking(booking.status);
    if (terminal) {
      // Show completion immediately; proof loading must not delay the status.
      onUpdate(booking);
      const detail = await fetch(`/api/bookings/${encodeURIComponent(id)}`, { cache: "no-store", signal });
      booking = (await customerResponse<{ booking: T }>(detail, "Booking unavailable")).booking;
    }
    if (signal.aborted) return;
    onUpdate(booking);
    finished.current = terminal;
  });
}
