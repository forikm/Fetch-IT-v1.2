import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";

const data = JSON.parse(fs.readFileSync(new URL("../public/service-area-data.json", import.meta.url), "utf8"));
function load(file, dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, console, Date, Buffer, Response, require(name) {
    if (name in dependencies) return dependencies[name];
    throw Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
const area = load("../src/lib/service-area.ts", { "../../public/service-area-data.json": data });
const lingayen = { lat: 16.0206, lng: 120.2321, label: "Lingayen" };
const dagupan = { lat: 16.0433, lng: 120.3333, label: "Dagupan" };
const manila = { lat: 14.6, lng: 120.98, label: "Forged label: Pangasinan" };
const gulf = { lat: 16.1, lng: 120.23, label: "Lingayen" };
const pantal = { lat: 16.045, lng: 120.329, label: "Pantal River" };

test("Pangasinan land coverage includes Lingayen, Dagupan, Urdaneta and Alaminos", () => {
  for (const point of [lingayen, dagupan, { lat: 15.975, lng: 120.571 }, { lat: 16.155, lng: 119.98 }]) assert.equal(area.serviceAreaIssue(point), null);
});
test("province shape excludes Baguio, Manila, adjacent provinces and Lingayen Gulf despite matching labels", () => {
  for (const point of [manila, gulf, { lat: 16.413, lng: 120.596 }, { lat: 15.485, lng: 120.59 }]) assert.equal(area.serviceAreaIssue(point), "outside");
});
test("mapped inland water is unavailable even with a nearby street label", () => {
  assert.equal(area.serviceAreaIssue(pantal), "water");
  assert.match(area.bookingServiceAreaError(lingayen, pantal), /Area unavailable for drop-off.*land/);
});
test("missing, nonnumeric and nonfinite coordinates cannot pass coverage", () => {
  for (const value of [null, {}, { lat: "16.02", lng: 120.23 }, { lat: NaN, lng: 120.23 }, { lat: 16, lng: Infinity }, { lat: 91, lng: 120 }]) assert.equal(area.serviceAreaIssue(value), "invalid");
});

function handlers() {
  const calls = { quotes: 0, writes: 0 };
  const quote = () => { calls.quotes++; return { distanceKm: 10, straightLineKm: 8, surgeMultiplier: 1, fare: { totalFare: 100, baseFare: 50, currency: "PHP" }, etaMinutes: 20, vehicle: { id: "MOTORCYCLE", label: "Motor", includedKm: 1 } }; };
  const session = { uid: "fixture", name: "Fixture", role: "CUSTOMER" };
  class CustomerError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const dependencies = {
    "next/server": { NextResponse: Response },
    "@/lib/service-area": area,
    "@/lib/request-guard": { withRequestLog: (_, fn) => fn, limitRequests: async () => {}, safeErrorCode: () => "TEST" },
    "@/lib/fare": { quoteFare: quote, quoteRideFare: quote },
    "@/lib/constants": { isBookingVehicle: v => v === "MOTORCYCLE", PASSENGER_CAPACITY: { MOTORCYCLE: 1 }, VEHICLES: { MOTORCYCLE: { capacityKg: 20 } } },
    "@/lib/platform-settings": { platformSettings: async () => ({ settings: { rideEnabled: true, deliveryEnabled: true, vehicles: ["MOTORCYCLE"] } }) },
    "@/lib/pickup-schedule": { parsePickupSchedule: () => null },
    "@/lib/session": { getSession: async () => session },
    "@/lib/customer-access": { CustomerError, requireCustomer: async () => session, customerErrorResponse: error => Response.json({ error: error.message }, { status: error.status }) },
    "@/lib/db": { db: { user: { findUnique: async () => ({ role: "CUSTOMER", isBanned: false }) } } },
    "@/lib/booking-create": { bookingAttemptId: () => "fixture-attempt", findBookingAttempt: async () => null, createBookingWithRetry: async () => { calls.writes++; return {}; } },
    "@/lib/db-data": { bookingView: b => b },
    "@/lib/ticket": { omitTicket: b => b },
    "@/lib/payment-policy": { PAYMENT_METHOD_LABEL: { CASH: "Cash" }, isDemoPayment: () => false },
    "@/lib/online-checkout": { prepareOnlineCheckout: async () => { calls.writes++; return {}; } },
    "@/lib/dispatch": {},
  };
  return { calls, fare: load("../src/app/api/fare/estimate/route.ts", dependencies).POST, booking: load("../src/app/api/bookings/route.ts", dependencies).POST };
}
test("both APIs reject forged unavailable pickup and drop-off for rides and deliveries before any quote or booking write", async () => {
  const { calls, fare, booking } = handlers();
  for (const handler of [fare, booking]) for (const type of ["RIDE", "DELIVERY"]) for (const side of ["pickup", "dropoff"]) for (const point of [manila, gulf, pantal]) {
    const body = { pickup: lingayen, dropoff: dagupan, vehicleClass: "MOTORCYCLE", cargoWeightKg: 2, passengers: 1, type, [side]: point };
    const response = await handler(new Request("https://fixture.invalid/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /Area unavailable/);
  }
  assert.equal(calls.quotes, 0);
  assert.equal(calls.writes, 0);
});
test("valid Pangasinan route still gets a fare for both services", async () => {
  const { fare } = handlers();
  for (const type of ["RIDE", "DELIVERY"]) {
    const response = await fare(new Request("https://fixture.invalid/api", { method: "POST", body: JSON.stringify({ pickup: lingayen, dropoff: dagupan, vehicleClass: "MOTORCYCLE", cargoWeightKg: 2, passengers: 1, type }) }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).fare.totalFare, 100);
  }
});

test("an older out-of-area online draft cannot become a booking; cancellation still works", async () => {
  let writes = 0;
  class PaymentError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const transaction = {
    demoCheckout: { findUnique: async () => ({ draftId: "draft" }), findUniqueOrThrow: async () => ({ id: "checkout", status: "PENDING" }), update: async () => { writes++; } },
    checkoutDraft: { findUniqueOrThrow: async () => ({ id: "draft", customerId: "fixture", expiresAt: new Date(Date.now() + 100000), bookingData: { type: "DELIVERY", paymentMethod: "DEMO_GCASH", pickupLat: manila.lat, pickupLng: manila.lng, dropoffLat: dagupan.lat, dropoffLng: dagupan.lng } }) },
    $queryRaw: async () => [],
  };
  const { resolveOnlineCheckout } = load("../src/lib/online-checkout.ts", {
    "node:crypto": crypto, "./service-area": area, "./customer-access": {}, "./payments": { PaymentError },
    "./ticket": {}, "./fare": {}, "./payment-policy": { isDemoPayment: () => true },
    "./receipt-email": { scheduleReceiptDelivery: () => { throw Error("Must not send mail"); } },
  });
  const db = { $transaction: async fn => fn(transaction) }, actor = { uid: "fixture", role: "CUSTOMER" };
  await assert.rejects(resolveOnlineCheckout(db, "checkout", actor, "SUCCEEDED"), error => error.status === 422 && /Area unavailable/.test(error.message));
  assert.equal(writes, 0);
  assert.equal(await resolveOnlineCheckout(db, "checkout", actor, "CANCELLED"), null);
  assert.equal(writes, 1);
});
