import assert from "node:assert/strict";
import test from "node:test";
import { amountInCents, confirmationsMatch } from "../src/lib/payment-policy.ts";
test("cash amounts use exact cents and accept the schema's currency range", () => {
  assert.equal(amountInCents("0.01"), 1);
  assert.equal(amountInCents("100.10"), 10010);
  assert.equal(amountInCents(100.1), 10010);
  assert.equal(amountInCents("9999999999.99"), 999999999999);
});
test("malformed, negative, zero, fractional-cent and oversized amounts are rejected", () => {
  for (const amount of [null, undefined, {}, [], true, "", " 100", "1e2", "-1", 0, "0.00", NaN, Infinity, "100.001", 10000000000]) assert.equal(amountInCents(amount), null, String(amount));
});
test("Paid requires both confirmations to match the full fare", () => {
  assert(confirmationsMatch("100.10", 100.1, "100.10"));
  for (const [customer, rider, fare] of [[null, 100, 100], [100, null, 100], [90, 100, 100], [90, 90, 100], [100, 100, null]]) assert.equal(confirmationsMatch(customer, rider, fare), false);
});
