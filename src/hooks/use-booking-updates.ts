"use client";
import { createBookingNotifications, mergeBookingNotifications, type BookingNotification } from "@/lib/booking-notifications";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useCustomerData } from "@/hooks/use-customer-data";
import { statusLabel, type BookingStatus } from "@/lib/constants";
import { customerResponse } from "@/lib/customer-request";
import { saveSnapshot } from "@/lib/offline-data";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { isActiveBooking } from "@/lib/booking-status-query";

type Update = { id: string; refCode: string; status: BookingStatus; type: "RIDE" | "DELIVERY"; dropoffLabel?: string; updatedAt?: string };
export function useBookingUpdates<T extends Update>(userId: string, type: string, onUpdate: (bookings: T[]) => void) {
  const { toast } = useToast();
  const callback = useRef(onUpdate);
  const [preferences] = useCustomerData(userId, "notifications", { inApp: true, browser: false }, true);
  const preferenceRef = useRef(preferences);
  const [, saveInbox] = useCustomerData<BookingNotification[]>(userId, "notification-inbox-v2", [], true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const cache = useRef<T[] | null>(null);
  const baseline = useRef<Record<string, BookingStatus> | null>(null);
  const startedAt = useRef(new Date().toISOString());
  useEffect(() => { callback.current = onUpdate; preferenceRef.current = preferences; }, [onUpdate, preferences]);
  useEffect(() => {
    // Always establish a fresh session baseline; never replay history on login.
    cache.current = null;
    baseline.current = null;
    startedAt.current = new Date().toISOString();
  }, [userId, type]);
  useVisiblePoll(userId ? `${userId}:${type}` : "", async (signal) => {
      try {
        let bookings: T[];
        if (cache.current === null) {
          const response = await fetch("/api/bookings?filter=active", { cache: "no-store", signal });
          bookings = (await customerResponse<{ bookings: T[] }>(response, "Updates unavailable")).bookings;
        } else {
          const active = cache.current.filter((booking) => isActiveBooking(booking.status));
          const ids = active.map((booking) => booking.id).join(",");
          const response = await fetch(`/api/bookings/status?ids=${encodeURIComponent(ids)}`, { cache: "no-store", signal });
          const data = await customerResponse<{ bookings: (Partial<T> & Update)[] }>(response, "Updates unavailable");
          bookings = await Promise.all(data.bookings.map(async (patch) => {
            const previous = cache.current?.find((booking) => booking.id === patch.id);
            // Full details are needed only when a new booking enters the list.
            if (!previous) {
              const detail = await fetch(`/api/bookings/${encodeURIComponent(patch.id)}`, { cache: "no-store", signal });
              return (await customerResponse<{ booking: T }>(detail, "Booking unavailable")).booking;
            }
            return { ...previous, ...patch };
          }));
        }
        if (signal.aborted) return;
        const updates = createBookingNotifications(bookings, baseline.current, new Date().toISOString(), startedAt.current);
        if (updates.length) {
          saveInbox((previous) => mergeBookingNotifications(previous, updates));
          if (preferenceRef.current.inApp) toast({ title: updates.length > 1 ? "Booking updates" : "Booking update", description: updates.map((item) => item.refCode + " · " + statusLabel(item.status, item.type)).join("; ") });
          for (const item of updates) {
            if (preferenceRef.current.browser && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
              void navigator.serviceWorker.ready.then((registration) => registration.showNotification("Fetch-It booking update", { body: item.refCode + " · " + statusLabel(item.status, item.type), icon: "/fetch-icon-final-192.png", tag: item.bookingId, data: { url: "/" } })).catch(() => {});
            }
          }
        }
        baseline.current = { ...baseline.current, ...Object.fromEntries(bookings.map((booking) => [booking.id, booking.status])) };
        cache.current = bookings;
        for (const service of ["RIDE", "DELIVERY"]) saveSnapshot(userId, `/api/bookings?filter=active&type=${service}`, { bookings: bookings.filter(booking => booking.type === service && isActiveBooking(booking.status)), nextCursor: null });
        for (const booking of bookings) saveSnapshot(userId, `/api/bookings/${booking.id}`, { booking });
        callback.current(type === "ALL" ? bookings : bookings.filter((booking) => booking.type === type));
        setLastChecked(new Date()); setOffline(false);
        return bookings.some(booking => isActiveBooking(booking.status)) ? undefined : 30000;
      } catch (error) { if (!signal.aborted) setOffline(true); throw error; }
  });
  return { lastChecked, offline };
}
