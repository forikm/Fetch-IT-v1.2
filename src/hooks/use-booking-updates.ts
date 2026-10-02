"use client";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useCustomerData } from "@/hooks/use-customer-data";
import { statusLabel, type BookingStatus } from "@/lib/constants";
import { customerResponse } from "@/lib/customer-request";

type Update = { id: string; refCode: string; status: BookingStatus; type: "RIDE" | "DELIVERY" };
export function useBookingUpdates<T extends Update>(userId: string, type: string, onUpdate: (bookings: T[]) => void) {
  const { toast } = useToast();
  const callback = useRef(onUpdate);
  const [preferences] = useCustomerData(userId, "notifications", { inApp: true, browser: false }, true);
  const preferenceRef = useRef(preferences);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => { callback.current = onUpdate; preferenceRef.current = preferences; }, [onUpdate, preferences]);
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let running = false;
    let baseline: Map<string, BookingStatus> | null = null;
    async function poll() {
      if (running || stopped) return;
      running = true;
      try {
        const response = await fetch(`/api/bookings?filter=all&type=${type}`, { cache: "no-store" });
        const data = await customerResponse<{ bookings: T[] }>(response, "Updates unavailable");
        if (stopped || !Array.isArray(data.bookings)) return;
        for (const booking of data.bookings) {
          const previous = baseline?.get(booking.id);
          if (previous && previous !== booking.status) {
            const title = `${booking.refCode} · ${statusLabel(booking.status, booking.type)}`;
            if (preferenceRef.current.inApp) toast({ title: "Booking update", description: title });
            if (preferenceRef.current.browser && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
              void navigator.serviceWorker.ready.then((registration) => registration.showNotification("Fetch-It booking update", { body: title, icon: "/fetch-icon-final-192.png", tag: booking.id, data: { url: "/" } })).catch(() => {});
            }
          }
        }
        baseline = new Map(data.bookings.map((booking) => [booking.id, booking.status]));
        callback.current(data.bookings);
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
