import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingStatusWhere, isActiveBooking } from "../src/lib/booking-status-query.ts";

test("status checks retain ownership and include a tracked booking after completion", () => {
  const where = bookingStatusWhere("customer-a", ["completed-booking"], false);
  assert.equal(where.customerId, "customer-a");
  assert.deepEqual(where.OR[1], { id: { in: ["completed-booking"] } });
  assert.ok(where.OR[0].status.in.includes("ACCEPTED"));
  assert.ok(!where.OR[0].status.in.includes("DELIVERED"));
});

test("tracking checks only request specified IDs within the customer's bookings", () => {
  assert.deepEqual(bookingStatusWhere("customer-a", ["booking-1"], true), {
    customerId: "customer-a", id: { in: ["booking-1"] },
  });
  assert.deepEqual(bookingStatusWhere("customer-a", [], true).id.in, []);
});

test("completed and cancelled bookings leave frequent polling", () => {
  assert.equal(isActiveBooking("ACCEPTED"), true);
  assert.equal(isActiveBooking("IN_TRANSIT"), true);
  assert.equal(isActiveBooking("DELIVERED"), false);
  assert.equal(isActiveBooking("CANCELLED"), false);
});
