export type RoadPoint = { lat: number; lng: number };
export type RoadRoute = { path: RoadPoint[]; warnings: string[] };

const pending = new Map<string, Promise<RoadRoute>>();
export function roadRouteKey(pickup: RoadPoint, dropoff: RoadPoint) {
  return [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng].join(",");
}
function valid(point: RoadPoint) {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

/** Share simultaneous preview/tracking requests; retain no completed route cache. */
export function requestRoadRoute(pickup: RoadPoint, dropoff: RoadPoint): Promise<RoadRoute> {
  if (!valid(pickup) || !valid(dropoff)) return Promise.reject(new Error("Invalid route locations."));
  const key = roadRouteKey(pickup, dropoff);
  const existing = pending.get(key);
  if (existing) return existing;
  let timer: ReturnType<typeof setTimeout>;
  const computation = (async () => {
    const { Route } = await window.google.maps.importLibrary("routes");
    const result = await Route.computeRoutes({
      origin: pickup, destination: dropoff, travelMode: "DRIVING",
      fields: ["path", "warnings"],
    });
    const route = result.routes?.[0];
    const path = route?.path?.map(point => ({ lat: point.lat, lng: point.lng }));
    if (!path || path.length < 2 || !path.every(valid)) throw new Error("No road route found.");
    return { path, warnings: route?.warnings ?? [] };
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Road routing timed out.")), 15000);
  });
  const request = Promise.race([computation, timeout]).finally(() => {
    clearTimeout(timer);
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}
