"use client";

import { FetchItLoader } from "@/components/fetchit/shared/loading";

// Grab/Uber-style "drop a pin" map. The pin stays fixed in the center of
// the view; the person drags the MAP underneath it to position it. Hitting
// "Confirm this location" reverse-geocodes wherever the pin is pointing
// and reports it back as a real address + coordinates.

import { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
import { useServiceArea } from "@/hooks/use-service-area";

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
  confirmLabel = "Use this location",
  restrictToServiceArea = false,
  onAvailabilityChange,
}: {
  lat: number | null;
  lng: number | null;
  onConfirm: (place: { lat: number; lng: number; label: string }) => void;
  pinColor?: string;
  mapClassName?: string;
  className?: string;
  confirmLabel?: string;
  restrictToServiceArea?: boolean;
  onAvailabilityChange?: (unavailable: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const { area } = useServiceArea(restrictToServiceArea);
  // The booking form already explains an invalid selected address. Show a
  // separate message here only when the person drags to an unavailable pin.
  const selectedCoverageError = useMemo(() => area && lat != null && lng != null ? area.serviceAreaMessage(area.serviceAreaIssue({ lat, lng })) : null, [area, lat, lng]);

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
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !restrictToServiceArea || !area) return;
    const checkCenter = () => {
      const position = map.getCenter();
      const message = area.serviceAreaMessage(area.serviceAreaIssue({ lat: position.lat(), lng: position.lng() }));
      setCoverageError(message);
      onAvailabilityChange?.(!!message);
    };
    const listener = map.addListener("idle", checkCenter);
    checkCenter();
    return () => listener.remove();
  }, [ready, restrictToServiceArea, area, onAvailabilityChange]);

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
    if (restrictToServiceArea && !area) return;
    const unavailable = restrictToServiceArea && area ? area.serviceAreaMessage(area.serviceAreaIssue(pos)) : null;
    setCoverageError(unavailable);
    onAvailabilityChange?.(!!unavailable);
    if (unavailable) return;

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

  if (failed) return <div role="alert" className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm"><p>The map couldn’t load. Your address is kept. Try again, or choose a saved place above.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => { setFailed(false); setReady(false); setAttempt(value => value + 1); }}>Retry map</Button></div>;

  return (
    <div className={className ?? ""}>
      {coverageError && coverageError !== selectedCoverageError && <p role="status" className="mb-2 text-sm text-destructive">{coverageError}</p>}
      <div className={`relative rounded-md overflow-hidden border ${mapClassName}`}>
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
            <FetchItLoader className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        {/* Pin fixed to the center of the viewport — the map pans underneath it. */}
        {ready && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
            <MapPin className="h-9 w-9 drop-shadow-md" style={{ color: pinColor }} fill={pinColor} strokeWidth={1.5} />
          </div>
        )}
      </div>
      {ready && <p className="mt-2 text-xs text-muted-foreground">Move the map to position the pin, then confirm the location below.</p>}
      {ready && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleConfirm}
          disabled={confirming || !!coverageError || (restrictToServiceArea && !area)}
          className="mt-2 w-full text-xs"
        >
          {confirming ? (
            <>
              <FetchItLoader className="h-3 w-3 mr-1.5" /> Looking up address…
            </>
          ) : (
            confirmLabel
          )}
        </Button>
      )}
    </div>
  );
}
