"use client";
import { Home, History, UserRound } from "lucide-react";
export function CustomerBottomNav({ selected, onHome, onBookings, onProfile }: { selected: "home" | "bookings" | "profile"; onHome: () => void; onBookings: () => void; onProfile: () => void }) {
  return <nav aria-label="Customer navigation" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur sm:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
    <div className="grid grid-cols-3">{[{ key: "home", label: "Home", Icon: Home, action: onHome }, { key: "bookings", label: "Bookings", Icon: History, action: onBookings }, { key: "profile", label: "Profile", Icon: UserRound, action: onProfile }].map(({ key, label, Icon, action }) => <button key={key} type="button" onClick={action} aria-current={selected === key ? "page" : undefined} className={`flex flex-col items-center gap-1 py-3 text-xs ${selected === key ? "text-primary font-semibold" : "text-muted-foreground"}`}><Icon className="h-5 w-5" />{label}</button>)}</div>
  </nav>;
}
