"use client";

import { LiveTrackingMap } from "./live-tracking-map";

/** Share road routing with the tracking map, without the live-location badge. */
export function BookingRouteMap({ pickup, dropoff, className }: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  className?: string;
}) {
  return <LiveTrackingMap pickup={pickup} dropoff={dropoff} rider={null} preview
    className={`w-full min-w-0 overflow-hidden rounded-md border ${className ?? "h-40"}`} />;
}
