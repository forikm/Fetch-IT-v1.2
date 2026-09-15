"use client";

// Read-only preview map: drops a green pin at pickup and a red pin at
// drop-off, then frames the view to fit both. No dragging, no confirm
// button — just a quick visual for "here's where this booking goes."

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { Loader2 } from "lucide-react";

export function BookingRouteMap({
  pickup,
  dropoff,
  className,
}: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const map = new window.google.maps.Map(containerRef.current, {
          center: pickup,
          zoom: 13,
          disableDefaultUI: true,
          gestureHandling: "cooperative",
        });
        new window.google.maps.Marker({
          position: pickup,
          map,
          label: { text: "A", color: "#fff", fontSize: "11px", fontWeight: "bold" },
        });
        new window.google.maps.Marker({
          position: dropoff,
          map,
          label: { text: "B", color: "#fff", fontSize: "11px", fontWeight: "bold" },
        });
        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend(pickup);
        bounds.extend(dropoff);
        map.fitBounds(bounds, 48);
        setReady(true);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  if (failed) return null;

  return (
    <div className={`relative rounded-md overflow-hidden border ${className ?? "h-40"}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
