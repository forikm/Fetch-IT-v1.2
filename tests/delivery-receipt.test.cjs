/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

class CustomerError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function load(file, deps = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", source)(exports, name => deps[name] ?? require(name));
  return exports;
}

const customer = { uid: "customer-1", name: "Customer" };
const bookingId = "booking-1";

function fixture({ status = "DELIVERED", type = "DELIVERY" } = {}) {
  const support = load("src/lib/support-input.ts");
  const events = [];
  const tickets = [];
  let confirmedAt = null;
  const tx = {
    $queryRaw: async () => [],
    booking: {
      findFirst: async ({ where }) => where.id === bookingId && where.customerId === customer.uid && where.type === type
        ? { status, riderId: "rider-1", customerDropoffConfirmedAt: confirmedAt, supportTickets: tickets }
        : null,
      update: async ({ data }) => {
        assert.deepEqual(Object.keys(data), ["customerDropoffConfirmedAt"]);
        confirmedAt = data.customerDropoffConfirmedAt;
      },
    },
    supportTicket: { create: async ({ data }) => { tickets.push(data); return { id: data.id }; } },
  };
  const db = { booking: tx.booking, $transaction: async work => work(tx) };
  const receipt = load("src/lib/delivery-receipt.ts", {
    "./customer-access": { CustomerError },
    "./booking-events": { recordBookingEvent: async (_tx, id, actor, change) => events.push({ id, actor, ...change }) },
    "./support-input": support,
  });
  return { events, tickets, receipt, support, db,
    read: () => receipt.readDeliveryReceipt(db, bookingId, customer.uid),
    respond: (input, actor = customer) => receipt.respondToDelivery(db, bookingId, actor, input),
  };
}

test("confirming parcel receipt persists one acknowledgement and keeps the delivered status", async () => {
  const app = fixture();
  assert.deepEqual(await app.read(), { confirmedAt: null, ticketId: null });
  const saved = await app.respond({ action: "CONFIRM" });
  assert(saved.confirmedAt instanceof Date);
  assert.deepEqual(await app.read(), saved);
  assert.deepEqual(await app.respond({ action: "CONFIRM" }), saved);
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].fromStatus, "DELIVERED");
  assert.equal(app.events[0].toStatus, "DELIVERED");
  assert.equal(app.tickets.length, 0);
});

test("a parcel problem creates one support request linked to the booking, including on retry", async () => {
  const app = fixture();
  const saved = await app.respond({ action: "REPORT", message: "The parcel was left at another building." });
  assert(saved.ticketId);
  assert.deepEqual(await app.read(), saved);
  assert.deepEqual(await app.respond({ action: "REPORT", message: "The parcel was left at another building." }), saved);
  assert.equal(app.tickets.length, 1);
  assert.equal(app.tickets[0].bookingId, bookingId);
  assert.equal(app.tickets[0].customerId, customer.uid);
  assert.equal(app.support.supportSubject(app.tickets[0]), app.support.DELIVERY_RECEIPT_ISSUE);
  assert.equal(app.events.length, 0);
  await assert.rejects(app.respond({ action: "CONFIRM" }), { status: 409 });
});

test("receipt actions are restricted to the booking owner and a completed parcel delivery", async () => {
  await assert.rejects(fixture().respond({ action: "CONFIRM" }, { uid: "another-customer" }), { status: 404 });
  await assert.rejects(fixture({ type: "RIDE" }).respond({ action: "CONFIRM" }), { status: 404 });
  await assert.rejects(fixture({ status: "IN_TRANSIT" }).respond({ action: "CONFIRM" }), { status: 409 });
  await assert.rejects(fixture().respond({ action: "REPORT", message: "too short" }), { status: 400 });
});
