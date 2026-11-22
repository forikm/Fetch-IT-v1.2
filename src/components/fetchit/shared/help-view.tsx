"use client";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { BrandNavigation } from "./brand-navigation";
import { NotificationInbox } from "./notification-inbox";
import { SupportCenter } from "./support-center";
import { SupportContact } from "./support-contact";
import { Button } from "@/components/ui/button";
import { CustomerAppShell } from "./customer-app-shell";

const faqs = [
  ["Report a booking issue", "Choose New request, select Ride or Delivery, and link the booking. Choose Account or app for help without a booking."],
  ["Report a driver or rider concern", "Choose Ride or Delivery, then Issue with the rider. You can also open the booking and select Get help to link it."],
  ["Track a ride or delivery", "Open the active booking to track it. The map updates once the driver or rider shares their location."],
  ["Cancel or change a booking", "Use Cancel booking on the booking when available. For help with a change, send a request under Cancellation or booking changes. The request itself leaves the booking in place."],
  ["Question a fare or payment", "Choose Fare, payment, or refund. Include the fare shown, the amount paid, and how you paid."],
  ["Find an item left on a ride", "Choose Ride, then I left an item behind. Describe the item and where you last saw it."],
  ["Read or reply to support", "Open a conversation under Your requests or from the notification bell. Replying to a resolved request reopens it."],
];

export function HelpView({ ticketId, startMessage = false }: { ticketId?: string; startMessage?: boolean }) {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const router = useRouter();
  const { user, bootstrapped, bootstrap, setView } = useAppStore();
  useEffect(() => { if (!bootstrapped) void bootstrap(); }, [bootstrapped, bootstrap]);
  const customer = user?.role === "CUSTOMER";
  const recovery = <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Use the email you signed up with. After requesting a reset, check your inbox and spam folder.</p>
    <Button asChild variant="outline"><a href="/?recover=1">Recover account access</a></Button>
    <p className="text-sm text-muted-foreground">For older accounts, choose <strong>Try original account sign-in</strong> under <strong>Having trouble signing in?</strong></p>
  </div>;
  const content = <>{!customer && <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">Help &amp; Support</h1>}
      <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div>{!bootstrapped ? <p className="text-sm text-muted-foreground">Checking your account…</p> : user && (!online || offlineAccess) ? <p className="rounded-xl border bg-muted/30 p-5 text-sm">You can read the FAQ offline. Reconnect to send a request or view support conversations.</p> : user ? <SupportCenter key={`${user.id}:${ticketId ?? ""}:${startMessage}`} initialTicketId={ticketId} startComposing={startMessage} /> : <section className="rounded-2xl border bg-card p-6"><h2 className="text-lg font-semibold">Your support requests</h2><p className="mt-2 text-sm text-muted-foreground">Sign in to send a request and view your private conversations.</p><Button asChild className="mt-4"><Link href="/" onClick={() => setView("login")}>Sign in for support</Link></Button></section>}</div>
        <aside className="space-y-4">
          {user ? (
            <details id="account-access" className="scroll-mt-24 rounded-xl border bg-card px-4">
              <summary className="min-h-12 cursor-pointer py-3 font-medium">Can’t access your account?</summary>
              <div className="pb-4">{recovery}</div>
            </details>
          ) : (
            <section id="account-access" className="scroll-mt-24 space-y-3 rounded-xl border bg-card p-4" aria-label="Account recovery">
              <h2 className="font-semibold">Can’t access your account?</h2>
              {recovery}
            </section>
          )}
          <section className="rounded-xl border bg-card px-4 py-3"><h2 className="mb-2 text-lg font-semibold">FAQ</h2><div className="divide-y">{faqs.map(([q, a]) => <details key={q}><summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">{q}</summary><p className="pb-3 text-sm leading-relaxed text-muted-foreground">{a}</p></details>)}</div></section>
          <SupportContact />
        </aside>
      </div>
    </>;
  if (customer) {
    const destination = startMessage ? "home" : "profile";
    return <CustomerAppShell selected={destination} title="Support" backTo={destination}>{content}</CustomerAppShell>;
  }
  return <div className="min-h-screen bg-background">
    <header className="sticky top-0 z-30 border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6"><BrandNavigation /><div className="flex items-center gap-2">{user && <NotificationInbox onBooking={(id, type) => { useAppStore.getState().openBookingSummary(id, type === "RIDE" ? "ride" : "delivery"); router.push("/"); }} />}<Button asChild variant="outline" size="sm"><Link href="/">Home</Link></Button></div></div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">{content}</main>
  </div>;
}
