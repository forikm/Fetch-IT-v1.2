import { test } from "node:test";
import assert from "node:assert/strict";
import { createBookingNotifications, mergeBookingNotifications } from "../src/lib/booking-notifications.ts";
const booking = { id: "booking-1", refCode: "FIT-001", type: "DELIVERY", status: "DELIVERED", dropoffLabel: "Customer destination", updatedAt: "2026-10-02T10:00:00Z" };
const now = "2026-10-02T11:00:00Z";
test("first load establishes a baseline without flooding the inbox", () => {
  assert.deepEqual(createBookingNotifications([booking], null, now), []);
});
test("status changes include the booking destination and unread state", () => {
  const [item] = createBookingNotifications([booking], { "booking-1": "IN_TRANSIT" }, now);
  assert.equal(item.address, booking.dropoffLabel); assert.equal(item.status, "DELIVERED"); assert.equal(item.read, false);
});
test("repeated polling does not create a new update", () => {
  assert.deepEqual(createBookingNotifications([booking], { "booking-1": "DELIVERED" }, now), []);
});
test("duplicate events preserve read state and inbox size is bounded", () => {
  const [item] = createBookingNotifications([booking], { "booking-1": "PENDING" }, now);
  assert.equal(mergeBookingNotifications([{ ...item, read: true }], [item])[0].read, true);
  assert.equal(mergeBookingNotifications([], Array.from({ length: 110 }, (_, index) => ({ ...item, id: String(index) }))).length, 100);
});
