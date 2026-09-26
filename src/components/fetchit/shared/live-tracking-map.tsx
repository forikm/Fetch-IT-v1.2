"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPinOff } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

type Point = { lat: number; lng: number };

export function LiveTrackingMap({
  pickup,
  dropoff,
  rider,
  className = "h-full w-full",
}: {
  pickup: Point;
  dropoff: Point;
  rider: Point | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const riderMarkerRef = useRef<google.maps.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pickupMarker: google.maps.Marker | null = null;
    let dropoffMarker: google.maps.Marker | null = null;
    let routeLine: google.maps.Polyline | null = null;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const map = new window.google.maps.Map(containerRef.current, {
          center: pickup,
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          gestureHandling: "cooperative",
          mapTypeControl: false,
          streetViewControl: false,
        });
        mapRef.current = map;

        pickupMarker = new window.google.maps.Marker({
          position: pickup,
          map,
          title: "Pickup",
          label: { text: "A", color: "#fff", fontSize: "11px", fontWeight: "700" },
        });
        dropoffMarker = new window.google.maps.Marker({
          position: dropoff,
          map,
          title: "Drop-off",
          label: { text: "B", color: "#fff", fontSize: "11px", fontWeight: "700" },
        });
        routeLine = new window.google.maps.Polyline({
          path: [pickup, dropoff],
          map,
          strokeColor: "#ea580c",
          strokeOpacity: 0.75,
          strokeWeight: 5,
        });

        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend(pickup);
        bounds.extend(dropoff);
        if (rider) bounds.extend(rider);
        map.fitBounds(bounds, 64);
        setReady(true);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      pickupMarker?.setMap(null);
      dropoffMarker?.setMap(null);
      routeLine?.setMap(null);
      riderMarkerRef.current?.setMap(null);
      riderMarkerRef.current = null;
      mapRef.current = null;
    };
    // Pickup/drop-off belong to one booking and do not change while mounted.
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!rider) {
      riderMarkerRef.current?.setMap(null);
      riderMarkerRef.current = null;
      return;
    }

    if (!riderMarkerRef.current) {
      riderMarkerRef.current = new window.google.maps.Marker({
        position: rider,
        map,
        title: "Your rider",
        zIndex: 10,
        icon: {
          path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          fillColor: "#f97316",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          scale: 7,
        },
      });
    } else {
      riderMarkerRef.current.setPosition(rider);
    }

    const visible = map.getBounds();
    if (visible && !visible.contains(rider)) map.panTo(rider);
  }, [ready, rider?.lat, rider?.lng]);

  if (failed) {
    return (
      <div className={`${className} grid place-items-center bg-muted/40 text-muted-foreground`}>
        <div className="flex items-center gap-2 text-sm">
          <MapPinOff className="h-4 w-4" /> Google Maps could not be loaded
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-muted/50">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      {ready && !rider && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-card/95 px-3 py-1.5 text-xs font-medium shadow-sm">
          Waiting for GPS from the rider&apos;s phone app…
        </div>
      )}
    </div>
  );
}
