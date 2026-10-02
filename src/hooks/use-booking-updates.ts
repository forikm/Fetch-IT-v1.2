"use client";
import { createBookingNotifications, mergeBookingNotifications, type BookingNotification } from "@/lib/booking-notifications";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useCustomerData } from "@/hooks/use-customer-data";
import { statusLabel, type BookingStatus } from "@/lib/constants";
import { customerResponse } from "@/lib/customer-request";

type Update = { id: string; refCode: string; status: BookingStatus; type: "RIDE" | "DELIVERY"; dropoffLabel?: string; updatedAt?: string };
export function useBookingUpdates<T extends Update>(userId: string, type: string, onUpdate: (bookings: T[]) => void) {
  const { toast } = useToast();
  const callback = useRef(onUpdate);
  const [preferences] = useCustomerData(userId, "notifications", { inApp: true, browser: false }, true);
  const preferenceRef = useRef(preferences);
  const [snapshots, saveSnapshots] = useCustomerData<Record<string, BookingStatus> | null>(userId, "booking-statuses", null, true);
  const snapshotRef = useRef(snapshots);
  const [, saveInbox] = useCustomerData<BookingNotification[]>(userId, "notification-inbox", [], true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => { callback.current = onUpdate; preferenceRef.current = preferences; snapshotRef.current = snapshots; }, [onUpdate, preferences, snapshots]);
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let running = false;
    let baseline: Record<string, BookingStatus> | null = snapshotRef.current;
    async function poll() {
      if (running || stopped) return;
      running = true;
      try {
        const response = await fetch("/api/bookings?filter=all", { cache: "no-store" });
        const data = await customerResponse<{ bookings: T[] }>(response, "Updates unavailable");
        if (stopped || !Array.isArray(data.bookings)) return;
        const updates = createBookingNotifications(data.bookings, baseline ?? snapshotRef.current, new Date().toISOString());
        if (updates.length) {
          saveInbox((previous) => mergeBookingNotifications(previous, updates));
          if (preferenceRef.current.inApp) toast({ title: updates.length > 1 ? "Booking updates" : "Booking update", description: updates.map((item) => item.refCode + " · " + statusLabel(item.status, item.type)).join("; ") });
          for (const item of updates) {
            if (preferenceRef.current.browser && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
              void navigator.serviceWorker.ready.then((registration) => registration.showNotification("Fetch-It booking update", { body: item.refCode + " · " + statusLabel(item.status, item.type), icon: "/fetch-icon-final-192.png", tag: item.bookingId, data: { url: "/" } })).catch(() => {});
            }
          }
        }
        baseline = Object.fromEntries(data.bookings.map((booking) => [booking.id, booking.status]));
        saveSnapshots(baseline);
        callback.current(type === "ALL" ? data.bookings : data.bookings.filter((booking) => booking.type === type));
        setLastChecked(new Date()); setOffline(false);
      } catch { if (!stopped) setOffline(true); }
      finally { running = false; }
    }
    void poll();
    const timer = setInterval(() => void poll(), 15000);
    const refresh = () => void poll();
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
  }, [userId, type, toast]);
  return { lastChecked, offline };
}
