import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { customerResponse } from "../src/lib/customer-request.ts";

const ts = createRequire(import.meta.url)("typescript");
const source = fs.readFileSync(new URL("../src/components/fetchit/customer/customer-dashboard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleConfirmBooking") handler = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert(handler, "The actual booking confirmation handler must exist");
const compiled = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(fetch, pending = null) {
  const context = {
    crypto, Error, navigator: { onLine: true }, offlineAccess: false,
    pendingSubmission: pending, submissionRunning: { current: false },
    bookingType: "DELIVERY", isRide: false, passengers: "1", pickupLat: "14.6", pickupLng: "120.98", pickupLabel: "Pickup",
    dropoffLat: "14.62", dropoffLng: "121.01", dropoffLabel: "Destination", vehicleClass: "MOTORCYCLE",
    cargoWeightKg: "2", cargoNotes: "", scheduledAt: "", estimate: {}, estimatedKey: "current", fareKey: "current", canEstimate: () => true,
    emptyDraft: { empty: true }, fetch, customerResponse, created: [], error: null, cleared: false,
  };
  context.setError = value => { context.error = value; };
  context.setSubmitting = value => { context.submitting = value; };
  context.setPendingSubmission = value => { context.pendingSubmission = value; };
  context.setDraft = value => { context.cleared = value === context.emptyDraft; };
  context.onCreate = booking => context.created.push(booking);
  vm.runInNewContext(compiled, context);
  return context;
}
const success = () => Response.json({ booking: { id: "confirmed" } });

test("lost booking responses keep the draft/key; an explicit retry after reopening reuses that key", async () => {
  const requests = [];
  const first = fixture(async (url, options) => { requests.push(options); throw new Error("Failed to fetch"); });
  await first.handleConfirmBooking();
  assert.equal(requests.length, 1, "No automatic booking submission");
  assert.equal(first.cleared, false);
  assert.equal(first.created.length, 0);
  assert.match(first.error, /Check Active bookings/);
  const reopened = fixture(async (url, options) => { requests.push(options); return success(); }, JSON.parse(JSON.stringify(first.pendingSubmission)));
  await reopened.handleConfirmBooking();
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(reopened.pendingSubmission, null);
  assert.equal(reopened.cleared, true);
  assert.equal(reopened.created.length, 1);
});

test("changed booking details get a different request key", async () => {
  const keys = [];
  const app = fixture(async (url, options) => { keys.push(options.headers["Idempotency-Key"]); throw new Error("Failed to fetch"); });
  await app.handleConfirmBooking();
  app.cargoWeightKg = "3";
  await app.handleConfirmBooking();
  assert.notEqual(keys[0], keys[1]);
});

test("rapid double confirmation sends only one request", async () => {
  let release;
  let calls = 0;
  const app = fixture(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = app.handleConfirmBooking();
  await app.handleConfirmBooking();
  assert.equal(calls, 1);
  release(success());
  await first;
  assert.equal(app.created.length, 1);
  assert.equal(app.submissionRunning.current, false);
});

test("offline confirmation does not submit or clear the draft", async () => {
  const app = fixture(() => { throw new Error("Must not send"); });
  app.navigator.onLine = false;
  await app.handleConfirmBooking();
  assert.equal(app.pendingSubmission, null);
  assert.equal(app.cleared, false);
  assert.match(app.error, /Reconnect/);
});
