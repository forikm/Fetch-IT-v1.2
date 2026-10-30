"use client";
import { RiderProfile } from "../shared/rider-profile";

import { Navigation, Phone, Calculator, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FetchItLoader } from "../shared/loading";
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

export function RideTrackingView({
  ride,
  onClose,
  onUpdated,
  onCancelled,
  readOnly = false,
}: {
  ride: Booking;
  onClose: () => void;
  onUpdated: (u: Partial<Booking>) => void;
  onCancelled?: () => void;
  readOnly?: boolean;
}) {
  const status = ride.status;
  const eta = ride.etaMinutes;
  const location = ride.trackingUpdates?.[0];

  const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };
  const dropoff = { lat: ride.dropoffLat, lng: ride.dropoffLng };

  useTrackingUpdates<Booking>(ride.id, onUpdated);

  const done = status === "DELIVERED";
  const cancelled = status === "CANCELLED";
  const active = ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(status);
  const { location: customerLocation, message: locationMessage } = useRideLocation(active);


  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Navigation className="h-5 w-5 text-emerald-600" />
          Your ride · {ride.refCode}
        </DialogTitle>
        <DialogDescription>View your driver&apos;s profile, follow your trip and access safety options.</DialogDescription>
      </DialogHeader>

      <BookingTimeline compact status={status} type="RIDE" scheduled={status === "PENDING" && !!ride.scheduledAt && new Date(ride.scheduledAt).getTime() > Date.now()} />

      {/* Driver card */}
      {ride.rider ? (
        <Card className="border">
          <CardContent className="py-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div aria-hidden="true" className="grid place-items-center h-12 w-12 shrink-0 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300 font-semibold">
                {ride.rider.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("")}
              </div>
              <div className="min-w-[6rem] flex-1">
                <p className="text-xs text-muted-foreground">Your driver&apos;s profile</p>
                <RiderProfile bookingId={ride.id} {...ride.rider} type="RIDE" />
              </div>
              {ride.rider.phone && <Button asChild variant="outline" className="min-h-11 shrink-0"><a href={`tel:${ride.rider.phone}`} aria-label={`Call ${ride.rider.name}`}><Phone className="h-4 w-4" />Call driver</a></Button>}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Vehicle</dt><dd className="font-medium">{VEHICLES[ride.vehicleClass]?.label ?? ride.vehicleClass}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Plate number</dt><dd className="font-medium [overflow-wrap:anywhere]">{ride.rider.vehiclePlate || "Not available"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Rating</dt><dd className="font-medium">{ride.rider.ratingCount ? `★ ${ride.rider.rating.toFixed(1)} / 5 (${ride.rider.ratingCount} ratings)` : "No ratings yet"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="font-medium [overflow-wrap:anywhere]">{ride.rider.phone || "Not available"}</dd></div>
              {ride.rider.totalDeliveries != null && <div><dt className="text-xs text-muted-foreground">Completed bookings</dt><dd className="font-medium">{ride.rider.totalDeliveries}</dd></div>}
            </dl>
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

      {status === "ACCEPTED" && <p role="status" className="rounded-xl border bg-muted/30 p-3 text-sm">Pickup arrival estimate is unavailable. The estimated trip duration below is the travel time from pickup to drop-off.</p>}
      {status === "ACCEPTED" && ride.rider && <RidePickupOtp key={`${ride.id}:${ride.riderId}`} bookingId={ride.id} />}
      {["PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(status) && <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Passenger pickup completed</p>}

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-100 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-emerald-900/30 aspect-[16/10]">
        <LiveTrackingMap
          key={ride.id}
          pickup={pickup}
          dropoff={dropoff}
          rider={location ? { lat: location.lat, lng: location.lng } : null}
          customer={customerLocation}
          className="absolute inset-0 h-full w-full border-0 rounded-none"
        />

      </div>

      <p className="text-xs text-muted-foreground">A: Pickup · B: Drop-off · Orange arrow: Driver{customerLocation ? " · Blue dot: You" : ""}</p>
      {locationMessage && <p role="status" className="text-xs text-muted-foreground">{locationMessage}</p>}
      {eta != null && !done && !cancelled && <p className="text-xs text-muted-foreground">{routeTimeLabel("RIDE")}: about {eta} min</p>}
      {location?.createdAt && <p className="text-xs text-muted-foreground">{locationUpdateLabel(location.createdAt, Date.now(), "RIDE")}</p>}

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

      <BookingActions booking={{ ...ride, status }} readOnly={readOnly} />

      <div className="sticky bottom-[-1rem] z-10 space-y-2 border-t bg-background/95 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2"><Button asChild variant="destructive" className="min-h-11"><a href="tel:911"><Phone className="h-4 w-4" />Dial 911</a></Button><Button variant="outline" className="min-h-11" onClick={onClose}>Back to bookings</Button></div>
        <p className="text-xs text-muted-foreground">Dial 911 opens your phone dialer with the number ready to call.</p>
        <div className="flex justify-end">
        {["PENDING", "MATCHED", "ACCEPTED"].includes(status) && <CancelBooking bookingId={ride.id} readOnly={readOnly} onCancelled={() => { onUpdated({ status: "CANCELLED" }); onCancelled?.(); }} />}
        </div>
      </div>
    </div>
  );
}
