// Haversine + fare utilities — pure functions shared by API and client.

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export interface FareInput {
  distanceKm: number;
  cargoWeightKg: number;
  surgeMultiplier: number;
  vehicleBaseFare: number;
  vehiclePerKm: number;
  vehicleCapacityKg: number;
}

export interface FareBreakdown {
  baseFare: number;
  distanceFare: number;
  weightFare: number;
  surgeFare: number;
  totalFare: number;
  currency: string;
}

/**
 * Fare estimator.
 * total = (baseFare + distanceFare + weightFare) * surge
 * - distanceFare  = distanceKm * perKm
 * - weightFare    = (cargoWeightKg / capacityKg) * 0.4 * baseFare  (capacity-utilization fee)
 * - surge applies as a multiplier on the subtotal
 */
export function computeFare(input: FareInput): FareBreakdown {
  const baseFare = round2(input.vehicleBaseFare);
  const distanceFare = round2(input.distanceKm * input.vehiclePerKm);
  const utilization = Math.min(1, input.cargoWeightKg / input.vehicleCapacityKg);
  const weightFare = round2(utilization * 0.4 * baseFare);
  const subtotal = baseFare + distanceFare + weightFare;
  const surgeFare = round2((input.surgeMultiplier - 1) * subtotal);
  const totalFare = round2(subtotal * input.surgeMultiplier);
  return {
    baseFare,
    distanceFare,
    weightFare,
    surgeFare,
    totalFare,
    currency: "PHP",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function etaMinutes(distanceKm: number, speedKph: number): number {
  if (speedKph <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / speedKph) * 60));
}

export function generateRefCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "FIT-";
  for (let i = 0; i < 5; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
