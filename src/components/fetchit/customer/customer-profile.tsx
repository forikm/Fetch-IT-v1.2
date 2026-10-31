"use client";
import { useRef, useState } from "react";
import { Bookmark, HelpCircle, LogOut, Moon, Sun, Monitor } from "lucide-react";
import Link from "next/link";
import { useCustomerOverlayHistory } from "@/hooks/use-customer-overlay-history";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CustomerAppShell } from "../shared/customer-app-shell";
import { ProfileSettings } from "../shared/profile-settings";
import { NotificationSettings } from "../shared/notification-settings";
import { InstallPwaButton } from "../shared/install-pwa-button";
import { useCustomerAppearance } from "../shared/customer-appearance";

export function CustomerProfile() {
  const user = useAppStore(s => s.user);
  const [editing, setEditing] = useState(false);
  useCustomerOverlayHistory(editing, () => setEditing(false));
  const editTitle = useRef<HTMLHeadingElement>(null);
  const { theme, setTheme } = useCustomerAppearance();
  return <CustomerAppShell selected="profile" title="Profile">
    <section className="space-y-4 rounded-2xl border bg-card p-4">
      <div><h2 className="break-words text-xl font-semibold">{user?.name}</h2><p className="mt-1 break-all text-base text-muted-foreground">{user?.email}</p>{user?.phone && <p className="mt-1 text-base text-muted-foreground">{user.phone}</p>}</div>
      <Button type="button" variant="outline" onClick={() => setEditing(true)}>Edit profile</Button>
    </section>
    <section className="space-y-3" aria-labelledby="profile-preferences"><h2 id="profile-preferences" className="text-lg font-semibold">Preferences</h2>
      <Button type="button" variant="outline" className="w-full justify-start" onClick={() => useAppStore.getState().setView("onboarding")}><Bookmark />Saved places</Button>
      <div className="rounded-2xl border bg-card p-4"><label htmlFor="customer-theme" className="mb-2 flex items-center gap-2 text-base font-medium">{theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}Appearance</label><select id="customer-theme" value={theme} onChange={e => setTheme(e.target.value as "system" | "light" | "dark")} className="min-h-12 w-full rounded-xl border border-input bg-background px-3 text-base"><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
      <div className="rounded-2xl border bg-card p-4"><NotificationSettings /></div>
      <InstallPwaButton className="w-full justify-start" />
      <details className="text-sm text-muted-foreground"><summary className="min-h-12 cursor-pointer py-3">Install on iPhone or iPad</summary><p>Use Share → Add to Home Screen to install Fetch-It.</p></details>
    </section>
    <section className="space-y-3 border-t pt-5" aria-label="Account actions"><Button asChild variant="outline" className="w-full justify-start"><Link href="/help"><HelpCircle />Help &amp; Support</Link></Button><Button type="button" variant="ghost" className="w-full justify-start text-destructive" onClick={() => void useAppStore.getState().logout()}><LogOut />Log out</Button></section>
    <Dialog open={editing} onOpenChange={setEditing}><DialogContent onOpenAutoFocus={event => { event.preventDefault(); editTitle.current?.focus(); }}><DialogHeader><DialogTitle ref={editTitle} tabIndex={-1}>Edit profile</DialogTitle><DialogDescription>Update your name and phone number.</DialogDescription></DialogHeader><ProfileSettings showSavedPlaces={false} /></DialogContent></Dialog>
  </CustomerAppShell>;
}
