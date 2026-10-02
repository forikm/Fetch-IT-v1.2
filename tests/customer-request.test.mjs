import { test } from "node:test";
import assert from "node:assert/strict";
import { customerResponse } from "../src/lib/customer-request.ts";

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
