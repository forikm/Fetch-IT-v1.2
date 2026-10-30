import { formatPeso } from "@/lib/customer-booking-ui";
import { ChevronRight, MapPin } from "lucide-react";
import { StatusBadge } from "./status-badge";
import type { BookingStatus } from "@/lib/constants";

export function BookingHistoryRow({ booking, onOpen }: { booking: { refCode: string; type: "DELIVERY" | "RIDE"; status: BookingStatus; dropoffLabel: string; totalFare: number; createdAt: string }; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} aria-label={`View booking ${booking.refCode}, ${booking.dropoffLabel}`} className="flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <MapPin className="h-5 w-5 shrink-0 text-primary" />
    <span className="min-w-0 flex-1 space-y-2"><span className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{booking.type === "RIDE" ? "Ride" : "Delivery"} · {new Date(booking.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} (PH)</span><StatusBadge status={booking.status} type={booking.type} /></span><span className="block text-sm font-medium break-words [overflow-wrap:anywhere]">{booking.dropoffLabel}</span><span className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{booking.refCode}</span><span className="font-medium text-foreground">{formatPeso(booking.totalFare)}</span></span></span>
    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
  </button>;
}
