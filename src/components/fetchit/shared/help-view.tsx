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

const faqs = [
  ["How do I track my ride or delivery?", "Open your active booking and choose tracking details. Tracking starts after a rider accepts and sends location updates."],
  ["How do I cancel a booking?", "Open the booking and use Cancel when it is available. If pickup has already happened or you can’t cancel, send a booking help request."],
  ["Something is wrong with my delivery or fare.", "Choose the booking below, describe what happened, and send a request. Include the amount if your question is about a fare or payment."],
  ["I left something behind.", "Open the relevant booking and select Lost item. Describe the item and where you last saw it so support can coordinate with the rider."],
  ["Where will I see a support reply?", "Open your request in Help or select a support notification. You can reply in the same conversation, including after it has been resolved."],
  ["I’m having trouble signing in.", "Use the same sign-in method you used to create your account. If you still can’t sign in, use the support contact options below when available."],
];

export function HelpView({ ticketId }: { ticketId?: string }) {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const router = useRouter();
  const { user, bootstrapped, bootstrap, setView } = useAppStore();
  useEffect(() => { if (!bootstrapped) void bootstrap(); }, [bootstrapped, bootstrap]);
  return <div className="min-h-screen bg-background">
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6"><BrandNavigation /><div className="flex items-center gap-2">{user && <NotificationInbox onBooking={(id, type) => { useAppStore.getState().openBookingSummary(id, type === "RIDE" ? "ride" : "delivery"); router.push("/"); }} />}<Button asChild variant="outline" size="sm"><Link href="/">{user ? "Dashboard" : "Home"}</Link></Button></div></div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><div className="mb-8"><p className="eyebrow">CUSTOMER CARE</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">How can we help?</h1><p className="mt-3 text-muted-foreground">Help with your bookings, your account, and everything along the way.</p></div>
      <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div>{!bootstrapped ? <p className="text-sm text-muted-foreground">Checking your account…</p> : user && (!online || offlineAccess) ? <p className="rounded-xl border bg-muted/30 p-5 text-sm">You can read common questions offline. Reconnect to send a request or view support conversations.</p> : user ? <SupportCenter key={`${user.id}:${ticketId ?? ""}`} initialTicketId={ticketId} /> : <section className="rounded-2xl border bg-card p-6"><h2 className="text-lg font-semibold">Your support requests</h2><p className="mt-2 text-sm text-muted-foreground">Sign in to send a request and view your private conversations.</p><Button asChild className="mt-4"><Link href="/" onClick={() => setView("login")}>Sign in for support</Link></Button></section>}</div>
        <aside className="space-y-6"><section className="rounded-2xl border bg-card p-5 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Common questions</h2><div className="divide-y">{faqs.map(([q, a]) => <details key={q} className="py-3"><summary className="cursor-pointer text-sm font-medium">{q}</summary><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p></details>)}</div></section><SupportContact /></aside>
      </div>
    </main>
  </div>;
}
