"use client";

import { Bike, Car, CircleDot, Navigation, Phone, Calculator, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FetchItLoader } from "../shared/loading";
import { LiveTrackingMap } from "../shared/live-tracking-map";
import { useTrackingUpdates } from "@/hooks/use-tracking-updates";
import { VEHICLES, type VehicleClass } from "@/lib/constants";
import { BookingTimeline } from "../shared/booking-timeline";
import { formatPeso, locationUpdateLabel, routeTimeLabel } from "@/lib/customer-booking-ui";
import type { Booking } from "./customer-dashboard";
import { BookingActions } from "../shared/booking-actions";
import { RidePickupOtp } from "./ride-pickup-otp";

const RIDE_ICONS: Partial<Record<VehicleClass, React.ReactNode>> = {
  MOTORCYCLE: <Bike className="h-5 w-5" />,
  TRICYCLE: <CircleDot className="h-5 w-5" />,
  SEDAN: <Car className="h-5 w-5" />,
};

export function RideTrackingView({
  ride,
  onClose,
  onUpdated,
}: {
  ride: Booking;
  onClose: () => void;
  onUpdated: (u: Partial<Booking>) => void;
}) {
  const status = ride.status;
  const eta = ride.etaMinutes;
  const location = ride.trackingUpdates?.[0];

  const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };
  const dropoff = { lat: ride.dropoffLat, lng: ride.dropoffLng };

  useTrackingUpdates<Booking>(ride.id, onUpdated);

  const done = status === "DELIVERED";
  const cancelled = status === "CANCELLED";


  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Navigation className="h-5 w-5 text-emerald-600" />
          Your ride · {ride.refCode}
        </DialogTitle>
        <DialogDescription>Follow your trip from pickup to drop-off.</DialogDescription>
      </DialogHeader>

      <BookingTimeline status={status} type="RIDE" scheduled={status === "PENDING" && !!ride.scheduledAt && new Date(ride.scheduledAt).getTime() > Date.now()} />

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-100 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-emerald-900/30 aspect-[16/10]">
        <LiveTrackingMap
          key={ride.id}
          pickup={pickup}
          dropoff={dropoff}
          rider={location ? { lat: location.lat, lng: location.lng } : null}
          className="absolute inset-0 h-full w-full border-0 rounded-none"
        />

      </div>

      {eta != null && !done && !cancelled && <p className="text-xs text-muted-foreground">{routeTimeLabel("RIDE")}: about {eta} min</p>}
      {location?.createdAt && <p className="text-xs text-muted-foreground">{locationUpdateLabel(location.createdAt, Date.now(), "RIDE")}</p>}

      {/* Driver card */}
      {ride.rider ? (
        <Card className="border">
          <CardContent className="py-4 flex items-center gap-3">
            <div className="grid place-items-center h-12 w-12 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
              {RIDE_ICONS[ride.vehicleClass] ?? <Car className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{ride.rider.name}</p>
              <p className="text-sm text-muted-foreground truncate">
                {VEHICLES[ride.vehicleClass]?.label ?? ride.vehicleClass} ·{" "}
                {ride.rider.vehiclePlate} · ★ {ride.rider.rating.toFixed(1)}
              </p>
            </div>
            {ride.rider.phone && (
                <Button asChild size="icon" variant="outline" className="h-9 w-9 shrink-0">
                  <a href={`tel:${ride.rider.phone}`} aria-label={`Call ${ride.rider.name}`}>
                  <Phone className="h-4 w-4" />
                  </a>
                </Button>
            )}
          </CardContent>
        </Card>
      ) : !done && !cancelled ? (
        <Card className="border-dashed">
          <CardContent className="py-6 flex items-center justify-center gap-2 text-muted-foreground">
            <FetchItLoader className="h-4 w-4" />
            <span className="text-sm">Waiting for a driver to accept…</span>
          </CardContent>
        </Card>
      ) : null}

      {status === "ACCEPTED" && ride.rider && <RidePickupOtp key={`${ride.id}:${ride.riderId}`} bookingId={ride.id} />}
      {["PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(status) && <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Passenger pickup completed</p>}

      {/* Itinerary + fare */}
      <div className="rounded-xl border p-3 space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-emerald-600 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Pickup</p>
            <p className="font-medium">{ride.pickupLabel}</p>
          </div>
        </div>
        <div className="ml-[4px] border-l-2 border-dashed border-border h-3" />
        <div className="flex items-start gap-2">
          <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-rose-600 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Drop-off</p>
            <p className="font-medium">{ride.dropoffLabel}</p>
          </div>
        </div>
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Calculator className="h-4 w-4" /> Fare
            <span className="text-xs">({ride.passengers} {ride.passengers > 1 ? "passengers" : "passenger"})</span>
          </span>
          <span className="font-semibold">{formatPeso(ride.totalFare)}</span>
        </div>
      </div>

      <BookingActions booking={{ ...ride, status }} />

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
