// Two independent HTTP sessions against explicitly isolated localhost servers.
// Never runs against the public schema, live domains, or real email recipients.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { parseEnv } = require('node:util'), { PrismaClient } = require('@prisma/client');
const stateFile = process.argv[2], envFile = process.argv[3];
if (!stateFile || !envFile) throw Error('Pass the isolated lab state and environment file paths.');
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')), env = parseEnv(fs.readFileSync(envFile, 'utf8'));
if (!/^fetch_rider_lab_[a-f0-9]{32}$/.test(state.schema)) throw Error('Expected isolated test schema');
for (const base of [state.customerUrl, state.riderUrl]) if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Localhost sessions required');
const url = new URL(env.DATABASE_URL); url.searchParams.set('schema', state.schema); url.searchParams.set('options', `-c search_path=${state.schema},pg_catalog`);
const db = new PrismaClient({ datasourceUrl: url.toString() });
function actor(base) {
 let cookie = '';
 return async (route, body, method = body ? 'POST' : 'GET', extra = {}) => {
  const start = Date.now(), response = await fetch(base + route, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000) });
  const set = response.headers.getSetCookie(); if (set.length) cookie = set.map(value => value.split(';')[0]).join('; ');
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { throw Error(`${route}: non-JSON response (${response.status})`); }
  return { status: response.status, data, ms: Date.now() - start };
 };
}
const customer = actor(state.customerUrl), rider = actor(state.riderUrl), guest = actor(state.riderUrl), passes = [], ids = [];
const pass = title => { passes.push(title); console.log('PASS ' + title); };
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data; };
const patch = (id, status, otp) => rider(`/api/bookings/${id}`, { status, ...(otp ? { otp } : {}) }, 'PATCH');
async function create(type = 'DELIVERY', extra = {}) {
 const body = { type, vehicleClass: 'MOTORCYCLE', paymentMethod: 'CASH', cargoWeightKg: 2, passengers: 1,
  pickup: { label: 'Lingayen Public Market, Lingayen, Pangasinan', lat: 16.0206, lng: 120.2321 },
  dropoff: { label: 'Dagupan City Plaza, Dagupan, Pangasinan', lat: 16.0434, lng: 120.334 }, ...extra };
 const key = crypto.randomUUID(), booking = ok(await customer('/api/bookings', body, 'POST', { 'Idempotency-Key': key })).booking;
 assert(booking?.id); ids.push(booking.id); return { booking, body, key };
}
async function main() {
 assert.equal((await db.$queryRaw`SELECT current_schema() AS name`)[0].name, state.schema);
 assert(state.customer.email.endsWith('.invalid') && state.rider.email.endsWith('.invalid'));
 ok(await customer('/api/auth/login', { email: state.customer.email, password: state.password, role: 'CUSTOMER' }));
 ok(await rider('/api/auth/login', { email: state.rider.email, password: state.password, role: 'RIDER' }));
 assert.equal((await guest('/api/rider/updates')).status, 401); pass('separate customer/rider sessions and notification authentication');
 ok(await rider('/api/rider/status', { online: true }));
 const baseline = ok(await rider('/api/rider/updates')); assert(Array.isArray(baseline.available));
 const { booking: delivery, body, key } = await create();
 const retried = ok(await customer('/api/bookings', body, 'POST', { 'Idempotency-Key': key })).booking; assert.equal(retried.id, delivery.id); pass('booking retry reuses one request');
 const available = ok(await rider('/api/rider/updates')).available.find(item => item.id === delivery.id);
 assert(available); for (const field of ['customer', 'customerId', 'pickupLat', 'pickupLabel']) assert.equal(available[field], undefined); pass('new eligible jobs reach the rider across tabs without exposing customer data');
 const claims = await Promise.all([patch(delivery.id, 'ACCEPTED'), patch(delivery.id, 'ACCEPTED')]); claims.forEach(ok);
 assert.equal(await db.bookingEvent.count({ where: { bookingId: delivery.id, toStatus: 'ACCEPTED' } }), 1);
 const observed = ok(await customer('/api/bookings/status?onlyTracked=1&ids=' + delivery.id)); assert.equal(observed.bookings[0].status, 'ACCEPTED'); pass('duplicate acceptance produces one event and customer sees accepted status');
 assert.equal((await rider(`/api/bookings/${delivery.id}/payment`, { amount: delivery.totalFare })).status, 409); pass('cash confirmation stays hidden/blocked before drop-off');
 const pickups = await Promise.all([patch(delivery.id, 'PICKED_UP'), patch(delivery.id, 'PICKED_UP')]); pickups.forEach(ok);
 assert.equal(await db.bookingEvent.count({ where: { bookingId: delivery.id, toStatus: 'PICKED_UP' } }), 1);
 ok(await patch(delivery.id, 'IN_TRANSIT'));
 assert.equal((await patch(delivery.id, 'DELIVERED')).status, 409);
 ok(await rider(`/api/bookings/${delivery.id}/payment`, { action: 'ARRIVED_AT_DROPOFF' }));
 assert.equal((await patch(delivery.id, 'DELIVERED')).status, 409);
 const paid = await Promise.all([rider(`/api/bookings/${delivery.id}/payment`, { amount: delivery.totalFare }), rider(`/api/bookings/${delivery.id}/payment`, { amount: delivery.totalFare })]); paid.forEach(ok);
 assert.equal(await db.paymentEvent.count({ where: { bookingId: delivery.id, action: 'RIDER_CONFIRMED' } }), 1);
 assert.equal((await patch(delivery.id, 'DELIVERED')).status, 409);
 ok(await customer(`/api/bookings/${delivery.id}/payment`, { amount: delivery.totalFare }));
 assert.equal(ok(await rider(`/api/bookings/${delivery.id}/payment`)).booking.paymentStatus, 'PAID');
 assert.equal(ok(await customer(`/api/bookings/${delivery.id}/payment`)).booking.paymentStatus, 'PAID'); pass('arrival and both cash acknowledgements synchronize without duplicate payment events');
 ok(await rider(`/api/bookings/${delivery.id}/proof`, { signatureSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M5 25L25 5L45 30L80 10" fill="none" stroke="black"/></svg>', recipientName: 'Synthetic Lab Recipient' }));
 assert.equal(ok(await customer('/api/bookings/status?onlyTracked=1&ids=' + delivery.id)).bookings[0].status, 'DELIVERED');
 assert(ok(await rider('/api/bookings?filter=history')).bookings.some(item => item.id === delivery.id)); pass('signature completes delivery and both sides agree on history');
 const { booking: ride } = await create('RIDE'); ok(await patch(ride.id, 'ACCEPTED'));
 for (const stage of ['HEADING', 'ARRIVED']) { ok(await rider(`/api/bookings/${ride.id}/pickup-progress`, { stage })); assert.equal(ok(await customer(`/api/bookings/${ride.id}/pickup-progress`)).pickupProgress.stage, stage); }
 const { otp } = ok(await customer(`/api/bookings/${ride.id}/otp`)); assert.match(otp, /^\d{6}$/);
 const wrong = otp === '000000' ? '111111' : '000000'; assert.equal((await patch(ride.id, 'PICKED_UP', wrong)).status, 400);
 ok(await patch(ride.id, 'PICKED_UP', otp)); ok(await patch(ride.id, 'IN_TRANSIT')); ok(await patch(ride.id, 'DELIVERED'));
 assert.equal(ok(await customer('/api/bookings/status?onlyTracked=1&ids=' + ride.id)).bookings[0].status, 'DELIVERED'); pass('heading, arrival, wrong/correct pickup code and ride completion work across independent app secrets');
 const { booking: cancelled } = await create('RIDE'); ok(await patch(cancelled.id, 'ACCEPTED'));
 ok(await customer(`/api/bookings/${cancelled.id}/cancel`, { reason: 'Isolated reliability cancellation check' }));
 assert.equal(ok(await rider('/api/rider/updates')).assigned.find(item => item.id === cancelled.id).status, 'CANCELLED');
 assert.equal((await patch(cancelled.id, 'PICKED_UP', '000000')).status, 409); pass('customer cancellation reaches rider monitoring and blocks further progress');
 const { booking: stale } = await create('RIDE'); await db.booking.update({ where: { id: stale.id, customerId: state.customer.id }, data: { createdAt: new Date(Date.now() - 11 * 60000), paymentMethod: 'DEMO_GCASH', paymentStatus: 'PAID' } });
 assert.equal((await patch(stale.id, 'ACCEPTED')).status, 409);
 const expired = ok(await customer('/api/bookings/status?onlyTracked=1&ids=' + stale.id)).bookings[0]; assert.equal(expired.status, 'CANCELLED'); assert.match(expired.cancellationReason, /Request expired/);
 assert.equal((await db.booking.findUniqueOrThrow({ where: { id: stale.id } })).paymentStatus, 'REFUNDED');
 assert.equal(await db.customerNotification.count({ where: { bookingId: stale.id, title: 'Your request expired' } }), 1); pass('expired request cannot be claimed; customer sees reason and simulated payment is refunded once');
 const { booking: scheduled } = await create('RIDE', { scheduledAt: new Date(Date.now() + 3600000).toISOString() });
 assert(ok(await rider('/api/rider/available?includeMatched=true')).upcomingJobs.some(item => item.id === scheduled.id)); assert.equal((await patch(scheduled.id, 'ACCEPTED')).status, 409);
 await db.booking.update({ where: { id: scheduled.id, customerId: state.customer.id }, data: { createdAt: new Date(Date.now() - 86400000) } });
 assert.equal(ok(await customer('/api/bookings/status?onlyTracked=1&ids=' + scheduled.id)).bookings[0].status, 'PENDING'); pass('future scheduled booking survives old creation date and cannot be claimed early');
 fs.writeFileSync(path.join(path.dirname(stateFile), 'reliability-results.json'), JSON.stringify({ passed: passes.length, checks: passes, bookingIds: ids, schema: state.schema, physicalPhones: false, externalEmail: 'disabled' }, null, 2));
 console.log(JSON.stringify({ passed: passes.length, isolated: true, physicalPhones: false, externalEmail: 'disabled' }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
