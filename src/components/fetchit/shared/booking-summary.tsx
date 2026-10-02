import { BookingTimeline } from "./booking-timeline";
import { BookingActions } from "./booking-actions";
import { StatusBadge } from "./status-badge";
import { VEHICLES, type BookingStatus, type VehicleClass } from "@/lib/constants";
import { Button } from "@/components/ui/button";

export type SummaryBooking = { id: string; refCode: string; type: "DELIVERY" | "RIDE"; status: BookingStatus; pickupLabel: string; dropoffLabel: string; totalFare: number; distanceKm: number; vehicleClass: VehicleClass; createdAt: string; cargoWeightKg?: number; cargoNotes?: string | null; passengers?: number; scheduledAt?: string | null; riderId: string | null; rider: { name: string } | null };
export function BookingSummary({ booking, onRepeat, onDetails }: { booking: SummaryBooking; onRepeat: () => void; onDetails: () => void }) {
  return <div className="space-y-5 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge status={booking.status} type={booking.type} /><span className="text-xl font-semibold">₱{booking.totalFare.toFixed(2)}</span></div>
    <dl className="space-y-3 text-sm">{[["Pickup", booking.pickupLabel], ["Destination", booking.dropoffLabel], ["Vehicle", VEHICLES[booking.vehicleClass]?.label ?? booking.vehicleClass], ["Distance", `${booking.distanceKm} km`], ["Booked", new Date(booking.createdAt).toLocaleString()], ["Rider", booking.rider?.name ?? "Not assigned"], [booking.type === "RIDE" ? "Passengers" : "Cargo weight", booking.type === "RIDE" ? String(booking.passengers ?? 1) : `${booking.cargoWeightKg ?? 0} kg`], ...(booking.cargoNotes ? [["Notes", booking.cargoNotes]] : []), ...(booking.scheduledAt ? [["Scheduled", new Date(booking.scheduledAt).toLocaleString()]] : [])].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
    <BookingTimeline status={booking.status} type={booking.type} />
    <div className="flex flex-wrap gap-2">{["DELIVERED", "CANCELLED"].includes(booking.status) && <Button size="sm" onClick={onRepeat}>Book again</Button>}{booking.riderId && <Button size="sm" variant="outline" onClick={onDetails}>{booking.type === "DELIVERY" && booking.status === "DELIVERED" ? "View delivery proof" : "View tracking details"}</Button>}</div>
    <BookingActions booking={booking} />
  </div>;
}
