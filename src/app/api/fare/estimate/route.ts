// POST /api/fare/estimate
// Body: {
//   type:       "DELIVERY" | "RIDE"   (default DELIVERY)
//   pickup:     { lat, lng, label? },
//   dropoff:    { lat, lng, label? },
//   vehicleClass,
//   cargoWeightKg,                    (DELIVERY only)
//   passengers?,                      (RIDE only, 1–4, informational)
//   scheduledAt?: ISO string          (changes surge based on scheduled hour)
// }
// Returns the FareBreakdown + distanceKm + etaMinutes.

import { NextRequest, NextResponse } from "next/server";
import { quoteFare, quoteRideFare } from "@/lib/fare";
import { VEHICLES, type VehicleClass } from "@/lib/constants";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      type = "DELIVERY",
      pickup,
      dropoff,
      vehicleClass,
      cargoWeightKg,
      scheduledAt,
    } = body as {
      type?: "DELIVERY" | "RIDE";
      pickup: { lat: number; lng: number; label?: string };
      dropoff: { lat: number; lng: number; label?: string };
      vehicleClass: VehicleClass;
      cargoWeightKg?: number;
      passengers?: number;
      scheduledAt?: string;
    };

    if (!pickup || !dropoff || !vehicleClass || !VEHICLES[vehicleClass]) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    const when = scheduledAt ? new Date(scheduledAt) : new Date();

    if (type === "RIDE") {
      const quote = quoteRideFare({ pickup, dropoff, vehicleClass, when });
      return NextResponse.json({
        distanceKm: quote.distanceKm,
        straightLineKm: quote.straightLineKm,
        surgeMultiplier: quote.surgeMultiplier,
        fare: quote.fare,
        etaMinutes: quote.etaMinutes,
        vehicle: {
          id: quote.vehicle.id,
          label: quote.vehicle.label,
          includedKm: quote.vehicle.includedKm,
        },
      });
    }

    const weight = Number(cargoWeightKg ?? 1);
    if (cargoWeightKg == null || !Number.isFinite(weight) || weight < 0) {
      return NextResponse.json(
        { error: "Enter a valid cargo weight." },
        { status: 400 },
      );
    }

    const v = VEHICLES[vehicleClass];
    if (weight > v.capacityKg) {
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
      cargoWeightKg: weight,
      when,
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
