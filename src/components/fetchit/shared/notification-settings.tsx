"use client";
import { useState } from "react";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useAppStore } from "@/lib/store";
import { enableCustomerPush, disableCustomerPush } from "@/lib/customer-push";
import { Button } from "@/components/ui/button";

export function NotificationSettings() {
  const id = useAppStore((s) => s.user?.id ?? "anonymous");
  const [preferences, save] = useCustomerData(id, "notifications", { inApp: true, browser: false }, true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <section className="space-y-3">
    <h3 className="text-base font-semibold">Notifications</h3>
    <label className="flex min-h-12 cursor-pointer items-center gap-3 text-base"><input className="h-5 w-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" type="checkbox" checked={preferences.inApp} onChange={(e) => save({ ...preferences, inApp: e.target.checked })} /> Show updates in the app</label>
    <p className="text-sm text-muted-foreground">Background alerts notify you when Fetch-It is closed.</p>
    <Button size="sm" type="button" variant="outline" disabled={busy || id === "anonymous"} onClick={async () => {
      setBusy(true); setMessage("");
      try {
        if (preferences.browser) await disableCustomerPush(); else await enableCustomerPush(id);
        save(previous => ({ ...previous, browser: !preferences.browser }));
        setMessage(preferences.browser ? "Background alerts turned off on this device." : "Background alerts enabled for bookings and support replies.");
      } catch (error) { setMessage((error as Error).message); }
      finally { setBusy(false); }
    }}>{busy ? "Updating…" : preferences.browser ? "Turn off background alerts" : "Enable background alerts"}</Button>
    <details className="text-sm text-muted-foreground"><summary className="min-h-12 cursor-pointer py-3">Help with background alerts</summary><p>Allow notifications when prompted. On iPhone or iPad, add Fetch-It to your Home Screen, then open it there to enable alerts.</p></details>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
