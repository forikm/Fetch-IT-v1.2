"use client";

import { FetchItLoader } from "@/components/fetchit/shared/loading";

// Grab/Uber-style "drop a pin" map. The pin stays fixed in the center of
// the view; the person drags the MAP underneath it to position it. Hitting
// "Confirm this location" reverse-geocodes wherever the pin is pointing
// and reports it back as a real address + coordinates.

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { Button } from "@/components/ui/button";
import { MapZoomControls } from "./map-zoom-controls";
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
  confirmLabel = "Use this location",
  restrictToServiceArea = false,
  onBackToSearch,
}: {
  lat: number | null;
  lng: number | null;
  onConfirm: (place: { lat: number; lng: number; label: string }) => void;
  pinColor?: string;
  mapClassName?: string;
  confirmLabel?: string;
  restrictToServiceArea?: boolean;
  onBackToSearch?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const confirmationPending = useRef(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const { area, failed: coverageFailed } = useServiceArea(restrictToServiceArea);
  const checkingCoverage = restrictToServiceArea && !area;

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
          zoomControl: false,
          gestureHandling: "greedy",
        });
        geocoderRef.current = new window.google.maps.Geocoder();
        setReady(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      mapRef.current = null;
      geocoderRef.current = null;
      confirmationPending.current = false;
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !restrictToServiceArea || !area) return;
    const checkCenter = () => {
      const position = map.getCenter();
      const message = area.serviceAreaMessage(area.serviceAreaIssue({ lat: position.lat(), lng: position.lng() }));
      setCoverageError(message);
    };
    const listener = map.addListener("idle", checkCenter);
    checkCenter();
    return () => listener.remove();
  }, [ready, restrictToServiceArea, area]);

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
    if (!map || confirmationPending.current) return;
    const center = map.getCenter();
    const pos = { lat: center.lat(), lng: center.lng() };
    if (restrictToServiceArea && !area) return;
    const unavailable = restrictToServiceArea && area ? area.serviceAreaMessage(area.serviceAreaIssue(pos)) : null;
    setCoverageError(unavailable);
    if (unavailable) return;

    if (!geocoder) {
      onConfirm({ ...pos, label: `Pinned location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})` });
      return;
    }
    confirmationPending.current = true;
    setConfirming(true);
    geocoder.geocode({ location: pos }, (results, status) => {
      if (mapRef.current !== map) return;
      confirmationPending.current = false;
      setConfirming(false);
      const label =
        status === "OK" && results && results[0]
          ? results[0].formatted_address
          : `Pinned location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`;
      onConfirm({ ...pos, label });
    });
  }

  const confirmButton = (
    <Button
      type="button"
      variant={onBackToSearch ? "default" : "outline"}
      size={onBackToSearch ? "default" : "sm"}
      onClick={handleConfirm}
      disabled={failed || !ready || confirming || !!coverageError || checkingCoverage}
      className={onBackToSearch ? "min-h-12 min-w-0 px-2 text-base" : "mt-2 w-full text-xs"}
    >
      {confirming ? <><FetchItLoader className="h-4 w-4" /> Finding your address…</> : confirmLabel}
    </Button>
  );

  const map = failed ? (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
      <p role="alert">The map couldn’t load. Your address is kept.</p>
      <Button type="button" variant="outline" className="min-h-12" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry map</Button>
    </div>
  ) : (
      <div className={`relative overflow-hidden rounded-md border ${onBackToSearch ? "min-h-40 flex-1 sm:min-h-72" : mapClassName}`}>
        <div ref={containerRef} className="absolute inset-0" />
        {!ready && (
          <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground">
            <FetchItLoader className="h-4 w-4 text-muted-foreground" />
            Loading map…
          </div>
        )}
        {ready && <MapZoomControls onZoomIn={() => { const map = mapRef.current; if (map) map.setZoom(Math.min(21, (map.getZoom() ?? 13) + 1)); }} onZoomOut={() => { const map = mapRef.current; if (map) map.setZoom(Math.max(3, (map.getZoom() ?? 13) - 1)); }} />}
        {/* Pin fixed to the center of the viewport — the map pans underneath it. */}
        {ready && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
            <MapPin className="h-9 w-9 drop-shadow-md" style={{ color: pinColor }} fill={pinColor} strokeWidth={1.5} />
          </div>
        )}
      </div>
  );

  if (onBackToSearch) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
          {!failed && <p className="text-sm text-muted-foreground">Drag the map to position the pin.</p>}
          {coverageError && <p role="status" className="text-sm text-destructive">{coverageError}</p>}
          {ready && checkingCoverage && (
            <p role="status" className={coverageFailed ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {coverageFailed ? "Service-area checks couldn’t load. Refresh the page to try again." : "Checking service area…"}
            </p>
          )}
          {map}
        </div>
        <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t bg-background px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" className="min-h-12 px-3 text-sm" onClick={onBackToSearch}>Search address</Button>
          {confirmButton}
        </div>
      </>
    );
  }

  return (
    <div>
      {coverageError && <p role="status" className="mb-2 text-sm text-destructive">{coverageError}</p>}
      {map}
      {ready && <p className="mt-2 text-xs text-muted-foreground">Move the map to position the pin, then confirm the location below.</p>}
      {ready && confirmButton}
    </div>
  );
}
