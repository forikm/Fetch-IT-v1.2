"use client";
import { BookingWaitStatus } from "./booking-wait-status";
import { isAwaitingAcceptance } from "@/lib/booking-wait";
import { CustomerPickupProgress } from "./pickup-progress";
import { RiderProfile } from "../shared/rider-profile";
import { Navigation, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LiveTrackingMap } from "../shared/live-tracking-map";
import { useTrackingUpdates } from "@/hooks/use-tracking-updates";
import { VEHICLES } from "@/lib/constants";
import { BookingTimeline } from "../shared/booking-timeline";
import { formatPeso, locationUpdateLabel, routeTimeLabel } from "@/lib/customer-booking-ui";
import type { Booking } from "./customer-dashboard";
import { BookingActions } from "../shared/booking-actions";
import { RidePickupOtp } from "./ride-pickup-otp";
import { CancelBooking } from "../shared/cancel-booking";
import { useRideLocation } from "@/hooks/use-ride-location";

export function RideTrackingView({ ride, onClose, onUpdated, onCancelled, readOnly = false, updatesPaused = false }: {
  ride: Booking; onClose: () => void; onUpdated: (update: Partial<Booking>) => void; onCancelled?: () => void; readOnly?: boolean; updatesPaused?: boolean;
}) {
  const status = ride.status;
  const location = ride.trackingUpdates?.[0];
  const active = ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(status);
  const { location: customerLocation, message: locationMessage } = useRideLocation(active);
  useTrackingUpdates<Booking>(ride.id, onUpdated);
  return <div className="space-y-4">
    <DialogHeader className="min-h-12 justify-center"><DialogTitle className="flex items-center gap-2"><Navigation className="h-5 w-5 text-primary" />Your ride · {ride.refCode}</DialogTitle><DialogDescription className="sr-only">Your driver, trip map and safety options.</DialogDescription></DialogHeader>
    <BookingWaitStatus key={ride.id} booking={ride} updatesPaused={readOnly || updatesPaused} onUpdated={onUpdated} />
    {status === "ACCEPTED" ? <CustomerPickupProgress key={ride.id} bookingId={ride.id} compact /> : <BookingTimeline compact status={status} type="RIDE" hideStatus={isAwaitingAcceptance(status)} />}
    {ride.rider && <section aria-label="Your driver" className="flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-3">
      <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary">{ride.rider.name.trim().split(/\s+/).slice(0,2).map(part => part[0]).join("")}</span>
      <div className="min-w-0 flex-1"><RiderProfile bookingId={ride.id} {...ride.rider} type="RIDE" /><dl className="mt-1 flex flex-wrap gap-x-2 text-sm"><div className="flex gap-1"><dt className="sr-only">Vehicle</dt><dd>{VEHICLES[ride.vehicleClass]?.label ?? ride.vehicleClass}</dd></div><div className="flex gap-1"><dt className="sr-only">Plate number</dt><dd className="break-all font-semibold">{ride.rider.vehiclePlate || "Not available"}</dd></div></dl></div>
    </section>}
    <section aria-label="Trip map" className="space-y-2">
      <div className="relative h-64 overflow-hidden rounded-2xl border sm:h-80"><LiveTrackingMap vehicleClass={ride.vehicleClass} key={ride.id} pickup={{lat:ride.pickupLat,lng:ride.pickupLng}} dropoff={{lat:ride.dropoffLat,lng:ride.dropoffLng}} rider={location ? {lat:location.lat,lng:location.lng} : null} customer={customerLocation} className="absolute inset-0 h-full w-full border-0 rounded-none" /></div>
      <p className="text-xs text-muted-foreground">A: Pickup · B: Drop-off · Orange arrow: Driver{customerLocation ? " · Blue dot: You" : ""}</p>
      {location?.createdAt && <p role="status" className="text-sm text-muted-foreground">{locationUpdateLabel(location.createdAt, Date.now(), "RIDE")}</p>}
      {(readOnly || updatesPaused) && <p role="status" className="text-sm font-medium text-amber-800 dark:text-amber-200">Live updates paused. Locations may be out of date.</p>}
      {locationMessage && <p role="status" className="text-sm text-muted-foreground">{locationMessage}</p>}
    </section>
    {status === "ACCEPTED" && ride.rider && !readOnly && <RidePickupOtp key={`${ride.id}:${ride.riderId}`} bookingId={ride.id} />}
    <details className="rounded-2xl border bg-card px-4"><summary className="min-h-12 cursor-pointer py-3 text-base font-semibold">Trip details &amp; options</summary>
      <div className="space-y-4 pb-4"><div className="space-y-3"><div><p className="text-sm text-muted-foreground">Pickup</p><p className="break-words font-medium">{ride.pickupLabel}</p></div><div><p className="text-sm text-muted-foreground">Drop-off</p><p className="break-words font-medium">{ride.dropoffLabel}</p></div><p className="flex justify-between gap-3"><span>Fare · {ride.passengers} {ride.passengers === 1 ? "passenger" : "passengers"}</span><strong>{formatPeso(ride.totalFare)}</strong></p>{ride.etaMinutes != null && <p className="text-sm text-muted-foreground">{routeTimeLabel("RIDE")}: about {ride.etaMinutes} min</p>}</div>
      {status === "ACCEPTED" && <BookingTimeline compact status={status} type="RIDE" />}
      {ride.rider?.totalDeliveries != null && <dl className="flex justify-between text-sm"><dt>Driver’s completed bookings</dt><dd>{ride.rider.totalDeliveries}</dd></dl>}
      {["PENDING","MATCHED","ACCEPTED"].includes(status) && <CancelBooking bookingId={ride.id} readOnly={readOnly} onCancelled={() => { onUpdated({status:"CANCELLED"}); onCancelled?.(); }} />}
      <Button variant="outline" className="w-full" onClick={onClose}>Back to bookings</Button></div>
    </details>
    <details className="rounded-2xl border bg-card px-4"><summary className="min-h-12 cursor-pointer py-3 text-base font-semibold">Payment, receipt &amp; help</summary><div className="pb-4"><BookingActions booking={ride} readOnly={readOnly} /></div></details>
    <div className="sticky bottom-0 z-20 -mx-4 space-y-1 border-t bg-background/95 px-4 py-3 backdrop-blur">
      <div className="flex gap-3">{ride.rider?.phone && <Button asChild variant="outline" className="min-h-14 flex-1"><a href={`tel:${ride.rider.phone}`} aria-label={`Call ${ride.rider.name}`}><Phone />Call driver</a></Button>}<Button asChild variant="destructive" className="min-h-14 flex-1"><a href="tel:911"><Phone />Dial 911</a></Button></div>
      <p className="text-center text-xs text-muted-foreground">Dial 911 opens your dialer with the number ready to call.</p>
    </div>
  </div>;
}
