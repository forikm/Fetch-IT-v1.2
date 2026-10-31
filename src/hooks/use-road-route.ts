"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { requestRoadRoute, roadRouteKey, type RoadPoint, type RoadRoute } from "@/lib/road-route";

export function useRoadRoute(mapRef: RefObject<google.maps.Map | null>, ready: boolean, pickup: RoadPoint, dropoff: RoadPoint, extraPoints: (RoadPoint | null)[], mapVersion = 0) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; route?: RoadRoute; error?: string } | null>(null);
  const extras = useRef(extraPoints);
  useEffect(() => { extras.current = extraPoints; }, [extraPoints]);
  const key = roadRouteKey(pickup, dropoff) + ":" + attempt + ":" + mapVersion;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false;
    let line: google.maps.Polyline | null = null;
    void requestRoadRoute({ lat: pickup.lat, lng: pickup.lng }, { lat: dropoff.lat, lng: dropoff.lng }).then(route => {
      if (cancelled) return;
      line = new window.google.maps.Polyline({
        map, path: route.path, strokeColor: "#ea580c", strokeOpacity: 0.9, strokeWeight: 5,
      });
      const bounds = new window.google.maps.LatLngBounds();
      for (const point of [pickup, dropoff, ...route.path, ...extras.current]) if (point) bounds.extend(point);
      map.fitBounds(bounds, 64);
      setState({ key, route });
    }).catch(() => {
      if (!cancelled) setState({ key, error: "Road route unavailable. Pickup and drop-off pins are still shown." });
    });
    return () => { cancelled = true; line?.setMap(null); };
  }, [mapRef, ready, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, key]);
  const current = state?.key === key ? state : null;
  return {
    loading: ready && !current,
    error: current?.error ?? null,
    path: current?.route?.path ?? [],
    warnings: current?.route?.warnings ?? [],
    retry: () => setAttempt(value => value + 1),
  };
}
