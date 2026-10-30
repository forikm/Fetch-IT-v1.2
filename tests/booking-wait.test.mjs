import { test } from "node:test";
import assert from "node:assert/strict";
import fs from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(new URL('../src/lib/' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const expiry = {}; new Function('exports', compile('job-expiry.ts'))(expiry);
const logic = {}; new Function('exports', 'require', compile('booking-wait.ts'))(logic, () => expiry);
const { bookingWaitFeedback, mergeBookingUpdate, LONG_BOOKING_WAIT_MS } = logic;
const now = Date.parse("2026-10-30T10:00:00Z");
const booking = { id: "booking", type: "RIDE", status: "PENDING", createdAt: new Date(now - 30_000).toISOString() };

test("unaccepted requests distinguish a recent wait from a long wait without inventing availability", () => {
  assert.equal(bookingWaitFeedback(booking, now).kind, "waiting");
  const long = bookingWaitFeedback({ ...booking, createdAt: new Date(now - LONG_BOOKING_WAIT_MS).toISOString() }, now);
  assert.equal(long.title, "No driver has accepted yet");
  assert.equal(long.wait, "Waiting 3 minutes");
  assert.doesNotMatch(long.message, /no drivers available|cancelled|expired/i);
  assert.equal(bookingWaitFeedback({ ...booking, type: "DELIVERY", createdAt: new Date(now - 240_000).toISOString() }, now).title, "No rider has accepted yet");
});

test("an offer awaits acceptance and never claims that the driver is heading to pickup", () => {
  const offered = bookingWaitFeedback({ ...booking, status: "MATCHED" }, now);
  assert.equal(offered.kind, "offered");
  assert.match(offered.message, /not accepted yet/);
  assert.doesNotMatch(offered.message, /on the way|heading to pickup/);
});

test("scheduled requests begin their wait when pickup becomes due", () => {
  const scheduled = { ...booking, createdAt: new Date(now - 86400000).toISOString(), scheduledAt: new Date(now + 60000).toISOString() };
  assert.equal(bookingWaitFeedback(scheduled, now).kind, "scheduled");
  assert.equal(bookingWaitFeedback(scheduled, now).wait, null);
  assert.equal(bookingWaitFeedback(scheduled, now + 90000).wait, "Waiting less than a minute");
  assert.equal(bookingWaitFeedback(scheduled, now + 240000).kind, "long");
});

test("future or invalid creation timestamps cannot produce a negative wait or a false long-wait warning", () => {
  for (const createdAt of ["invalid", new Date(now + 60000).toISOString()]) {
    assert.equal(bookingWaitFeedback({ ...booking, createdAt }, now).wait, "Waiting less than a minute");
  }
  for (const status of ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"]) {
    assert.equal(bookingWaitFeedback({ ...booking, status }, now), null);
  }
});

test("a delayed check cannot undo a newer acceptance or cancellation", () => {
  for (const status of ["ACCEPTED", "CANCELLED"]) {
    const current = { status, updatedAt: new Date(now).toISOString() };
    assert.equal(mergeBookingUpdate(current, { status: "PENDING", updatedAt: new Date(now - 1000).toISOString() }), current);
    assert.equal(mergeBookingUpdate(current, { status: "IN_TRANSIT", updatedAt: new Date(now + 1000).toISOString() }).status, "IN_TRANSIT");
  }
});
