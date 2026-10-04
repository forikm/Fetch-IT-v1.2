import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhilippinePhone } from "../src/lib/phone.ts";

test("Philippine local and formatted numbers are stored with +63", () => {
  assert.equal(normalizePhilippinePhone("09171234567"), "+639171234567");
  assert.equal(normalizePhilippinePhone("+63 917 123 4567"), "+639171234567");
  assert.equal(normalizePhilippinePhone("(02) 8123-4567"), "+63281234567");
});

test("phone is required and incomplete or foreign numbers are rejected", () => {
  for (const value of [undefined, null, "", "  ", 9171234567, "+1 202 555 0123", "+61 412 345 678", "+63 917 123", "091712345678", "+63 117 123 4567"]) {
    assert.throws(() => normalizePhilippinePhone(value));
  }
});

test("phone validation does not extract a number from unrelated text or accept an extension", () => {
  for (const value of ["Call me at 09171234567", "09171234567 ext 1", "09171234567x1", "+639171234567<script>"]) {
    assert.throws(() => normalizePhilippinePhone(value));
  }
});
