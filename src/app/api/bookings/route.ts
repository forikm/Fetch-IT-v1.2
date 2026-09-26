// /api/bookings
// GET — list bookings for the current user (as customer or rider), optionally
//       filtered by product type (?type=DELIVERY|RIDE).
// POST — create a new booking (customer only):
//        • type=DELIVERY (default) — cargo booking with weight-based fare
//        • type=RIDE               — passenger booking with upfront fare
//        Newly created bookings sit on the open jobs board
//        (/api/rider/available) until a rider claims them.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  VEHICLES,
  RIDE_VEHICLE_CLASSES,
  type VehicleClass,
} from "@/lib/constants";
import { quoteFare, quoteRideFare, generateRefCode } from "@/lib/fare";
import { generateTicketId, omitTicket } from "@/lib/ticket";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") || "active"; // active | history | all
  const type = url.searchParams.get("type"); // DELIVERY | RIDE | undefined

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
    where: {
      ...where,
      ...statusFilter,
      ...(type === "DELIVERY" || type === "RIDE" ? { type } : {}),
    },
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
          rating: true,
        },
      },
      trackingUpdates: {
        where: { source: "NATIVE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { lat: true, lng: true, createdAt: true },
      },
      deliveryProofs: true,
    },
    take: 100,
  });

  // This is the customer app — the R0001/D0001 tracking ticket is a
  // rider-only artifact (see src/lib/ticket.ts) and never leaves the server
  // here.
  return NextResponse.json({ bookings: bookings.map(omitTicket) });
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
      type = "DELIVERY",
      pickup,
      dropoff,
      vehicleClass,
      cargoWeightKg,
      cargoNotes,
      scheduledAt,
      passengers,
    } = body as {
      type?: "DELIVERY" | "RIDE";
      pickup: { lat: number; lng: number; label: string };
      dropoff: { lat: number; lng: number; label: string };
      vehicleClass: VehicleClass;
      cargoWeightKg?: number;
      cargoNotes?: string;
      scheduledAt?: string;
      passengers?: number;
    };

    if (!pickup || !dropoff || !vehicleClass || !VEHICLES[vehicleClass]) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }
    if (!pickup.label || !dropoff.label) {
      return NextResponse.json(
        { error: "Pickup and drop-off addresses are required." },
        { status: 400 },
      );
    }

    const isRide = type === "RIDE";

    if (isRide) {
      // ---------- RIDE ----------
      if (!RIDE_VEHICLE_CLASSES.includes(vehicleClass)) {
        return NextResponse.json(
          { error: "Invalid ride class. Choose motorcycle, tricycle or sedan." },
          { status: 400 },
        );
      }
      const pax = Number(passengers ?? 1);
      if (!Number.isInteger(pax) || pax < 1 || pax > 4) {
        return NextResponse.json(
          { error: "Passengers must be between 1 and 4." },
          { status: 400 },
        );
      }

      const quote = quoteRideFare({
        pickup,
        dropoff,
        vehicleClass,
        when: scheduledAt ? new Date(scheduledAt) : new Date(),
      });

      const booking = await db.$transaction(async (tx) => {
        const ticketId = await generateTicketId(tx, "RIDE");
        return tx.booking.create({
          data: {
            refCode: generateRefCode("RIDE"),
            ticketId,
            type: "RIDE",
            customerId: session.uid,
            pickupLabel: pickup.label,
            pickupLat: pickup.lat,
            pickupLng: pickup.lng,
            dropoffLabel: dropoff.label,
            dropoffLat: dropoff.lat,
            dropoffLng: dropoff.lng,
            vehicleClass,
            cargoWeightKg: 0,
            passengers: pax,
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            distanceKm: quote.distanceKm,
            baseFare: quote.fare.baseFare,
            surgeMultiplier: quote.surgeMultiplier,
            totalFare: quote.fare.totalFare,
            currency: quote.fare.currency,
            status: "PENDING",
            etaMinutes: quote.etaMinutes,
          },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            rider: true,
          },
        });
      });

      return NextResponse.json({ booking: omitTicket(booking) });
    }

    // ---------- DELIVERY ----------
    // Motorcycles and tricycles carry parcels too, so every class is fair
    // game here — the weight validation below keeps classes honest.
    const weight = Number(cargoWeightKg ?? 1);
    if (!Number.isFinite(weight) || weight <= 0) {
      return NextResponse.json(
        { error: "Enter a valid cargo weight." },
        { status: 400 },
      );
    }
    if (weight > VEHICLES[vehicleClass].capacityKg) {
      return NextResponse.json(
        { error: "Cargo exceeds vehicle capacity." },
        { status: 400 },
      );
    }

    const quote = quoteFare({
      pickup,
      dropoff,
      vehicleClass,
      cargoWeightKg: weight,
      when: scheduledAt ? new Date(scheduledAt) : new Date(),
    });
    const { distanceKm, surgeMultiplier, fare } = quote;
    const eta = quote.etaMinutes;

    const booking = await db.$transaction(async (tx) => {
      const ticketId = await generateTicketId(tx, "DELIVERY");
      return tx.booking.create({
        data: {
          refCode: generateRefCode("FIT"),
          ticketId,
          type: "DELIVERY",
          customerId: session.uid,
          pickupLabel: pickup.label,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffLabel: dropoff.label,
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
          vehicleClass,
          cargoWeightKg: weight,
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
    });

    return NextResponse.json({ booking: omitTicket(booking) });
  } catch (err) {
    console.error("[bookings POST] error", err);
    return NextResponse.json(
      { error: "Failed to create booking." },
      { status: 500 },
    );
  }
}
