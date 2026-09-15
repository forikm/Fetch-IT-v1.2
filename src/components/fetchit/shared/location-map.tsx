"use client";

// Grab/Uber-style "drop a pin" map. The pin stays fixed in the center of
// the view; the person drags the MAP underneath it to position it. Hitting
// "Confirm this location" reverse-geocodes wherever the pin is pointing
// and reports it back as a real address + coordinates.

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin } from "lucide-react";

// Lingayen, Pangasinan, Philippines — used as the map's starting view
// whenever no address has been picked yet.
const DEFAULT_CENTER = { lat: 16.0206, lng: 120.2321 };

export function LocationMap({
  lat,
  lng,
  onConfirm,
  pinColor = "#dc2626",
  mapClassName = "h-48",
  className,
}: {
  lat: number | null;
  lng: number | null;
  onConfirm: (place: { lat: number; lng: number; label: string }) => void;
  pinColor?: string;
  mapClassName?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // One-time map setup.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const center = lat != null && lng != null ? { lat, lng } : DEFAULT_CENTER;
        mapRef.current = new window.google.maps.Map(containerRef.current, {
          center,
          zoom: lat != null ? 16 : 13,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
        });
        geocoderRef.current = new window.google.maps.Geocoder();
        setReady(true);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center (e.g. after picking an address in the search box above) —
  // the pin visually stays put since it's fixed to the viewport; the map
  // itself pans underneath it.
  useEffect(() => {
    if (!mapRef.current || lat == null || lng == null) return;
    mapRef.current.panTo({ lat, lng });
    mapRef.current.setZoom(16);
  }, [lat, lng]);

  function handleConfirm() {
    const map = mapRef.current;
    const geocoder = geocoderRef.current;
    if (!map) return;
    const center = map.getCenter();
    const pos = { lat: center.lat(), lng: center.lng() };

    if (!geocoder) {
      onConfirm({ ...pos, label: `Pinned location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})` });
      return;
    }
    setConfirming(true);
    geocoder.geocode({ location: pos }, (results, status) => {
      setConfirming(false);
      const label =
        status === "OK" && results && results[0]
          ? results[0].formatted_address
          : `Pinned location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`;
      onConfirm({ ...pos, label });
    });
  }

  if (failed) return null; // silently skip the map if Maps failed to load

  return (
    <div className={className ?? ""}>
      <div className={`relative rounded-md overflow-hidden border ${mapClassName}`}>
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {/* Pin fixed to the center of the viewport — the map pans underneath it. */}
        {ready && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
            <MapPin className="h-9 w-9 drop-shadow-md" style={{ color: pinColor }} fill={pinColor} strokeWidth={1.5} />
          </div>
        )}
      </div>
      {ready && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleConfirm}
          disabled={confirming}
          className="mt-2 w-full text-xs"
        >
          {confirming ? (
            <>
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Looking up address…
            </>
          ) : (
            "Confirm this location"
          )}
        </Button>
      )}
    </div>
  );
}
