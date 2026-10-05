import { test } from "node:test";
import assert from "node:assert/strict";
import { supportInput } from "../src/lib/support-input.ts";

test("account questions work without a booking and values are trimmed", () => {
  assert.deepEqual(supportInput({ category: "OTHER", message: "  Help with my account  " }), { category: "OTHER", bookingId: null, message: "Help with my account" });
  assert.equal(supportInput({ bookingId: " booking-1 ", category: "FARE", message: "Please check my fare" }).bookingId, "booking-1");
});
test("booking categories cannot be used without a booking", () => {
  for (const category of ["BOOKING", "FARE", "RIDER", "LOST_ITEM"]) assert.throws(() => supportInput({ category, message: "Please help with this" }), /Choose a booking/);
});
test("invalid categories, blank identifiers, whitespace and oversized text are rejected", () => {
  for (const body of [null, { category: "INVALID", message: "A support question" }, { category: "OTHER", bookingId: "", message: "A support question" },
    { category: "OTHER", message: "          " }, { category: "OTHER", message: "a".repeat(2001) }]) assert.throws(() => supportInput(body));
});
test("follow-ups accept a short reply and ignore forged category or booking fields", () => {
  assert.deepEqual(supportInput({ message: " Yes ", category: "RIDER", bookingId: "someone-elses-booking", authorRole: "ADMIN" }, true), { message: "Yes", bookingId: null, category: "OTHER" });
  assert.throws(() => supportInput({ message: " " }, true));
  assert.throws(() => supportInput({ message: "a".repeat(2001) }, true));
});
