import { VEHICLES, ROAD_DISTANCE_FACTOR, type VehicleClass } from "./constants";
import { haversineKm } from "./fare";
type Point = { lat: number; lng: number };
type Fix = Point & { riderId: string; createdAt: Date };
const valid = (point: Point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
/** An approximate distance/speed estimate, never a traffic-aware routing prediction. */
export function pickupEstimate(booking: Point & { vehicleClass: VehicleClass; riderId: string | null; matchedAt: Date | null; createdAt: Date }, fix?: Fix | null, now = Date.now()) {
  if (!fix || fix.riderId !== booking.riderId || !valid(booking) || !valid(fix)) return null;
  const age = now - fix.createdAt.getTime();
  if (!Number.isFinite(age) || age < -30000 || age > 90000 || fix.createdAt < (booking.matchedAt ?? booking.createdAt)) return null;
  const speed = VEHICLES[booking.vehicleClass]?.speedKph;
  if (!speed || speed <= 0) return null;
  return { minutes: Math.max(1, Math.ceil(haversineKm(fix, booking) * ROAD_DISTANCE_FACTOR / speed * 60)), locationAt: fix.createdAt.toISOString() };
}
