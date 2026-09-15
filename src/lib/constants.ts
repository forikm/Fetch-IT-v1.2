// Fetch-It domain constants — vehicle classes, fares, statuses.
// Kept in a single place so the UI and API agree on values.

export type Role = "CUSTOMER" | "RIDER" | "ADMIN";

export type VehicleClass =
  | "MOTORCYCLE"
  | "SEDAN"
  | "CLOSED_VAN"
  | "FLATBED"
  | "REFRIGERATED";

export type BookingStatus =
  | "PENDING"
  | "MATCHED"
  | "ACCEPTED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";

export type ProofType = "SIGNATURE" | "OTP" | "PHOTO";

export interface VehicleMeta {
  id: VehicleClass;
  label: string;
  description: string;
  baseFare: number;       // PHP
  perKm: number;         // PHP per km
  capacityKg: number;
  icon: string;           // emoji or short tag used by UI
  speedKph: number;       // assumed average speed for ETA
}

export const VEHICLES: Record<VehicleClass, VehicleMeta> = {
  MOTORCYCLE: {
    id: "MOTORCYCLE",
    label: "Motorcycle",
    description: "Best for small parcels under 20 kg in dense urban traffic.",
    baseFare: 3.5,
    perKm: 0.85,
    capacityKg: 20,
    icon: "moto",
    speedKph: 28,
  },
  SEDAN: {
    id: "SEDAN",
    label: "Sedan",
    description: "Ideal for documents and small packages up to 80 kg.",
    baseFare: 5.0,
    perKm: 1.05,
    capacityKg: 80,
    icon: "car",
    speedKph: 35,
  },
  CLOSED_VAN: {
    id: "CLOSED_VAN",
    label: "Closed Van",
    description: "Weather-protected cargo up to 1,000 kg, perfect for retail and e-commerce.",
    baseFare: 8.5,
    perKm: 1.45,
    capacityKg: 1000,
    icon: "van",
    speedKph: 38,
  },
  FLATBED: {
    id: "FLATBED",
    label: "Flatbed",
    description: "Open-bed hauler for oversized cargo up to 5,000 kg.",
    baseFare: 14.0,
    perKm: 2.1,
    capacityKg: 5000,
    icon: "truck",
    speedKph: 32,
  },
  REFRIGERATED: {
    id: "REFRIGERATED",
    label: "Refrigerated",
    description: "Cold-chain transport for groceries, pharma and perishables.",
    baseFare: 18.0,
    perKm: 2.6,
    capacityKg: 2000,
    icon: "refrigerator",
    speedKph: 32,
  },
};

export const VEHICLE_LIST = Object.values(VEHICLES);

export const BOOKING_STATUS_FLOW: BookingStatus[] = [
  "PENDING",
  "MATCHED",
  "ACCEPTED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
];

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "Awaiting rider",
  MATCHED: "Rider matched",
  ACCEPTED: "Rider en route",
  PICKED_UP: "Package picked up",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

// Surge multiplier based on local hour of day (24h clock).
// Mirrors typical ride-hailing demand curves.
export function computeSurgeMultiplier(date: Date = new Date()): number {
  const h = date.getHours();
  if (h >= 7 && h <= 9) return 1.4;   // morning rush
  if (h >= 16 && h <= 19) return 1.6; // evening rush
  if (h >= 22 || h <= 5) return 1.2;   // late-night scarcity
  return 1.0;
}

export const CURRENCY = "PHP";
export const CURRENCY_SYMBOL = "₱";
