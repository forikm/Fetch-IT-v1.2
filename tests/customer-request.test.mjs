import { test } from "node:test";
import assert from "node:assert/strict";
import { customerResponse, CustomerRequestError } from "../src/lib/customer-request.ts";

test("successful booking data is returned", async () => {
  assert.deepEqual(await customerResponse(Response.json({ bookings: [] }), "Retry"), { bookings: [] });
});
test("HTML server errors become a readable retry message", async () => {
  await assert.rejects(customerResponse(new Response("<html>Server error</html>", { status: 503 }), "Please retry"), /Please retry/);
});
test("expired sessions explain how to recover", async () => {
  await assert.rejects(customerResponse(new Response("", { status: 401 }), "Retry"), /sign in again/);
});
test("validation messages are preserved while internal errors are hidden", async () => {
  await assert.rejects(customerResponse(Response.json({ error: "Choose a valid pickup" }, { status: 400 }), "Retry"), /Choose a valid pickup/);
  await assert.rejects(customerResponse(Response.json({ error: "Private database details" }, { status: 500 }), "Please retry"), /Please retry/);
});
test("malformed success responses do not silently become empty bookings", async () => {
  await assert.rejects(customerResponse(new Response("invalid JSON"), "Please retry"), /Please retry/);
});

test("fare routing failures provide a bounded wait and safe explanation", async () => {
  for (const code of ["ROUTE_BUSY", "ROUTE_COOLDOWN", "ROUTE_PROVIDER", "ROUTE_PROVIDER_LIMIT"]) {
    await assert.rejects(customerResponse(Response.json({ code, error: "Private provider details" }, { status: 503, headers: { "Retry-After": "18" } }), "Retry", true), error => error instanceof CustomerRequestError && error.retryAfterSeconds === 18 && !error.message.includes("Private"));
  }
  await assert.rejects(customerResponse(Response.json({ code: "ROUTE_COOLDOWN", retryAfterSeconds: 900 }, { status: 503 }), "Retry", true), error => error.retryAfterSeconds === 60);
  await assert.rejects(customerResponse(Response.json({ code: "UNKNOWN", error: "Private details" }, { status: 503 }), "Retry", true), /^Error: Retry$/);
});
