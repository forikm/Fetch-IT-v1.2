import { ChevronRight, MapPin } from "lucide-react";
import { StatusBadge } from "./status-badge";
import type { BookingStatus } from "@/lib/constants";

export function BookingHistoryRow({ booking, onOpen }: { booking: { refCode: string; type: "DELIVERY" | "RIDE"; status: BookingStatus; dropoffLabel: string }; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} aria-label={`View booking ${booking.refCode}, ${booking.dropoffLabel}`} className="flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <MapPin className="h-5 w-5 shrink-0 text-primary" />
    <span className="min-w-0 flex-1 space-y-2"><StatusBadge status={booking.status} type={booking.type} /><span className="block text-sm font-medium break-words [overflow-wrap:anywhere]">{booking.dropoffLabel}</span></span>
    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
  </button>;
}
