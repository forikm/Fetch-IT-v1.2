import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { customerResponse } from "../src/lib/customer-request.ts";
import { pickupScheduleIso } from "../src/lib/pickup-schedule.ts";

const ts = createRequire(import.meta.url)("typescript");
const source = fs.readFileSync(new URL("../src/components/fetchit/customer/customer-dashboard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["handleConfirmBooking", "handleCheckBooking", "completeSubmission"].includes(node.name?.text)) handlers.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(handlers.length, 3);
const compiled = ts.transpileModule(handlers.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(fetch, pending = null) {
  const context = {
    startBookingTiming: () => ({ headers: {}, response() {}, finish() {} }),
    crypto, Error, AbortSignal, AbortController, navigator: { onLine: true }, connected: true, offlineAccess: false, coverageError: null,
    pendingSubmission: pending, submissionRunning: { current: false }, attemptRequest: { current: null },
    bookingType: "DELIVERY", isRide: false, passengers: "1", pickupLat: "14.6", pickupLng: "120.98", pickupLabel: "Pickup",
    dropoffLat: "14.62", dropoffLng: "121.01", dropoffLabel: "Destination", vehicleClass: "MOTORCYCLE",
    cargoWeightKg: "2", cargoNotes: "", scheduledAt: "", estimate: {}, estimatedKey: "current", fareKey: "current", canEstimate: () => true,
    paymentMethod: "CASH", pickupScheduleIso,
    emptyDraft: { empty: true }, fetch, customerResponse, created: [], error: null, cleared: false,
  };
  context.setError = value => { context.error = value; };
  context.setSubmitting = value => { context.submitting = value; };
  context.setAttemptCheck = value => { context.attemptCheck = value; };
  context.setPendingSubmission = value => { context.pendingSubmission = value; };
  Object.defineProperty(context, "needsStatusCheck", { get: () => !!context.pendingSubmission && context.attemptCheck?.status !== "missing" });
  context.setDraft = value => { context.cleared = value === context.emptyDraft; };
  context.onCreate = booking => context.created.push(booking);
  vm.runInNewContext(compiled, context);
  return context;
}
const success = () => Response.json({ booking: { id: "confirmed" } });

test("booking confirmation sends Philippine pickup time as an explicit UTC instant", async () => {
  let body;
  const app = fixture(async (url, options) => { body = JSON.parse(options.body); return success(); });
  app.scheduledAt = "2026-10-11T17:09";
  await app.handleConfirmBooking();
  assert.equal(body.scheduledAt, "2026-10-11T09:09:00.000Z");
  assert.equal(app.created.length, 1);
});

test("a lost response preserves the draft and checks the same key without submitting again", async () => {
  const requests = [];
  const first = fixture(async (url, options) => { requests.push(options); throw new Error("Failed to fetch"); });
  await first.handleConfirmBooking();
  assert.equal(requests.length, 1, "No automatic booking submission");
  assert.equal(first.cleared, false);
  assert.equal(first.created.length, 0);
  assert.match(first.error, /Check whether your booking went through/);
  const reopened = fixture(async (url, options) => {
    assert.equal(url, "/api/bookings/status");
    assert.equal(options.method, undefined);
    assert.equal(options.headers["Idempotency-Key"], requests[0].headers["Idempotency-Key"]);
    return success();
  }, JSON.parse(JSON.stringify(first.pendingSubmission)));
  await reopened.handleCheckBooking();
  assert.equal(reopened.pendingSubmission, null);
  assert.equal(reopened.cleared, true);
  assert.equal(reopened.created.length, 1);
});

test("an interrupted request keeps its key when the customer edits the draft and checks before retrying", async () => {
  const requests = [];
  const app = fixture(async (url, options) => {
    if (url === "/api/bookings/status") return Response.json({ pending: true });
    requests.push(options);
    if (requests.length === 1) throw new Error("Failed to fetch");
    return success();
  });
  await app.handleConfirmBooking();
  app.cargoWeightKg = "3";
  await app.handleConfirmBooking();
  assert.equal(requests.length, 1);
  await app.handleCheckBooking();
  assert.equal(app.attemptCheck.status, "missing");
  await app.handleConfirmBooking();
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
  assert.equal(JSON.parse(requests[1].body).cargoWeightKg, 3);
  assert.equal(app.created.length, 1);
});

test("checking can recover a payment link, a still-uncertain request, or an expired checkout", async () => {
  const pending = { key: "booking-request-key", body: "{}" };
  const checkout = fixture(async () => Response.json({ checkoutUrl: "/checkout/simulated_123" }), pending);
  let redirect;
  checkout.window = { location: { assign(url) { redirect = url; } } };
  await checkout.handleCheckBooking();
  assert.equal(redirect, "/checkout/simulated_123");
  assert.equal(checkout.pendingSubmission, pending);
  const failed = fixture(async () => Response.json({}, { status: 503 }), pending);
  await failed.handleCheckBooking();
  assert.equal(failed.attemptCheck.status, "unavailable");
  assert.equal(failed.pendingSubmission, pending);
  assert.equal(failed.cleared, false);
  const expired = fixture(async () => Response.json({ expired: true }), pending);
  await expired.handleCheckBooking();
  assert.equal(expired.pendingSubmission, null);
  assert.equal(expired.cleared, false);
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

test("unavailable locations never submit or discard the saved draft", async () => {
  const app = fixture(() => { throw new Error("Must not send"); });
  app.coverageError = "Area unavailable for pickup. Choose a location within Pangasinan.";
  await app.handleConfirmBooking();
  assert.equal(app.pendingSubmission, null);
  assert.equal(app.cleared, false);
  assert.match(app.error, /Area unavailable/);
});

test("each simulated method opens checkout and retains its draft until payment completes", async () => {
  for (const type of ["RIDE", "DELIVERY"]) {
    for (const method of ["DEMO_GCASH", "DEMO_MAYA", "DEMO_BANK"]) {
      let request, destination;
      const app = fixture(async (_, options) => { request = JSON.parse(options.body); return Response.json({ checkoutUrl: "/checkout/simulated_123" }); });
      app.paymentMethod = method; app.bookingType = type; app.isRide = type === "RIDE";
      app.window = { location: { assign(url) { destination = url; } } };
      await app.handleConfirmBooking();
      assert.equal(request.paymentMethod, method);
      assert.equal(request.type, type);
      assert.equal(destination, "/checkout/simulated_123");
      assert.equal(app.created.length, 0);
      assert.equal(app.cleared, false);
      assert(app.pendingSubmission?.key);
    }
  }
});

test('refreshing a signed route quote keeps the original logical booking retry key',async()=>{
 const calls=[];const first=fixture(async(_,options)=>{calls.push(options);throw Error('Failed to fetch');});first.estimate={routeQuote:'first-quote'};await first.handleConfirmBooking();
 const retry=fixture(async(url,options)=>{if(url.endsWith('/status'))return Response.json({pending:true});calls.push(options);return success();},first.pendingSubmission);retry.estimate={routeQuote:'refreshed-quote'};await retry.handleCheckBooking();await retry.handleConfirmBooking();
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(JSON.parse(calls[1].body).routeQuote,'refreshed-quote');
});
