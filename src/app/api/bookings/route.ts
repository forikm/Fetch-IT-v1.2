// /api/bookings
// GET — list bookings for the current user (as customer or rider).
// POST — create a new booking (customer only), auto-runs the matching engine.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { VEHICLES, type VehicleClass } from "@/lib/constants";
import { quoteFare, generateRefCode } from "@/lib/fare";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") || "active"; // active | history | all

  const where =
    session.role === "CUSTOMER"
      ? { customerId: session.uid }
      : session.role === "RIDER"
        ? { riderId: session.uid }
        : {};

  const statusFilter =
    filter === "active"
      ? { status: { in: ["PENDING", "MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] } }
      : filter === "history"
        ? { status: { in: ["DELIVERED", "CANCELLED"] } }
        : {};

  const bookings = await db.booking.findMany({
    where: { ...where, ...statusFilter },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      rider: {
        select: {
          id: true,
          name: true,
          phone: true,
          vehicleClass: true,
          vehiclePlate: true,
          lat: true,
          lng: true,
          rating: true,
        },
      },
      deliveryProofs: true,
    },
    take: 100,
  });

  return NextResponse.json({ bookings });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "CUSTOMER") {
      return NextResponse.json(
        { error: "Only customers can create bookings." },
        { status: 403 },
      );
    }
    const requester = await db.user.findUnique({ where: { id: session.uid } });
    if (requester?.isBanned) {
      return NextResponse.json(
        { error: "Your account has been restricted and can't create new bookings." },
        { status: 403 },
      );
    }

    const body = await req.json();
    const {
      pickup,
      dropoff,
      vehicleClass,
      cargoWeightKg,
      cargoNotes,
      scheduledAt,
    } = body as {
      pickup: { lat: number; lng: number; label: string };
      dropoff: { lat: number; lng: number; label: string };
      vehicleClass: VehicleClass;
      cargoWeightKg: number;
      cargoNotes?: string;
      scheduledAt?: string;
    };

    if (
      !pickup ||
      !dropoff ||
      !vehicleClass ||
      !VEHICLES[vehicleClass] ||
      cargoWeightKg == null
    ) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }
    if (cargoWeightKg > VEHICLES[vehicleClass].capacityKg) {
      return NextResponse.json(
        { error: "Cargo exceeds vehicle capacity." },
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
    const { distanceKm, surgeMultiplier, fare } = quote;
    const eta = quote.etaMinutes;

    const refCode = generateRefCode();

    // Create the booking as PENDING and leave it unassigned. It now sits on
    // the open jobs board (see /api/rider/available) until a real rider
    // claims it via PATCH /api/bookings/[id] — no auto-matching here.
    const booking = await db.booking.create({
      data: {
        refCode,
        customerId: session.uid,
        pickupLabel: pickup.label,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffLabel: dropoff.label,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        vehicleClass,
        cargoWeightKg,
        cargoNotes: cargoNotes ?? null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        distanceKm,
        baseFare: fare.baseFare,
        surgeMultiplier,
        totalFare: fare.totalFare,
        currency: fare.currency,
        status: "PENDING",
        etaMinutes: eta,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        rider: true,
      },
    });

    return NextResponse.json({ booking });
  } catch (err) {
    console.error("[bookings POST] error", err);
    return NextResponse.json(
      { error: "Failed to create booking." },
      { status: 500 },
    );
  }
}