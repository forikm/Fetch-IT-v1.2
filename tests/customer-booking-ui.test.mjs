import { test } from "node:test";
import assert from "node:assert/strict";
import { customerProgress, customerStatusLabel, formatPeso, locationUpdateLabel, routeTimeLabel } from "../src/lib/customer-booking-ui.ts";

test("all backend states map to the four customer stages without inventing pickup arrival", () => {
  for (const type of ["DELIVERY", "RIDE"]) {
    for (const [status, current] of Object.entries({ PENDING: 0, MATCHED: 0, ACCEPTED: 1, PICKED_UP: 2, IN_TRANSIT: 2, DELIVERED: 3 })) {
      const progress = customerProgress(status, type);
      assert.equal(progress.current, current);
      assert.equal(progress.stages.length, 4);
      assert.equal(customerStatusLabel(status, type), progress.stages[current]);
    }
    assert.equal(customerProgress("CANCELLED", type).current, -1);
    assert.equal(customerStatusLabel("CANCELLED", type), "Cancelled");
  }
});

test("matching, accepting, pickup and transit retain truthful distinct messages", () => {
  assert.match(customerProgress("MATCHED", "RIDE").message, /Waiting for acceptance/);
  assert.match(customerProgress("ACCEPTED", "RIDE").message, /on the way to your pickup/);
  assert.doesNotMatch(customerProgress("ACCEPTED", "RIDE").message, /on board|arrived/i);
  assert.match(customerProgress("PICKED_UP", "RIDE").message, /on board/);
  assert.match(customerProgress("PICKED_UP", "DELIVERY").message, /package has been picked up/);
  assert.match(customerProgress("IN_TRANSIT", "DELIVERY").message, /on the way to drop-off/);
  assert.equal(customerProgress("DELIVERED", "RIDE").label, "Arrived");
  assert.equal(customerProgress("DELIVERED", "DELIVERY").label, "Delivered");
});

test("scheduled bookings do not promise that matching or travel has already started", () => {
  for (const type of ["RIDE", "DELIVERY"]) {
    const progress = customerProgress("PENDING", type, true);
    assert.equal(progress.current, 0);
    assert.match(progress.message, /when pickup is due/);
    assert.doesNotMatch(progress.message, /on the way/);
  }
});

test("currency and route duration labels stay consistent and do not claim a pickup ETA", () => {
  assert.equal(formatPeso(89), "₱89.00");
  assert.equal(formatPeso(1200.5), "₱1,200.50");
  assert.equal(routeTimeLabel("RIDE"), "Est. trip duration");
  assert.equal(routeTimeLabel("DELIVERY"), "Est. delivery duration");
});

test("location freshness handles recent, older and malformed updates", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assert.match(locationUpdateLabel("2026-10-28T11:59:50Z", now), /just now/);
  assert.match(locationUpdateLabel("2026-10-28T11:58:00Z", now), /2 min ago/);
  assert.match(locationUpdateLabel("2026-10-28T10:00:00Z", now), /PH time/);
  assert.match(locationUpdateLabel("invalid", now), /unavailable/);
  assert.match(locationUpdateLabel("2026-10-28T11:59:50Z", now, "RIDE"), /^Driver location updated/);
});
