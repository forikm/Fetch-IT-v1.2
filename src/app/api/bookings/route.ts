import { bookingView, riderSelect } from "@/lib/db-data";
import type { Prisma } from "@prisma/client";
// /api/bookings
// GET — list bookings for the signed-in customer, optionally
//       filtered by product type (?type=DELIVERY|RIDE).
// POST — create a new booking (customer only):
//        • type=DELIVERY (default) — cargo booking with weight-based fare
//        • type=RIDE               — passenger booking with upfront fare
//        Newly created bookings sit on the open jobs board
//        (/api/rider/available) until a rider claims them.

import { NextRequest, NextResponse } from "next/server";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
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
  try {
    const session = await requireCustomer();

    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "active"; // active | history | all
    const type = url.searchParams.get("type");
    const query = url.searchParams.get("q")?.trim().slice(0, 200);
    const status = url.searchParams.get("status");
    const cursor = url.searchParams.get("cursor");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))) throw new CustomerError("Choose valid history dates.", 400);

    const where = { customerId: session.uid };

    const statusFilter: Prisma.BookingWhereInput =
      filter === "active"
        ? { status: { in: ["PENDING", "MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] } }
        : filter === "history"
          ? { status: { in: ["DELIVERED", "CANCELLED"] } }
          : {};

    const bookings = await db.booking.findMany({
      where: {
        ...where,
        ...statusFilter,
        ...(filter === "history" && (status === "DELIVERED" || status === "CANCELLED") ? { status } : {}),
        ...(filter === "history" && query ? { OR: [{ refCode: { contains: query, mode: "insensitive" as const } }, { pickupLabel: { contains: query, mode: "insensitive" as const } }, { dropoffLabel: { contains: query, mode: "insensitive" as const } }] } : {}),
        ...(filter === "history" && (from || to) ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
        ...(type === "DELIVERY" || type === "RIDE" ? { type } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        rider: { select: riderSelect },
        liveLocation: { select: { lat: true, lng: true, createdAt: true } },
        deliveryProofs: true,
      },
      take: 101,
    });

    // This is the customer app — the R0001/D0001 tracking ticket is a
    // rider-only artifact (see src/lib/ticket.ts) and never leaves the server
    // here.
    const page = bookings.slice(0, 100);
    return NextResponse.json({ bookings: page.map(b => omitTicket(bookingView(b))), nextCursor: bookings.length > 100 ? page[page.length - 1].id : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
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
    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduledDate && (!Number.isFinite(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now())) {
      return NextResponse.json({ error: "Choose a future pickup time." }, { status: 400 });
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
        when: scheduledDate ?? new Date(),
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
            scheduledAt: scheduledDate,
            distanceKm: quote.distanceKm,
            baseFare: quote.fare.baseFare,
            surgeMultiplier: quote.surgeMultiplier,
            totalFare: quote.fare.totalFare,
            currency: quote.fare.currency,
            status: "PENDING",
            events: { create: { actorId: session.uid, actorName: session.name, actorRole: "CUSTOMER", action: "CREATED", toStatus: "PENDING" } },
            etaMinutes: quote.etaMinutes,
          },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            rider: { select: riderSelect },
          },
        });
      });

      return NextResponse.json({ booking: omitTicket(bookingView(booking)) });
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
      when: scheduledDate ?? new Date(),
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
          scheduledAt: scheduledDate,
          distanceKm,
          baseFare: fare.baseFare,
          surgeMultiplier,
          totalFare: fare.totalFare,
          currency: fare.currency,
          status: "PENDING",
          events: { create: { actorId: session.uid, actorName: session.name, actorRole: "CUSTOMER", action: "CREATED", toStatus: "PENDING" } },
          etaMinutes: eta,
        },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          rider: { select: riderSelect },
        },
      });
    });

    return NextResponse.json({ booking: omitTicket(bookingView(booking)) });
  } catch (err) {
    console.error("[bookings POST] error", err);
    return NextResponse.json(
      { error: "Failed to create booking." },
      { status: 500 },
    );
  }
}
