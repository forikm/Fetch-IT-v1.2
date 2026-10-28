"use client";
import { RiderProfile } from "../shared/rider-profile";

import { Bike, Calculator, Car, CircleDot, Clock, MapPin, Navigation, Phone, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VEHICLES, type VehicleClass } from "@/lib/constants";
import { formatPeso, routeTimeLabel } from "@/lib/customer-booking-ui";
import { formatPickupSchedule } from "@/lib/pickup-schedule";
import { BookingTimeline } from "../shared/booking-timeline";
import { BookingActions } from "../shared/booking-actions";
import { CancelBooking } from "../shared/cancel-booking";
import { StatusBadge } from "../shared/status-badge";
import type { Booking } from "./customer-dashboard";

export function CustomerBookingCard({ booking, readOnly, onTrack, onRefresh, onRepeat }: {
  booking: Booking; readOnly: boolean; onTrack: () => void; onRefresh: () => void; onRepeat: () => void;
}) {
  const vehicle = VEHICLES[booking.vehicleClass];
  const vehicleIcon = getVehicleIcon(booking.vehicleClass);
  const ride = booking.type === "RIDE";
  const scheduled = booking.status === "PENDING" && !!booking.scheduledAt && new Date(booking.scheduledAt).getTime() > Date.now();
  const canCancel = ["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status);
  const finished = ["DELIVERED", "CANCELLED"].includes(booking.status);
  const delivered = booking.status === "DELIVERED";
  const openRide = ride && !!booking.rider && ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(booking.status);

  return <Card className={`min-w-0 border hover:shadow-md transition flex flex-col ${openRide ? "cursor-pointer" : ""}`} onClick={openRide ? event => {
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea, [role='dialog']")) return;
    onTrack();
  } : undefined}>
    <CardHeader className="min-w-0 grid-cols-[minmax(0,1fr)] pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-muted-foreground">{booking.refCode}</span>
            <StatusBadge status={booking.status} type={booking.type} />
          </div>
          <CardTitle className="text-base mt-1.5 [overflow-wrap:anywhere]">{openRide ? <button type="button" onClick={onTrack} aria-label={`View rider profile and map for ${booking.refCode}`} className="rounded text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{booking.dropoffLabel}</button> : booking.dropoffLabel}</CardTitle>
          <CardDescription className="flex w-full min-w-0 items-start gap-1 mt-0.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 [overflow-wrap:anywhere]">from {booking.pickupLabel}</span>
          </CardDescription>
        </div>
        <div className="grid place-items-center h-10 w-10 rounded-lg bg-primary/10 text-primary shrink-0">{vehicleIcon}</div>
      </div>
    </CardHeader>
    <CardContent className="min-w-0 space-y-3 flex-1">
      {scheduled && <p className="rounded-lg bg-muted p-3 text-sm">Pickup {formatPickupSchedule(booking.scheduledAt!)} (PH time)</p>}
      <div className="grid min-w-0 grid-cols-2 gap-3 text-sm">
        <Stat label="Vehicle" value={vehicle?.label ?? booking.vehicleClass} icon={vehicleIcon} />
        <Stat label="Distance" value={`${booking.distanceKm} km`} icon={<Navigation className="h-4 w-4" />} />
        <Stat label="Fare" value={formatPeso(booking.totalFare)} icon={<Calculator className="h-4 w-4" />} />
        <Stat label={routeTimeLabel(booking.type)} value={finished ? delivered ? ride ? "Arrived" : "Delivered" : "Cancelled" : booking.etaMinutes != null ? `About ${booking.etaMinutes} min` : "—"} icon={<Clock className="h-4 w-4" />} />
      </div>

      {booking.rider && <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="grid place-items-center h-9 w-9 rounded-full bg-primary/15 text-primary shrink-0"><Truck className="h-4 w-4" /></div>
        <div className="flex-1 min-w-0">
          <RiderProfile bookingId={booking.id} {...booking.rider} type={booking.type} />
          <p className="text-xs text-muted-foreground truncate">{booking.rider.vehiclePlate || "Plate not set"}</p>
        </div>
        {booking.rider.phone && <Button asChild size="icon" variant="outline" className="h-8 w-8 shrink-0"><a href={`tel:${booking.rider.phone}`} aria-label={`Call ${booking.rider.name}`}><Phone className="h-4 w-4" /></a></Button>}
      </div>}

      <BookingTimeline status={booking.status} type={booking.type} scheduled={scheduled} />
      {openRide && <p className="text-xs text-muted-foreground">Tap this booking to view your driver, map and safety options.</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {booking.status !== "CANCELLED" && !readOnly && !(delivered && !ride) && <Button size="sm" className="flex-1" onClick={onTrack}><Navigation className="h-3.5 w-3.5" />{delivered ? "View ride details" : ride ? "Track ride" : "Track delivery"}</Button>}
        {canCancel && <CancelBooking bookingId={booking.id} readOnly={readOnly} onCancelled={onRefresh} />}
        {finished && <Button size="sm" variant="outline" onClick={onRepeat}>Book again</Button>}
        {delivered && !ride && !readOnly && <Button size="sm" variant="outline" className="flex-1" onClick={onTrack}><ShieldCheck className="h-3.5 w-3.5" />View proof</Button>}
      </div>
      <BookingActions booking={booking} readOnly={readOnly} />
    </CardContent>
  </Card>;
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div className="space-y-0.5">
    <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
    <div className="font-medium text-sm [overflow-wrap:anywhere]">{value}</div>
  </div>;
}

function getVehicleIcon(vehicle: VehicleClass) {
  switch (vehicle) {
    case "MOTORCYCLE": return <Bike className="h-5 w-5" />;
    case "TRICYCLE": return <CircleDot className="h-5 w-5" />;
    case "SEDAN": return <Car className="h-5 w-5" />;
    default: return <Truck className="h-5 w-5" />;
  }
}
