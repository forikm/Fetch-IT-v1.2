"use client";

import { useState } from "react";
import { Bike, Car, CircleDot, Navigation, Phone, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FetchItLoader } from "../shared/loading";
import { BookingRouteMap } from "../shared/booking-route-map";
import { useTrackingUpdates } from "@/hooks/use-tracking-updates";
import { VEHICLES, statusLabel, type BookingStatus, type VehicleClass } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Booking } from "./customer-dashboard";
import { BookingActions } from "../shared/booking-actions";

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
  const [status, setStatus] = useState<BookingStatus>(ride.status);
  const [eta, setEta] = useState<number | null>(ride.etaMinutes);

  const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };
  const dropoff = { lat: ride.dropoffLat, lng: ride.dropoffLng };

  useTrackingUpdates<Booking>(ride.id, (updated) => {
    if (updated.status) setStatus(updated.status);
    if (updated.etaMinutes !== undefined) setEta(updated.etaMinutes);
    onUpdated(updated);
  });

  const done = status === "DELIVERED";
  const cancelled = status === "CANCELLED";
  const steps: { key: BookingStatus; label: string }[] = [
    { key: "ACCEPTED", label: "Driver assigned" },
    { key: "PICKED_UP", label: "On board" },
    { key: "IN_TRANSIT", label: "Heading to drop-off" },
    { key: "DELIVERED", label: "Completed" },
  ];

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Navigation className="h-5 w-5 text-emerald-600" />
          Your ride · {ride.refCode}
        </DialogTitle>
        <DialogDescription>{statusLabel(status, "RIDE")}</DialogDescription>
      </DialogHeader>

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-100 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-emerald-900/30 aspect-[16/10]">
        <BookingRouteMap
          pickup={pickup}
          dropoff={dropoff}
          className="absolute inset-0 h-full w-full border-0 rounded-none"
        />
        <div className="absolute top-2 left-2 bg-card/95 backdrop-blur rounded-full px-2.5 py-1 text-xs font-medium border shadow-sm flex items-center gap-1.5 z-10">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              done ? "bg-emerald-500" : cancelled ? "bg-rose-500" : "bg-emerald-500 animate-fit-pulse",
            )}
          />
          {statusLabel(status, "RIDE")}
          {eta != null && !done && !cancelled && (
            <span className="text-muted-foreground">· ETA {eta} min</span>
          )}
        </div>
      </div>

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
              <a href={`tel:${ride.rider.phone}`}>
                <Button size="icon" variant="outline" className="h-9 w-9">
                  <Phone className="h-4 w-4" />
                </Button>
              </a>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 flex items-center justify-center gap-2 text-muted-foreground">
            <FetchItLoader className="h-4 w-4" />
            <span className="text-sm">Waiting for a driver to accept…</span>
          </CardContent>
        </Card>
      )}

      {/* Status timeline */}
      <BookingActions booking={{ ...ride, status }} />
      {!cancelled && (
        <ol className="space-y-0">
          {steps.map((s, i) => {
            const active = statusIndex(status) === i;
            const complete = statusIndex(status) > i || done;
            return (
              <li key={s.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "grid place-items-center h-6 w-6 rounded-full border-2 text-[10px] font-bold",
                      complete
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : active
                          ? "border-emerald-600 text-emerald-700"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {complete ? "✓" : i + 1}
                  </span>
                  {i < steps.length - 1 && (
                    <span className={cn("h-5 w-0.5", complete ? "bg-emerald-600" : "bg-border")} />
                  )}
                </div>
                <div className="pb-1">
                  <p className={cn("text-sm font-medium leading-6", !complete && !active && "text-muted-foreground")}>
                    {s.label}
                  </p>
                  {active && status === "ACCEPTED" && (
                    <p className="text-xs text-muted-foreground">
                      Your driver is heading to {ride.pickupLabel}.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

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
          <span className="font-semibold">₱{ride.totalFare.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

function statusIndex(status: BookingStatus): number {
  switch (status) {
    case "PENDING":
    case "MATCHED":
      return 0; // not yet assigned / driver assigned pending acceptance
    case "ACCEPTED":
      return 0;
    case "PICKED_UP":
      return 1;
    case "IN_TRANSIT":
      return 2;
    case "DELIVERED":
      return 3;
    default:
      return 0;
  }
}
