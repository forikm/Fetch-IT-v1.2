import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextResponse } = require("next/server");

function loadRouteModule(filename, dependencies) {
  const exports = {};
  const source = readFileSync(new URL(filename, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

test("cancelling a reassigned booking notifies the rider assigned when the row is locked", async () => {
  const customer = { uid: "customer", name: "Test customer", role: "CUSTOMER" };
  let booking = { id: "booking", customerId: customer.uid, status: "MATCHED", riderId: "previous-rider" };
  const queuedNotifications = [];
  const { recordBookingEvent } = loadRouteModule("../src/lib/booking-events.ts", {
    "./customer-notifications": { enqueueBookingNotification: async () => {} },
    "./rider-push-tasks": {
      queueRiderPushTask: async (_tx, ...notification) => queuedNotifications.push(notification),
    },
  });
  const tx = {
    $queryRaw: async () => {
      // Reassignment commits after the initial read and before cancellation acquires the lock.
      booking = { ...booking, riderId: "current-rider" };
    },
    booking: {
      updateMany: async ({ where, data }) => {
        assert.equal(where.status, booking.status);
        booking = { ...booking, ...data };
        return { count: 1 };
      },
      findUniqueOrThrow: async () => booking,
    },
    bookingEvent: { create: async ({ data }) => ({ ...data, id: "cancellation-event" }) },
    autoDispatch: { updateMany: async () => ({ count: 0 }) },
  };
  const db = {
    booking: { findUnique: async () => booking },
    $transaction: async run => run(tx),
  };
  const { POST } = loadRouteModule("../src/app/api/bookings/[id]/cancel/route.ts", {
    "next/server": { NextResponse },
    "@/lib/db": { db },
    "@/lib/booking-events": { recordBookingEvent },
    "@/lib/customer-access": {
      requireCustomer: async () => customer,
      customerErrorResponse: error => { throw error; },
    },
    "@/lib/db-data": { bookingView: row => row },
    "@/lib/demo-payments": { cancelDemoPayment: async () => {} },
    "@/lib/request-guard": { withRequestLog: (_name, fn) => fn, RateLimitError: class extends Error {} },
    "@/lib/ticket": { omitTicket: row => row },
  });

  const response = await POST(
    { json: async () => ({ reason: "Changed plans" }) },
    { params: Promise.resolve({ id: booking.id }) },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).booking.status, "CANCELLED");
  assert.deepEqual(queuedNotifications, [["booking", "CANCELLED", "cancellation-event", "current-rider"]]);
});
