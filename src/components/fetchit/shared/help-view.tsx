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
  ["How do I report an issue?", "Under Your requests, select Get help. If you have no requests yet, the form is already open. Choose Issue with Delivery or Issue with the Ride, select what happened, link your booking, and describe the problem. Then select Send support request. For account questions, choose Account or app help."],
  ["How do I report a concern about a rider?", "Choose Issue with Delivery or Issue with the Ride, then Issue with the rider. Select the booking and tell us what happened and when. You can also open a booking and select Get help to link it automatically."],
  ["How do I track my ride or delivery?", "Open your active booking and select View tracking details when it is available. Location updates appear after the rider accepts and starts sharing their location."],
  ["How do I cancel or change a booking?", "Open the booking and select Cancel booking when it is available. If you need help, select Get help, choose your ride or delivery, then Cancellation or booking changes. Sending a support request does not cancel or change the booking."],
  ["How do I question a fare or payment?", "Choose Issue with Delivery or Issue with the Ride, then Fare, payment, or refund. Link the booking and include the amount shown, the amount paid, and your payment method. Keep full card and bank account details private."],
  ["I left something behind. What should I do?", "Choose Issue with the Ride, then I left an item behind. Select the ride and describe the item, where you last saw it, and when the ride ended so support can review your request."],
  ["Where do I read and reply to a support message?", "Open Help & Support and select your conversation under Your requests, or select a support reply in the notification bell. Use Your reply to add an update. If the request is resolved, Send reply & reopen request will reopen it."],
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
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><div className="mb-8"><p className="eyebrow">CUSTOMER CARE</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">How can we help?</h1><p className="mt-3 text-muted-foreground">Get help with a delivery, a ride, or your account. Start a request below or open a conversation to follow up.</p></div>
      <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div>{!bootstrapped ? <p className="text-sm text-muted-foreground">Checking your account…</p> : user && (!online || offlineAccess) ? <p className="rounded-xl border bg-muted/30 p-5 text-sm">You can read the FAQ offline. Reconnect to send a request or view support conversations.</p> : user ? <SupportCenter key={`${user.id}:${ticketId ?? ""}`} initialTicketId={ticketId} /> : <section className="rounded-2xl border bg-card p-6"><h2 className="text-lg font-semibold">Your support requests</h2><p className="mt-2 text-sm text-muted-foreground">Sign in to send a request and view your private conversations.</p><Button asChild className="mt-4"><Link href="/" onClick={() => setView("login")}>Sign in for support</Link></Button></section>}</div>
        <aside className="space-y-6"><section className="rounded-2xl border bg-card p-5 sm:p-6"><h2 className="mb-4 text-lg font-semibold">FAQ</h2><div className="divide-y">{faqs.map(([q, a]) => <details key={q} className="py-3"><summary className="cursor-pointer text-sm font-medium">{q}</summary><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p></details>)}</div></section><SupportContact /></aside>
      </div>
    </main>
  </div>;
}
