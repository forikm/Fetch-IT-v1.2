"use client";

import { FetchItLoader } from "@/components/fetchit/shared/loading";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MapPinOff } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

type Point = { lat: number; lng: number };

export function LiveTrackingMap({
  pickup,
  dropoff,
  rider,
  customer = null,
  className = "h-full w-full",
}: {
  pickup: Point;
  dropoff: Point;
  rider: Point | null;
  customer?: Point | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const riderMarkerRef = useRef<google.maps.Marker | null>(null);
  const customerMarkerRef = useRef<google.maps.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      pickupMarker?.setMap(null);
      dropoffMarker?.setMap(null);
      routeLine?.setMap(null);
      riderMarkerRef.current?.setMap(null);
      riderMarkerRef.current = null;
      customerMarkerRef.current?.setMap(null);
      customerMarkerRef.current = null;
      mapRef.current = null;
    };
    // Pickup/drop-off belong to one booking and do not change while mounted.
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, attempt]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!customer) {
      customerMarkerRef.current?.setMap(null);
      customerMarkerRef.current = null;
      return;
    }
    if (!customerMarkerRef.current) {
      customerMarkerRef.current = new window.google.maps.Marker({
        position: customer,
        map,
        title: "Your current location",
        zIndex: 20,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          fillColor: "#2563eb",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
          scale: 8,
        },
      });
      const bounds = new window.google.maps.LatLngBounds();
      bounds.extend(pickup);
      bounds.extend(dropoff);
      bounds.extend(customer);
      if (rider) bounds.extend(rider);
      map.fitBounds(bounds, 64);
    } else {
      customerMarkerRef.current.setPosition(customer);
      const visible = map.getBounds();
      if (visible && !visible.contains(customer)) map.panTo(customer);
    }
  }, [ready, customer?.lat, customer?.lng, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  if (failed) {
    return (
      <div className={`${className} grid place-items-center bg-muted/40 text-muted-foreground`}>
        <div role="alert" className="space-y-3 p-4 text-center text-sm"><p className="flex items-center justify-center gap-2"><MapPinOff className="h-4 w-4" />The tracking map couldn’t load.</p><p>Your booking details and contact options are still available.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => { setFailed(false); setReady(false); setAttempt(value => value + 1); }}>Retry tracking map</Button></div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-muted/50">
          <FetchItLoader className="h-6 w-6 text-primary" />
        </div>
      )}
      {ready && !rider && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-full border bg-card/95 px-3 py-1.5 text-center text-xs font-medium shadow-sm [overflow-wrap:anywhere]">
          Waiting for your booking partner to share their location…
        </div>
      )}
    </div>
  );
}
