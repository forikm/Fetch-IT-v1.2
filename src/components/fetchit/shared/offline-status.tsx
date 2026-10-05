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
  return <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"><div className="mx-auto flex max-w-7xl items-start gap-2"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Offline mode.</strong> You can view saved bookings and edit drafts. Connect to confirm a booking, get a current fare, or receive live updates.</p></div></div>;
}
