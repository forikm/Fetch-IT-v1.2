// POST /api/fare/estimate
// Body: {
//   pickup:     { lat, lng, label? },
//   dropoff:    { lat, lng, label? },
//   vehicleClass,
//   cargoWeightKg,
//   scheduledAt?: ISO string (changes surge based on scheduled hour)
// }
// Returns the FareBreakdown + distanceKm + etaMinutes.

import { NextRequest, NextResponse } from "next/server";
import { haversineKm, computeFare, etaMinutes } from "@/lib/fare";
import {
  VEHICLES,
  computeSurgeMultiplier,
  type VehicleClass,
} from "@/lib/constants";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pickup, dropoff, vehicleClass, cargoWeightKg, scheduledAt } =
      body as {
        pickup: { lat: number; lng: number; label?: string };
        dropoff: { lat: number; lng: number; label?: string };
        vehicleClass: VehicleClass;
        cargoWeightKg: number;
        scheduledAt?: string;
      };

    if (
      !pickup ||
      !dropoff ||
      !vehicleClass ||
      cargoWeightKg == null ||
      !VEHICLES[vehicleClass]
    ) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    const distanceKm = haversineKm(pickup, dropoff);
    const surgeDate = scheduledAt ? new Date(scheduledAt) : new Date();
    const surgeMultiplier = computeSurgeMultiplier(surgeDate);
    const v = VEHICLES[vehicleClass];

    if (cargoWeightKg > v.capacityKg) {
      return NextResponse.json(
        {
          error: `Cargo weight exceeds ${v.label} capacity (${v.capacityKg} kg). Choose a larger vehicle.`,
        },
        { status: 400 },
      );
    }

    const fare = computeFare({
      distanceKm,
      cargoWeightKg,
      surgeMultiplier,
      vehicleBaseFare: v.baseFare,
      vehiclePerKm: v.perKm,
      vehicleCapacityKg: v.capacityKg,
    });

    const eta = etaMinutes(distanceKm, v.speedKph);

    return NextResponse.json({
      distanceKm: Math.round(distanceKm * 100) / 100,
      surgeMultiplier,
      fare,
      etaMinutes: eta,
      vehicle: {
        id: v.id,
        label: v.label,
        capacityKg: v.capacityKg,
      },
    });
  } catch (err) {
    console.error("[fare/estimate] error", err);
    return NextResponse.json(
      { error: "Failed to compute fare." },
      { status: 500 },
    );
  }
}
