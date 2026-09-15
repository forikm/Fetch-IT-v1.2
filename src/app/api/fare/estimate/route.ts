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
import { quoteFare } from "@/lib/fare";
import { VEHICLES, type VehicleClass } from "@/lib/constants";

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

    if (cargoWeightKg < 0 || !Number.isFinite(cargoWeightKg)) {
      return NextResponse.json(
        { error: "Enter a valid cargo weight." },
        { status: 400 },
      );
    }

    const v = VEHICLES[vehicleClass];
    if (cargoWeightKg > v.capacityKg) {
      return NextResponse.json(
        {
          error: `Cargo weight exceeds ${v.label} capacity (${v.capacityKg} kg). Choose a larger vehicle.`,
        },
        { status: 400 },
      );
    }

    const quote = quoteFare({
      pickup,
      dropoff,
      vehicleClass,
      cargoWeightKg,
      when: scheduledAt ? new Date(scheduledAt) : new Date(),
    });

    return NextResponse.json({
      distanceKm: quote.distanceKm,
      straightLineKm: quote.straightLineKm,
      surgeMultiplier: quote.surgeMultiplier,
      fare: quote.fare,
      etaMinutes: quote.etaMinutes,
      vehicle: {
        id: v.id,
        label: v.label,
        capacityKg: v.capacityKg,
        freeWeightKg: v.freeWeightKg,
        includedKm: v.includedKm,
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