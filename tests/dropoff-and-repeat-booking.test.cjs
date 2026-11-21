const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (!(name in imports)) throw Error(name);
    return imports[name];
  }, Date });
  return exports;
}

class CustomerError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

test('a drop-off dispute creates one support request and leaves confirmation pending', async () => {
  let booking = { id: 'ride', updatedAt: new Date(), riderDropoffReportedAt: new Date(), rideDropoffIssueReportedAt: null, customerDropoffConfirmedAt: null, status: 'IN_TRANSIT' };
  const tickets = [];
  const tx = {
    $queryRaw: async () => [],
    booking: { findFirst: async () => booking, update: async ({ data }) => (booking = { ...booking, ...data }) },
    supportTicket: { create: async ({ data }) => tickets.push(data) },
  };
  const api = load('src/app/api/bookings/[id]/dropoff-issue/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/db': { db: { $transaction: work => work(tx) } },
    '@/lib/customer-access': { CustomerError, requireCustomer: async () => ({ uid: 'customer' }), customerErrorResponse: error => Response.json({ error: error.message }, { status: error.status ?? 503 }) },
    '@/lib/support-input': load('src/lib/support-input.ts', {}),
    '@/lib/request-guard': { limitRequests: async () => {}, RateLimitError: class extends Error {}, withRequestLog: (_, handler) => handler },
  });
  const submit = message => api.POST({ headers: new Headers(), json: async () => ({ message }) }, { params: Promise.resolve({ id: 'ride' }) });
  assert.equal((await submit('too short')).status, 400);
  assert.equal((await submit('The driver stopped at the wrong location.')).status, 200);
  assert.equal((await submit('The driver stopped at the wrong location.')).status, 200);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].bookingId, 'ride');
  assert.equal(tickets[0].customerId, 'customer');
  assert.equal(booking.status, 'IN_TRANSIT');
  assert.equal(booking.customerDropoffConfirmedAt, null);
});

test('an identical recent booking from a different submission key needs explicit acknowledgement', async () => {
  const { checkRecentBooking } = load('src/lib/recent-booking.ts', { './customer-access': { CustomerError } });
  const data = { customerId: 'customer', id: 'new-attempt', type: 'DELIVERY', paymentMethod: 'CASH',
    vehicleClass: 'MOTORCYCLE', pickupLabel: 'Pickup', pickupLat: 16, pickupLng: 120, dropoffLabel: 'Drop-off', dropoffLat: 16.1, dropoffLng: 120.1, cargoWeightKg: 2 };
  const tx = { booking: { findFirst: async ({ where }) => {
    assert.equal(where.customerId, 'customer');
    assert.equal(where.id.not, 'new-attempt');
    assert.equal(where.cargoWeightKg, 2);
    assert.equal(where.dropoffLat, 16.1);
    return { id: 'first-attempt' };
  } } };
  await assert.rejects(checkRecentBooking(tx, data), { code: 'RECENT_BOOKING' });
  await assert.rejects(checkRecentBooking(tx, data, 'wrong-attempt'), { code: 'RECENT_BOOKING' });
  await checkRecentBooking(tx, data, 'first-attempt');
});
