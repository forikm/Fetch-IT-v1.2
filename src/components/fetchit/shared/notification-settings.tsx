"use client";
import { useState } from "react";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

export function NotificationSettings() {
  const id = useAppStore((s) => s.user?.id ?? "anonymous");
  const [preferences, save] = useCustomerData(id, "notifications", { inApp: true, browser: false }, true);
  const [message, setMessage] = useState("");
  return <section className="space-y-3 border-t pt-4">
    <h3 className="text-sm font-semibold">Booking notifications</h3>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preferences.inApp} onChange={(e) => save({ ...preferences, inApp: e.target.checked })} /> Show updates in the app</label>
    <Button size="sm" type="button" variant="outline" onClick={async () => {
      if (preferences.browser) { save({ ...preferences, browser: false }); return; }
      if (!("Notification" in window)) { setMessage("This browser does not support alerts."); return; }
      const permission = await Notification.requestPermission();
      save({ ...preferences, browser: permission === "granted" });
      setMessage(permission === "granted" ? "Browser alerts enabled." : "Alerts weren’t enabled. You can change permissions in your browser settings.");
    }}>{preferences.browser ? "Turn off browser alerts" : "Enable browser alerts"}</Button>
    <p className="text-xs text-muted-foreground">Status updates refresh while the app is open. Browser alerts require permission; they do not run after you close the app.</p>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
