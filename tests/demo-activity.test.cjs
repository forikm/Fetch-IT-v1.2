const test = require('node:test');
const assert = require('node:assert/strict');
const { selectCustomers, buildPlan, BATCH } = require('../scripts/demo-activity-plan.cjs');
const manifest = { synthetic: true, users: Array.from({ length: 900 }, (_, i) => ({ id: 'fixture-customer-' + i, role: 'CUSTOMER', createdAt: new Date('2026-10-07T09:00:00Z') })) };
const now = new Date('2026-10-24T11:00:00Z');
const quote = () => ({ distanceKm: 7.2, etaMinutes: 28, surgeMultiplier: 1, fare: { baseFare: 60, totalFare: 115 } });
const plan = () => buildPlan(selectCustomers(manifest), { now, quoteFare: quote, quoteRideFare: quote });
test('selection uses exactly 50 distinct records from the synthetic manifest', () => {
  const selected = selectCustomers(manifest); assert.equal(selected.length, 50); assert.equal(new Set(selected.map(u => u.id)).size, 50);
  assert.throws(() => selectCustomers({ ...manifest, synthetic: false }));
  assert.throws(() => selectCustomers({ synthetic: true, users: manifest.users.slice(0, 49) }));
});
test('historical demo activity varies by customer, service, vehicle and day without live jobs or collections', () => {
  const p = plan(); assert.equal(p.bookings.length, 200); assert.equal(new Set(p.bookings.map(b => b.customerId)).size, 50);
  assert.deepEqual(new Set(p.bookings.map(b => b.type)), new Set(['RIDE', 'DELIVERY']));
  assert.deepEqual(new Set(p.bookings.map(b => b.vehicleClass)), new Set(['MOTORCYCLE', 'TRICYCLE', 'SEDAN']));
  assert.deepEqual(new Set(p.bookings.map(b => b.status)), new Set(['DELIVERED', 'CANCELLED']));
  assert(new Set(p.bookings.map(b => b.createdAt.toISOString().slice(0, 10))).size > 10);
  assert(p.bookings.some(b => new Date(b.createdAt.getTime() + 8 * 3600000).toISOString().slice(0, 10) === '2026-10-24'));
  for (const b of p.bookings) {
    assert(b.refCode.startsWith('DEMO-')); assert(b.cargoNotes.includes('DEMO DATA')); assert(b.riderId.startsWith(BATCH));
    assert(b.createdAt >= manifest.users[0].createdAt); assert((b.deliveredAt || b.cancelledAt) <= now);
    assert.equal(b.paymentStatus, 'UNPAID'); assert.equal(b.paidAt, undefined); assert.equal(b.demoPayoutAt, undefined);
    const events = p.events.filter(e => e.bookingId === b.id); assert.equal(events.at(-1).toStatus, b.status);
    for (let i = 1; i < events.length; i++) assert(events[i].createdAt >= events[i - 1].createdAt);
  }
});
test('five distinct demo application stages do not create real identity or operational approvals', () => {
  const p = plan(); assert.equal(p.applications.length, 5); assert.equal(new Set(p.applications.map(a => a.status)).size, 5);
  assert.equal(p.users.length, 8); assert(p.users.every(u => u.email.endsWith('.invalid') && u.name.startsWith('Demo ·')));
  assert.equal(p.applications.filter(a => a.orientationAt).length, 1);
  assert(p.applications.every(a => !a.emailVerifiedAt && a.fields.licenceNumber.startsWith('DEMO-') && a.fields.demoNotice.includes('Do not activate')));
  assert.equal(p.approvals, undefined); assert.equal(p.emails, undefined); assert.equal(p.authIdentities, undefined);
});
test('stable inputs produce stable IDs and histories for safe rerun detection', () => { assert.deepEqual(plan(), plan()); });
