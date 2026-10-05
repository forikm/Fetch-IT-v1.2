"use client";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { saveOfflineCustomer } from "@/lib/offline-data";
import { useState } from "react";
import { useAppStore, type AuthUser } from "@/lib/store";
import { customerResponse } from "@/lib/customer-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizePhilippinePhone } from "@/lib/phone";

export function ProfileSettings() {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const user = useAppStore((s) => s.user);
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  return <form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); if (busy || !navigator.onLine || offlineAccess) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone: normalizePhilippinePhone(phone) }) });
      const data = await customerResponse<{ user: AuthUser }>(response, "We couldn’t save your profile. Please retry.");
      useAppStore.setState((state) => ({ user: state.user ? { ...state.user, ...data.user } : null }));
      if (data.user.role === "CUSTOMER") saveOfflineCustomer({ ...data.user, role: "CUSTOMER" });
      setPhone(data.user.phone ?? "");
      setFailed(false); setMessage("Profile saved.");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Couldn’t save your profile."); }
    finally { setBusy(false); }
  }}>
    <div className="space-y-2"><Label htmlFor="profile-name">Name</Label><Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required autoComplete="name" /></div>
    <div className="space-y-2"><Label htmlFor="profile-phone">Phone number</Label><Input id="profile-phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} autoComplete="tel" placeholder="+63 917 123 4567" /><p className="text-xs text-muted-foreground">Philippine number required (+63).</p></div>
    <p className="text-sm text-muted-foreground">Email: {user?.email}</p>
    {message && <p role="status" className={failed ? "text-sm text-destructive" : "text-sm text-emerald-700"}>{message}</p>}
    <Button type="submit" disabled={busy || !online || offlineAccess}>{busy ? "Saving…" : "Save profile"}</Button>
  </form>;
}
