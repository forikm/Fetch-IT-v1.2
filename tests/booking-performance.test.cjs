/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Date, console, setTimeout, Buffer, require(name) {
    if (name.endsWith('booking-telemetry')) return { timeBooking: (_, work) => work(), withBookingTelemetry: (_, work) => work };
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
class CustomerError extends Error { constructor(message, status) { super(message); this.status = status; } }
const payload = { type: 'DELIVERY', pickup: { lat: 16.02, lng: 120.23, label: 'Pickup' },
  dropoff: { lat: 16.04, lng: 120.33, label: 'Drop-off' }, vehicleClass: 'MOTORCYCLE', cargoWeightKg: 2 };
const settings = { automatchingEnabled: true, commissionPercent: 15, deliveryEnabled: true, rideEnabled: true, vehicles: ['MOTORCYCLE'] };

function routeFixture(session = { uid: 'customer', role: 'CUSTOMER', name: 'Customer' }) {
  const calls = [];
  let releaseSettings;
  const config = new Promise(resolve => { releaseSettings = () => resolve({ settings }); });
  const route = load('src/app/api/bookings/route.ts', {
    'next/server': { NextResponse: Response }, '@/lib/matching-policy': {}, '@/lib/db-data': { bookingView: b => b },
    '@/lib/customer-access': { CustomerError, customerErrorResponse: e => Response.json({ error: e.message }, { status: e.status }) },
    '@/lib/request-guard': { withRequestLog: (_, handler) => handler, limitRequests: async () => {}, safeErrorCode: () => 'TEST', RateLimitError: class extends Error {} },
    '@/lib/dispatch': {}, '@/lib/db': { db: { user: { findUnique: () => { throw Error('Account already checked by getSession'); } } } },
    '@/lib/session': { getSession: async () => session },
    '@/lib/constants': { isBookingVehicle: () => true, VEHICLES: { MOTORCYCLE: { capacityKg: 20 } }, PASSENGER_CAPACITY: { MOTORCYCLE: 1 } },
    '@/lib/road-quote': { confirmedRoadQuote: async () => ({ distanceKm: 10, surgeMultiplier: 1, fare: { baseFare: 50, totalFare: 100, currency: 'PHP' }, etaMinutes: 20 }) },
    '@/lib/road-routing': { RoutingError: class extends Error {} }, '@/lib/ticket': { omitTicket: b => b },
    '@/lib/booking-create': {
      bookingAttemptId: () => 'attempt', findBookingAttempt: async () => { calls.push('retry lookup'); return null; },
      createBookingWithRetry: async (_db, _type, data, _body, config) => { assert.equal(config, settings); calls.push('create'); return { ...data, id: 'attempt' }; },
    },
    '@/lib/payment-policy': { PAYMENT_METHOD_LABEL: { CASH: 'Cash' }, isDemoPayment: () => false },
    '@/lib/online-checkout': {}, '@/lib/pickup-schedule': { parsePickupSchedule: () => null },
    '@/lib/platform-settings': { platformSettings: () => { calls.push('settings'); return config; } },
    '@/lib/service-area': { bookingServiceAreaError: () => null }, '@/lib/push-delivery': { schedulePushDelivery: () => {} },
  });
  return { calls, releaseSettings, submit: () => route.POST(new Request('https://fixture.invalid/api/bookings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload),
  })) };
}

test('settings and retry lookup overlap; confirmation does not reload the authenticated account', async () => {
  const f = routeFixture();
  const response = f.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ['settings', 'retry lookup']);
  f.releaseSettings();
  assert.equal((await response).status, 200);
  assert.deepEqual(f.calls, ['settings', 'retry lookup', 'create']);
});

test('unauthenticated and non-customer sessions cannot start booking work', async () => {
  for (const [session, status] of [[null, 401], [{ uid: 'rider', role: 'RIDER' }, 403]]) {
    const f = routeFixture(session);
    assert.equal((await f.submit()).status, status);
    assert.deepEqual(f.calls, []);
  }
});

function createFixture({ loseResponse = false, failOutbox = false } = {}) {
  let committed = null, staged = null;
  const calls = [];
  const tx = {
    booking: { create: async ({ data }) => {
      calls.push('booking');
      staged = { ...data, id: data.id, scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        passengers: 1, cargoNotes: null };
      return staged;
    } },
    platformConfig: { findUnique: () => { throw Error('Settings must not be reloaded under the ticket lock'); } },
  };
  const db = {
    $transaction: async fn => {
      try { const result = await fn(tx); committed = staged; calls.push('commit'); return result; }
      catch (error) { staged = null; calls.push('rollback'); throw error; }
    },
    booking: {
      findUnique: async () => committed,
      findUniqueOrThrow: async () => { calls.push('detail read'); if (loseResponse) throw Error('Lost response'); return committed; },
    },
  };
  const helper = load('src/lib/booking-create.ts', {
    './matching-policy': { dispatchSelect: {} }, './rider-push-tasks': { queueRiderPushTask: async () => { calls.push('outbox'); if (failOutbox) throw Error('Outbox unavailable'); } },
    'node:crypto': crypto, './ticket': { generateTicketId: async () => { calls.push('ticket'); return 'D0001'; } },
    './fare': { generateRefCode: () => 'FIT-TEST' }, './db-data': { riderSelect: {} },
    './customer-access': { CustomerError }, './pickup-schedule': { parsePickupSchedule: value => value ? new Date(value) : null },
  });
  async function create(enabled, scheduledAt = null, type = 'DELIVERY') {
    const body = { ...payload, type, scheduledAt };
    const data = { id: 'attempt', type, customerId: 'customer', paymentMethod: 'CASH', vehicleClass: payload.vehicleClass,
      pickupLabel: 'Pickup', pickupLat: 16.02, pickupLng: 120.23, dropoffLabel: 'Drop-off', dropoffLat: 16.04, dropoffLng: 120.33,
      cargoWeightKg: type === 'RIDE' ? 0 : 2, scheduledAt, status: 'PENDING' };
    return helper.createBookingWithRetry(db, type, data, body, { automatchingEnabled: enabled });
  }
  return { create, calls, committed: () => committed };
}

test('ride and delivery dispatch is durable with the booking and respects matching availability', async () => {
  for (const type of ['RIDE', 'DELIVERY']) for (const enabled of [true, false]) {
    const f = createFixture();
    const before = Date.now();
    const booking = await f.create(enabled, null, type);
    assert.equal(booking.dispatch.create.phase, enabled ? 'SEARCHING' : 'OPEN');
    assert(booking.dispatch.create.nextAt.getTime() >= before);
    assert.deepEqual(f.calls, ['ticket', 'booking', 'outbox', 'commit', 'detail read']);
  }
});

test('future pickups keep matching scheduled for their pickup time', async () => {
  const f = createFixture();
  const scheduledAt = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await f.create(true, scheduledAt)).dispatch.create.nextAt.toISOString(), scheduledAt);
});

test('a lost detail response recovers the committed booking without another write', async () => {
  const f = createFixture({ loseResponse: true });
  const booking = await f.create(true);
  assert.equal(booking.id, 'attempt');
  assert.equal(f.calls.filter(call => call === 'booking').length, 1);
});

test('outbox failure rolls the booking and dispatch back together', async () => {
  const f = createFixture({ failOutbox: true });
  await assert.rejects(f.create(true), /Outbox unavailable/);
  assert.equal(f.committed(), null);
  assert(!f.calls.includes('commit'));
});
