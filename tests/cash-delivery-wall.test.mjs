import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../src/lib/payment-policy.ts";

const source = fs.readFileSync(new URL("../src/lib/payments.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(overrides = {}) {
  let booking = { id: "delivery", refCode: "FIT-TEST", type: "DELIVERY", status: "IN_TRANSIT", riderId: "rider", customerId: "customer", paymentMethod: "CASH", paymentStatus: "UNPAID", totalFare: 100, customerPaidAt: null, customerPaidAmount: null, riderReceivedAt: null, riderReceivedAmount: null, ...overrides };
  const events = [], exports = {}, updates = [];
  const tx = { $queryRaw: async () => [], booking: { findUnique: async () => booking, update: async ({ data }) => { updates.push(data); booking = { ...booking, ...data }; return booking; } }, paymentEvent: { findFirst: async ({ where }) => events.find(e => e.action === where.action), create: async ({ data }) => { const event = { ...data, createdAt: new Date() }; events.push(event); return event; } } };
  vm.runInNewContext(code, { exports, Date, require(name) { if (name === "./payment-policy") return policy; if (name === "./receipt-email") return { scheduleReceiptDelivery() {} }; throw Error(name); } });
  return { ...exports, db: { $transaction: async fn => fn(tx) }, events, updates, record: () => booking };
}
const rider = { uid: "rider", name: "Rider", role: "RIDER" }, customer = { uid: "customer", name: "Customer", role: "CUSTOMER" };

test("cash delivery confirmation stage is drop-off, and ride policy remains separate", () => {
  for (const status of ["PENDING", "MATCHED", "ACCEPTED", "PICKED_UP"]) assert.equal(policy.cashConfirmationAvailable("DELIVERY", status, new Date()), false);
  assert.equal(policy.cashConfirmationAvailable("DELIVERY", "IN_TRANSIT", null), false);
  assert.equal(policy.cashConfirmationAvailable("DELIVERY", "IN_TRANSIT", new Date()), true);
  assert.equal(policy.cashConfirmationAvailable("DELIVERY", "DELIVERED"), true, "Existing unpaid history can still be settled");
  assert.equal(policy.cashConfirmationAvailable("RIDE", "ACCEPTED"), true);
  assert.equal(policy.cashConfirmationAvailable("DELIVERY", "CANCELLED", new Date()), false);
});
test("both participants are blocked until assigned rider confirms arrival", async () => {
  for (const actor of [customer, rider]) {
    const f = fixture();
    await assert.rejects(f.confirmCashPayment(f.db, "delivery", actor, 100), /after the rider confirms arrival/);
    assert.equal(f.updates.length, 0);
  }
});
test("arrival is assigned-rider-only, stage constrained and idempotent", async () => {
  const f = fixture();
  for (const actor of [customer, { ...rider, uid: "other" }]) await assert.rejects(f.confirmDropoffArrival(f.db, "delivery", actor), /assigned rider/);
  await f.confirmDropoffArrival(f.db, "delivery", rider);
  await f.confirmDropoffArrival(f.db, "delivery", rider);
  assert.equal(f.events.length, 1);
  assert.equal(f.record().paymentStatus, "UNPAID", "Arrival does not pretend payment was received");
  const early = fixture({ status: "ACCEPTED" });
  await assert.rejects(early.confirmDropoffArrival(early.db, "delivery", rider), /reaches drop-off/);
});
test("completion waits for both full-fare confirmations, regardless of confirmation order", async () => {
  for (const first of [rider, customer]) {
    const f = fixture();
    await f.confirmDropoffArrival(f.db, "delivery", rider);
    assert(policy.deliveryCashCompletionError(f.record()));
    await f.confirmCashPayment(f.db, "delivery", first, 100);
    assert(policy.deliveryCashCompletionError(f.record()));
    await f.confirmCashPayment(f.db, "delivery", first.role === "RIDER" ? customer : rider, 100);
    assert.equal(f.record().paymentStatus, "PAID");
    assert.equal(policy.deliveryCashCompletionError(f.record()), null);
    await f.confirmCashPayment(f.db, "delivery", first, 100);
    assert.equal(f.events.filter(e => e.action.endsWith("CONFIRMED")).length, 2);
  }
});
test("mismatches and missing confirmations cannot complete delivery, prepaid jobs do not need cash", async () => {
  const f = fixture(); await f.confirmDropoffArrival(f.db, "delivery", rider);
  await f.confirmCashPayment(f.db, "delivery", customer, 90);
  await f.confirmCashPayment(f.db, "delivery", rider, 100);
  assert.match(policy.deliveryCashCompletionError(f.record()), /match the fare/);
  assert.equal(policy.deliveryCashCompletionError({ ...f.record(), paymentMethod: "DEMO_GCASH" }), null);
  assert.equal(policy.deliveryCashCompletionError({ ...f.record(), type: "RIDE" }), null);
});
test("staff-set Paid can still receive participant acknowledgments without changing the final amount", async () => {
  const f = fixture({ paymentStatus: "PAID" }); await f.confirmDropoffArrival(f.db, "delivery", rider);
  await assert.rejects(f.confirmCashPayment(f.db, "delivery", rider, 90), /recorded fare/);
  await f.confirmCashPayment(f.db, "delivery", rider, 100);
  assert.equal(f.record().paymentStatus, "PAID");
  await f.confirmCashPayment(f.db, "delivery", customer, 100);
  assert.equal(policy.deliveryCashCompletionError(f.record()), null);
});
