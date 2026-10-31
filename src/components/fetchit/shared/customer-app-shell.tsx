"use client";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { FetchItLogo } from "./logo";
import { CustomerBottomNav } from "./customer-bottom-nav";
import { NotificationInbox } from "./notification-inbox";

export function CustomerAppShell({ selected, title, children, action }: {
  selected: "home" | "bookings" | "profile"; title: string; children: ReactNode; action?: ReactNode;
}) {
  const chooseMode = useAppStore(s => s.chooseMode);
  const setView = useAppStore(s => s.setView);
  const mode = useAppStore(s => s.mode);
  const navigate = (destination: "home" | "bookings" | "profile") => {
    if (destination === "home") setView("mode-select");
    else if (destination === "profile") setView("customer-profile");
    else chooseMode(mode ?? "delivery");
  };
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, []);
  return <div data-customer-workspace className="min-h-dvh min-w-0 bg-background pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-8">
    <header data-customer-header className="sticky z-30 border-b bg-background/95 pt-[var(--app-safe-top)] backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><FetchItLogo size={28} className="[&_span]:text-lg" /><span aria-hidden="true" className="h-5 border-l" /><h1 className="truncate text-lg font-semibold">{title}</h1></div>
        <div className="flex shrink-0 items-center gap-2">
          <nav aria-label="Customer navigation" className="hidden items-center gap-1 sm:flex">{(["home", "bookings", "profile"] as const).map(item => <button key={item} type="button" aria-current={selected === item ? "page" : undefined} className="min-h-12 rounded-xl px-4 text-sm capitalize aria-[current=page]:bg-primary/10 aria-[current=page]:font-semibold aria-[current=page]:text-primary focus-visible:outline-2 focus-visible:outline-ring" onClick={() => navigate(item)}>{item}</button>)}</nav>
          <NotificationInbox onBooking={(id, type) => useAppStore.getState().openBookingSummary(id, type === "RIDE" ? "ride" : "delivery")} />
        </div>
      </div>
    </header>
    <main className="mx-auto w-full min-w-0 max-w-5xl space-y-6 px-4 py-6 sm:px-6">{action}{children}</main>
    <CustomerBottomNav selected={selected} onHome={() => navigate("home")} onBookings={() => navigate("bookings")} onProfile={() => navigate("profile")} />
  </div>;
}
