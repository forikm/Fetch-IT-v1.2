"use client";
import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { useAppStore } from "@/lib/store";
export function OfflineStatus() {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  useVisiblePoll(offlineAccess ? "offline-account" : "", async () => {
    await useAppStore.getState().refreshUser().catch(() => {});
  }, 10000);
  useEffect(() => {
    const reconnect = () => { void useAppStore.getState().refreshUser().catch(() => {}); };
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    return () => { window.removeEventListener("online", reconnect); window.removeEventListener("focus", reconnect); };
  }, []);
  if (online && !offlineAccess) return null;
  return <div data-connection-banner role="status" className="fixed inset-x-0 top-0 z-[60] flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center border-b border-amber-300 bg-amber-50 px-4 pt-[env(safe-area-inset-top)] text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"><div className="mx-auto flex w-full max-w-5xl items-center gap-2"><WifiOff className="h-4 w-4 shrink-0" /><p><strong>{online ? "Reconnecting" : "Offline"}</strong> · Saved bookings and drafts only<span className="sr-only">. Connect to confirm a booking, get a current fare, or receive live updates.</span></p></div></div>;
}
