"use client";

import { History, List, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function BookingToolbar({ isRide, tab, onTab, onService, onBook, showBook, status, paused, refreshing, refreshDisabled, onRefresh }: {
  isRide: boolean;
  tab: "active" | "history";
  onTab: (tab: "active" | "history") => void;
  onService: (service: "ride" | "delivery") => void;
  onBook: () => void;
  showBook: boolean;
  status: string;
  paused: boolean;
  refreshing: boolean;
  refreshDisabled: boolean;
  onRefresh: () => void;
}) {
  return <section aria-label="Booking controls" className="min-w-0 space-y-3 rounded-2xl border bg-card p-3 sm:p-4">
    <div className="flex min-w-0 items-center justify-between gap-2">
      <div role="group" aria-label="Booking service" className="inline-flex min-w-0 rounded-xl bg-muted p-1">
        {(["ride", "delivery"] as const).map(service => <button key={service} type="button" aria-pressed={isRide === (service === "ride")} onClick={() => onService(service)} className="min-h-12 min-w-12 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{service === "ride" ? "Rides" : "Deliveries"}</button>)}
      </div>
      {showBook && <Button type="button" className="min-h-12 shrink-0 px-3" aria-label={isRide ? "Book a ride" : "Book a delivery"} title={isRide ? "Book a ride" : "Book a delivery"} onClick={onBook}><Plus className="h-4 w-4" />Book</Button>}
    </div>
    <div className="flex min-w-0 items-center gap-2">
      <Tabs value={tab} onValueChange={value => onTab(value as "active" | "history")} className="min-w-0 flex-1">
        <TabsList aria-label="Booking status" className="grid h-auto w-full grid-cols-2">
          <TabsTrigger value="active" className="min-h-12 min-w-0 gap-1.5"><List className="h-4 w-4" />Active</TabsTrigger>
          <TabsTrigger value="history" className="min-h-12 min-w-0 gap-1.5"><History className="h-4 w-4" />History</TabsTrigger>
        </TabsList>
      </Tabs>
      <Button type="button" variant="ghost" size="icon" className="h-12 w-12 shrink-0" aria-label={refreshing ? "Updating bookings" : "Refresh bookings"} title="Refresh bookings" disabled={refreshDisabled} onClick={onRefresh}><RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} /></Button>
    </div>
    <p role="status" className={`text-sm leading-relaxed ${paused ? "font-medium text-foreground" : "text-muted-foreground"}`}>{status}</p>
  </section>;
}
