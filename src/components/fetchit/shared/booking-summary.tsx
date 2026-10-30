"use client";
import { RiderProfile } from "./rider-profile";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAppStore } from "@/lib/store";
import { BookingTimeline } from "./booking-timeline";
import { BookingActions } from "./booking-actions";
import { StatusBadge } from "./status-badge";
import { VEHICLES, type BookingStatus, type VehicleClass } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { formatPickupSchedule } from "@/lib/pickup-schedule";
import { formatPeso } from "@/lib/customer-booking-ui";

export type SummaryBooking = { id: string; refCode: string; type: "DELIVERY" | "RIDE"; status: BookingStatus; pickupLabel: string; dropoffLabel: string; totalFare: number; distanceKm: number; vehicleClass: VehicleClass; createdAt: string; cargoWeightKg?: number; cargoNotes?: string | null; cancellationReason?: string | null; passengers?: number; scheduledAt?: string | null; riderId: string | null; rider: { id?: string; name: string; rating?: number; ratingCount?: number } | null };
export function BookingSummary({ booking, onRepeat, onDetails }: { booking: SummaryBooking; onRepeat: () => void; onDetails: () => void }) {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  return <div className="space-y-5 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge status={booking.status} type={booking.type} /><span className="text-xl font-semibold">{formatPeso(booking.totalFare)}</span></div>
    {booking.status === "PENDING" && booking.scheduledAt && new Date(booking.scheduledAt) > new Date() && <p className="rounded-lg bg-muted p-3 text-sm">Scheduled pickup: {formatPickupSchedule(booking.scheduledAt)} Philippine time. Riders will see this booking when pickup is due.</p>}
    <BookingTimeline status={booking.status} type={booking.type} scheduled={booking.status === "PENDING" && !!booking.scheduledAt && new Date(booking.scheduledAt).getTime() > Date.now()} />
    <dl className="space-y-3 text-sm">{[["Pickup", booking.pickupLabel], ["Drop-off", booking.dropoffLabel], ["Vehicle", VEHICLES[booking.vehicleClass]?.label ?? booking.vehicleClass], ["Distance", `${booking.distanceKm} km`], ["Booked", new Date(booking.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) + " (PH time)"], [booking.type === "RIDE" ? "Driver" : "Rider", booking.rider?.name ?? "Not assigned"], [booking.type === "RIDE" ? "Passengers" : "Package weight", booking.type === "RIDE" ? String(booking.passengers ?? 1) : `${booking.cargoWeightKg ?? 0} kg`], ...(booking.cancellationReason ? [["Cancellation reason", booking.cancellationReason]] : []), ...(booking.cargoNotes ? [["Notes", booking.cargoNotes]] : []), ...(booking.scheduledAt ? [["Scheduled (Philippine time)", formatPickupSchedule(booking.scheduledAt)]] : [])].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{(label === "Rider" || label === "Driver") && booking.rider ? <RiderProfile bookingId={booking.id} id={booking.rider.id} name={booking.rider.name} rating={booking.rider.rating ?? 0} ratingCount={booking.rider.ratingCount} type={booking.type} /> : value}</dd></div>)}</dl>

    <div className="flex flex-wrap gap-2">{["DELIVERED", "CANCELLED"].includes(booking.status) && <Button size="sm" onClick={onRepeat}>Book again</Button>}{booking.riderId && online && !offlineAccess && <Button size="sm" variant="outline" onClick={onDetails}>{booking.type === "DELIVERY" && booking.status === "DELIVERED" ? "View delivery proof" : "View tracking details"}</Button>}</div>
    <BookingActions booking={booking} />
  </div>;
}
