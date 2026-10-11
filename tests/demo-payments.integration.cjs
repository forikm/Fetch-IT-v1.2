// Real transactions and route handlers in a disposable PostgreSQL schema.
// SMTP is mocked. No application records, real emails, or deployed apps change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { NextRequest } = require('next/server');
const ts = require('typescript');
if (process.env.RUN_DEMO_INTEGRATION !== '1') throw Error('Set RUN_DEMO_INTEGRATION=1.');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, '.env'));
const schema = 'fetch_demo_test_' + crypto.randomUUID().replaceAll('-', '');
const target = new URL(process.env.BOOKING_TEST_DATABASE_URL || process.env.DATABASE_URL);
target.searchParams.set('schema', schema);
target.searchParams.set('options', `-c search_path=${schema},pg_catalog`);
const databaseUrl = target.toString();
Object.assign(process.env, { NODE_ENV: 'production', SESSION_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString('hex'), EMAIL_CODE_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_EMAIL_CODE_AUTH: 'true', GMAIL_SENDER: 'fixture-sender@gmail.com', GMAIL_APP_PASSWORD: 'fixturepassword123' });
const db = new PrismaClient({ datasourceUrl: databaseUrl });
let ownsSchema = false, session = null, cookie = '', failMail = false;
const messages = [];
const cached = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (cached.has(absolute)) return cached.get(absolute);
  const exports = {};
  cached.set(absolute, exports);
  const owner = absolute.includes('fetch-admin') ? path.resolve(root, '../fetch-admin') : absolute.includes('fetch-rider') ? path.resolve(root, '../fetch-rider') : root;
  const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports, Buffer, process, console: { info() {}, error(...args) { if (args[0] === '[bookings POST] error') console.error(...args); } }, Date, URL,
    require(name) {
      if (name === './db' || name === '@/lib/db') return { db };
      if ((name === './session' || name === '@/lib/session') && owner !== path.resolve(root, '../fetch-admin')) return { getSession: async () => session };
      if (name === '@/lib/admin-access') return { currentAdmin: async () => session?.role === 'ADMIN' ? db.user.findUnique({ where: { id: session.uid } }) : null };
      if (name === 'next/headers') return { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined, set(_, value) { cookie = value; }, delete() { cookie = ''; } }) };
      if (name === 'next/navigation') return { redirect() { throw Error('Redirect'); } };
      if (name === 'nodemailer') return { createTransport: () => ({ close() {}, async sendMail(message) { if (failMail) throw Error('SMTP failed'); messages.push(message); return { accepted: [message.to] }; } }) };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), name + '.ts'));
      if (name.startsWith('@/')) return load(path.resolve(owner, name.replace('@/', 'src/') + '.ts'));
      return require(name);
    },
  }, { filename: absolute });
  return exports;
}
function actor(user) { return { uid: user.id, name: user.name, role: user.role }; }
async function prepare() {
  assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname=${schema}`).length, 0);
  ownsSchema = true;
  const migration = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, windowsHide: true, encoding: 'utf8', timeout: 90000 });
  const diagnostic = `${migration.stdout || ''}\n${migration.stderr || ''}`.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL redacted]');
  assert.equal(migration.status, 0, `Isolated migrations must succeed. ${diagnostic.slice(-1800)}`);
  assert((await db.$queryRaw`SHOW search_path`)[0].search_path.includes(schema));
  for (const fn of await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${schema}`) {
    assert(/^fetch_[a-z_]+$/.test(fn.name));
    await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);
  }
}
async function request(handler, body, status = 200, id, method = 'POST', headers = {}) {
  const response = await handler(new NextRequest('https://fixture.invalid/api/test', { method, headers: { 'content-type': 'application/json', origin: 'https://fixture.invalid', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ id }) });
  const data = await response.json();
  assert.equal(response.status, status, `Expected ${status}; got ${response.status}: ${data.error || ''}`);
  return data;
}
async function main() {
  try {
    await prepare();
    const customer = await db.user.create({ data: { name: 'Demo customer', email: 'customer@fixture.invalid' } });
    const other = await db.user.create({ data: { name: 'Other customer', email: 'other@fixture.invalid' } });
    const admin = await db.user.create({ data: { name: 'Admin', email: 'admin@fixture.invalid', role: 'ADMIN' } });
    const riders = [];
    for (let i = 0; i < 2; i++) riders.push(await db.user.create({ data: { name: `Rider ${i}`, email: `rider${i}@fixture.invalid`, role: 'RIDER', riderProfile: { create: { vehicleClass: 'MOTORCYCLE' } }, riderPresence: { create: { isOnline: true } } } }));
    const signIn = user => { session = { ...actor(user), email: user.email }; };
    const start = load('src/app/api/bookings/[id]/demo-checkout/route.ts').POST;
    const resolve = load('src/app/api/checkouts/[id]/route.ts').POST;
    const retryCheckout = load('src/app/api/checkouts/[id]/retry/route.ts').POST;
    const create = load('src/app/api/bookings/route.ts').POST;
    const cancel = load('src/app/api/bookings/[id]/cancel/route.ts').POST;
    const status = load('../fetch-rider/src/app/api/bookings/[id]/route.ts').PATCH;
    const proof = load('../fetch-rider/src/app/api/bookings/[id]/proof/route.ts').POST;
    const payout = load('../fetch-admin/src/app/api/bookings/[id]/demo-payout/route.ts').POST;
    const { startDemoCheckout, resolveDemoCheckout, recordDemoPayout, demoCommissionBps } = load('src/lib/demo-payments.ts');
    const { reviewPayment, confirmCashPayment } = load('src/lib/payments.ts');
    const { assignRider } = load('src/lib/dispatch.ts');
    const get = id => db.booking.findUniqueOrThrow({ where: { id } });
    const base = { type: 'RIDE', vehicleClass: 'MOTORCYCLE', pickup: { label: 'Pickup', lat: 14.6, lng: 121 }, dropoff: { label: 'Destination', lat: 14.61, lng: 121.01 }, passengers: 1 };
    signIn(customer);
    const created = [];
    for (const paymentMethod of ['DEMO_GCASH', 'DEMO_MAYA', 'DEMO_BANK', 'CASH']) {
      const key = crypto.randomUUID();
      const data = await request(create, { ...base, paymentMethod }, 200, undefined, 'POST', { 'Idempotency-Key': key });
      if (paymentMethod === 'CASH') {
        assert.equal(data.booking.paymentMethod, 'CASH');
        assert.equal(data.booking.demoCommissionBps, null);
        const retry = await request(create, { ...base, paymentMethod }, 200, undefined, 'POST', { 'Idempotency-Key': key });
        assert.equal(retry.booking.id, data.booking.id);
        created.push(data.booking);
        continue;
      }
      assert(!data.booking, 'Online requests must not create bookings before payment');
      const checkoutId = data.checkoutUrl.split('/').at(-1);
      const attempt = await db.demoCheckout.findUniqueOrThrow({ where: { id: checkoutId }, include: { draft: true } });
      assert.equal(attempt.bookingId, null);
      assert.equal(await db.booking.count({ where: { id: attempt.draftId } }), 0);
      assert.equal(attempt.draft.bookingData.demoCommissionBps, 1500);
      assert.equal(attempt.draft.bookingData.paymentMethod, paymentMethod);
      const retry = await request(create, { paymentMethod, ...base }, 200, undefined, 'POST', { 'Idempotency-Key': key });
      assert.equal(retry.checkoutUrl, data.checkoutUrl, 'Same key resumes the same checkout');
      await request(create, { ...base, paymentMethod, pickup: { ...base.pickup, label: 'Changed pickup' } }, 409, undefined, 'POST', { 'Idempotency-Key': key });
      signIn(other); await request(resolve, { outcome: 'SUCCEEDED' }, 404, checkoutId);
      await request(retryCheckout, {}, 404, checkoutId);
      signIn(customer);
      const [paid, duplicate] = await Promise.all([request(resolve, { outcome: 'SUCCEEDED', amount: 1 }, 200, checkoutId), request(resolve, { outcome: 'SUCCEEDED' }, 200, checkoutId)]);
      assert.equal(paid.bookingId, duplicate.bookingId);
      const paidBooking = await get(paid.bookingId);
      assert.equal(paidBooking.paymentStatus, 'PAID');
      assert.equal(paidBooking.customerPaidAmount.toString(), String(attempt.draft.bookingData.totalFare));
      assert.equal(await db.paymentEvent.count({ where: { bookingId: paid.bookingId } }), 1);
      assert.equal(await db.bookingEvent.count({ where: { bookingId: paid.bookingId, action: 'CREATED' } }), 1);
      assert(paidBooking.ticketId);
      const confirmed = await request(create, { ...base, paymentMethod }, 200, undefined, 'POST', { 'Idempotency-Key': key });
      assert.equal(confirmed.booking.id, paid.bookingId);
      await request(resolve, { outcome: 'FAILED' }, 409, checkoutId);
      await request(retryCheckout, {}, 409, checkoutId);
      // Older unpaid bookings keep their resumable payment flow.
      const saved = attempt.draft.bookingData;
      const legacy = await db.booking.create({ data: { ...saved, id: `legacy_${paymentMethod}`, refCode: `LEGACY-${paymentMethod}`, scheduledAt: null } });
      created.push({ ...legacy, totalFare: Number(legacy.totalFare) });
    }
    // Failed/cancelled/expired checkouts have no booking, ticket, or earnings.
    const onlineBody = { ...base, paymentMethod: 'DEMO_BANK' };
    const onlineKey = crypto.randomUUID();
    const ticketCount = await db.ticketCounter.findMany();
    const [draftA, draftB] = await Promise.all([request(create, onlineBody, 200, undefined, 'POST', { 'Idempotency-Key': onlineKey }), request(create, onlineBody, 200, undefined, 'POST', { 'Idempotency-Key': onlineKey })]);
    assert.equal(draftA.checkoutUrl, draftB.checkoutUrl, 'Concurrent creation shares one pending checkout');
    let onlineId = draftA.checkoutUrl.split('/').at(-1);
    const draftId = (await db.demoCheckout.findUniqueOrThrow({ where: { id: onlineId } })).draftId;
    assert.deepEqual(await db.ticketCounter.findMany(), ticketCount, 'Unpaid drafts do not allocate tracking tickets');
    await request(resolve, { outcome: 'FAILED' }, 200, onlineId);
    assert.equal(await db.booking.count({ where: { id: draftId } }), 0);
    // A failed booking insert rolls back settlement and the ticket counter too.
    const deliveryRequest = await request(create, { ...onlineBody, type: 'DELIVERY', cargoWeightKg: 2 }, 200, undefined, 'POST', { 'Idempotency-Key': crypto.randomUUID() });
    const deliveryCheckoutId = deliveryRequest.checkoutUrl.split('/').at(-1);
    const deliveryAttempt = await db.demoCheckout.findUniqueOrThrow({ where: { id: deliveryCheckoutId }, include: { draft: true } });
    const originalData = deliveryAttempt.draft.bookingData;
    const brokenData = JSON.parse(JSON.stringify(originalData));
    brokenData.events.create.actorId = 'missing-fixture-user';
    await db.checkoutDraft.update({ where: { id: deliveryAttempt.draftId }, data: { bookingData: brokenData } });
    await request(resolve, { outcome: 'SUCCEEDED' }, 503, deliveryCheckoutId);
    assert.equal(await db.booking.count({ where: { id: deliveryAttempt.draftId } }), 0);
    assert.equal((await db.demoCheckout.findUniqueOrThrow({ where: { id: deliveryCheckoutId } })).status, 'PENDING');
    assert.deepEqual(await db.ticketCounter.findMany(), ticketCount);
    await db.checkoutDraft.update({ where: { id: deliveryAttempt.draftId }, data: { bookingData: originalData } });
    const deliveryPaid = await request(resolve, { outcome: 'SUCCEEDED' }, 200, deliveryCheckoutId);
    assert.equal((await get(deliveryPaid.bookingId)).type, 'DELIVERY');
    assert.equal((await get(deliveryPaid.bookingId)).paymentStatus, 'PAID');
    const newAttempt = await request(retryCheckout, {}, 200, onlineId);
    onlineId = newAttempt.checkoutUrl.split('/').at(-1);
    await request(resolve, { outcome: 'CANCELLED' }, 200, onlineId);
    assert.equal(await db.booking.count({ where: { id: draftId } }), 0);
    const restarted = await request(create, onlineBody, 200, undefined, 'POST', { 'Idempotency-Key': onlineKey });
    onlineId = restarted.checkoutUrl.split('/').at(-1);
    await db.checkoutDraft.update({ where: { id: draftId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(resolve, { outcome: 'SUCCEEDED' }, 409, onlineId);
    await request(retryCheckout, {}, 409, onlineId);
    await request(create, onlineBody, 409, undefined, 'POST', { 'Idempotency-Key': onlineKey });
    assert.equal(await db.booking.count({ where: { id: draftId } }), 0);
    await request(create, { ...base, pickup: { ...base.pickup, lat: 'bad' }, paymentMethod: 'DEMO_BANK' }, 400);
    await request(create, { ...base, paymentMethod: 'GCASH' }, 400);
    assert.equal(demoCommissionBps(), 1500);
    process.env.DEMO_COMMISSION_PERCENT = '12.34'; assert.equal(demoCommissionBps(), 1234);
    process.env.DEMO_COMMISSION_PERCENT = '101'; assert.throws(() => demoCommissionBps());
    delete process.env.DEMO_COMMISSION_PERCENT;
    const first = created[0];
    const feed = load('../fetch-rider/src/app/api/rider/available/route.ts').GET;
    signIn(riders[0]);
    const beforeFeed = await request(feed, null, 200, undefined, 'GET');
    assert(beforeFeed.jobs.some(job => job.id === created[3].id));
    assert(!beforeFeed.jobs.some(job => job.id === first.id), 'Unpaid demo jobs must be hidden');
    signIn(customer);
    await assert.rejects(assignRider(db, first.id, actor(admin), 'Before payment', riders[0].id), /payment/);
    await assert.rejects(startDemoCheckout(db, first.id, actor(other)), /not found/);
    await assert.rejects(startDemoCheckout(db, first.id, actor(riders[0])), /not found/);
    const [a, b] = await Promise.all([request(start, {}, 200, first.id), request(start, {}, 200, first.id)]);
    assert.equal(a.checkoutUrl, b.checkoutUrl);
    const checkoutId = a.checkoutUrl.split('/').at(-1);
    assert.equal(await db.demoCheckout.count({ where: { bookingId: first.id } }), 1);
    signIn(other); await request(resolve, { outcome: 'SUCCEEDED' }, 404, checkoutId);
    signIn(customer); await request(resolve, { outcome: 'paid' }, 400, checkoutId);
    await Promise.all([request(resolve, { outcome: 'SUCCEEDED', amount: 1 }, 200, checkoutId), request(resolve, { outcome: 'SUCCEEDED' }, 200, checkoutId)]);
    assert.equal(await db.paymentEvent.count({ where: { bookingId: first.id, action: 'DEMO_CHECKOUT_SUCCEEDED' } }), 1);
    assert.equal((await get(first.id)).customerPaidAmount.toString(), String(first.totalFare), 'Client amount cannot change the server fare');
    assert.equal((await get(first.id)).demoRiderEarnings, null, 'Payment alone does not earn rider funds');
    signIn(riders[0]);
    assert((await request(feed, null, 200, undefined, 'GET')).jobs.some(job => job.id === first.id), 'Paid demo job becomes available');
    signIn(customer);
    await request(resolve, { outcome: 'FAILED' }, 409, checkoutId);
    await request(start, {}, 409, first.id);
    await assert.rejects(confirmCashPayment(db, first.id, actor(customer), first.totalFare), /Cash/);
    await assert.rejects(reviewPayment(db, first.id, actor(admin), { status: 'PAID', reason: 'Forged confirmation' }), /payment/);
    await assert.rejects(recordDemoPayout(db, first.id, actor(admin), { reference: 'early', reason: 'Early' }), /completed/);
    // Funds belong to the booking, so pre-pickup reassignment keeps the payment.
    await assignRider(db, first.id, actor(admin), 'Paid demo assignment', riders[0].id);
    await assignRider(db, first.id, actor(admin), 'Demo reassignment', riders[1].id);
    assert.equal((await get(first.id)).paymentStatus, 'PAID');
    signIn(riders[1]);
    for (const next of ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT']) await request(status, { status: next }, 200, first.id, 'PATCH');
    const finish = () => status(new NextRequest('https://fixture.invalid/api/test', { method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://fixture.invalid' }, body: JSON.stringify({ status: 'DELIVERED' }) }), { params: Promise.resolve({ id: first.id }) });
    const outcomes = await Promise.all([finish(), finish()]);
    assert.deepEqual(outcomes.map(response => response.status).sort(), [200, 409], 'One completion wins and the other is rejected');
    const completed = await get(first.id);
    const { demoSplit } = load('src/lib/payment-policy.ts');
    const split = demoSplit(completed.totalFare.toString(), 1500);
    assert.equal(Number(completed.demoCommission), split.commission);
    assert.equal(Number(completed.demoRiderEarnings), split.riderEarnings);
    assert.equal(await db.paymentEvent.count({ where: { bookingId: first.id, action: 'DEMO_EARNINGS_RECORDED' } }), 1);
    await assert.rejects(recordDemoPayout(db, first.id, actor(customer), { reference: 'bad', reason: 'Bad' }), /Admin/);
    signIn(admin);
    await Promise.all([request(payout, { reference: 'TEST-001', reason: 'Reviewed demo earnings' }, 200, first.id), request(payout, { reference: 'TEST-001', reason: 'Reviewed demo earnings' }, 200, first.id)]);
    assert.equal(await db.paymentEvent.count({ where: { bookingId: first.id, action: 'DEMO_PAYOUT_RECORDED' } }), 1);
    await request(payout, { reference: 'TEST-002', reason: 'Duplicate' }, 409, first.id);
    await assert.rejects(reviewPayment(db, first.id, actor(admin), { status: 'REFUNDED', reason: 'After payout' }), /payout/);
    // Failure/cancellation are immutable per attempt, but new checkout can retry.
    signIn(customer);
    const second = created[1];
    let attempt = await startDemoCheckout(db, second.id, actor(customer));
    await resolveDemoCheckout(db, attempt.id, actor(customer), 'FAILED');
    assert.equal((await get(second.id)).paymentStatus, 'FAILED');
    const retry = await startDemoCheckout(db, second.id, actor(customer)); assert.notEqual(retry.id, attempt.id);
    await resolveDemoCheckout(db, retry.id, actor(customer), 'CANCELLED');
    assert.equal((await get(second.id)).paymentStatus, 'UNPAID');
    attempt = await startDemoCheckout(db, second.id, actor(customer));
    await resolveDemoCheckout(db, attempt.id, actor(customer), 'SUCCEEDED');
    await request(cancel, { reason: 'Demo cancellation' }, 200, second.id);
    assert.equal((await get(second.id)).paymentStatus, 'REFUNDED');
    assert.equal((await get(second.id)).demoRiderEarnings, null);
    await request(start, {}, 409, second.id);
    const third = created[2];
    attempt = await startDemoCheckout(db, third.id, actor(customer));
    await request(cancel, { reason: 'Cancel before payment' }, 200, third.id);
    assert.equal((await get(third.id)).paymentStatus, 'UNPAID');
    await assert.rejects(resolveDemoCheckout(db, attempt.id, actor(customer), 'SUCCEEDED'), /already been recorded/);
    await request(start, {}, 409, created[3].id);
    // Delivery proof completion also posts the demo earnings exactly once.
    const delivery = await db.booking.create({ data: { refCode: 'DEMO-DELIVERY', type: 'DELIVERY', customerId: customer.id, pickupLabel: 'Pickup', pickupLat: 14.6, pickupLng: 121, dropoffLabel: 'Dropoff', dropoffLat: 14.61, dropoffLng: 121.01, vehicleClass: 'MOTORCYCLE', distanceKm: 2, baseFare: 60, totalFare: 60, paymentMethod: 'DEMO_BANK', demoCommissionBps: 1500 } });
    const d = await startDemoCheckout(db, delivery.id, actor(customer));
    await resolveDemoCheckout(db, d.id, actor(customer), 'SUCCEEDED');
    signIn(riders[0]);
    for (const next of ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT']) await request(status, { status: next }, 200, delivery.id, 'PATCH');
    await request(proof, { signatureSvg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L5 5" /></svg>', recipientName: 'Demo recipient' }, 200, delivery.id);
    assert.equal(Number((await get(delivery.id)).demoRiderEarnings), 51);
    await reviewPayment(db, delivery.id, actor(admin), { status: 'REFUNDED', reason: 'Simulated refund before payout' });
    assert.equal((await get(delivery.id)).demoRiderEarnings, null);
    await assert.rejects(recordDemoPayout(db, delivery.id, actor(admin), { reference: 'refunded', reason: 'Refused' }), /completed/);
    // A refund and payout cannot both succeed under simultaneous admin actions.
    const race = await db.booking.create({ data: { refCode: 'DEMO-PAYOUT-RACE', customerId: customer.id, riderId: riders[0].id, status: 'DELIVERED', deliveredAt: new Date(), pickupLabel: 'Pickup', pickupLat: 14.6, pickupLng: 121, dropoffLabel: 'Dropoff', dropoffLat: 14.61, dropoffLng: 121.01, vehicleClass: 'MOTORCYCLE', distanceKm: 2, baseFare: 60, totalFare: 60, paymentMethod: 'DEMO_MAYA', paymentStatus: 'PAID', demoCommissionBps: 1500, demoCommission: 9, demoRiderEarnings: 51 } });
    const competing = await Promise.allSettled([
      recordDemoPayout(db, race.id, actor(admin), { reference: 'RACE', reason: 'Simultaneous payout' }),
      reviewPayment(db, race.id, actor(admin), { status: 'REFUNDED', reason: 'Simultaneous refund' }),
    ]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    const raceResult = await get(race.id);
    assert(raceResult.demoPayoutAt ? raceResult.paymentStatus === 'PAID' : raceResult.paymentStatus === 'REFUNDED');
    // Simulated funds do not enter the cash aggregate.
    signIn(riders[1]);
    const stats = await request(load('../fetch-rider/src/app/api/rider/stats/route.ts').GET, null, 200, undefined, 'GET');
    assert.equal(stats.earnings, 0); assert.equal(stats.demoEarnings, split.riderEarnings);
    assert.equal(stats.demoPaidOut, split.riderEarnings); assert.equal(stats.demoAwaitingPayout, 0);
    signIn(customer);
    const receiptResponse = await load('src/app/api/bookings/[id]/receipt/route.ts').GET(new NextRequest('https://fixture.invalid'), { params: Promise.resolve({ id: first.id }) });
    const receipt = await receiptResponse.text(); assert(receipt.includes('Test payment — no money charged')); assert(!receipt.includes('Cash payment recorded'));
    // Missing auth, wrong roles, and account ownership are enforced by routes.
    session = null; await request(start, {}, 401, first.id);
    signIn(riders[0]); await request(start, {}, 403, first.id); await request(payout, { reference: 'no', reason: 'No' }, 401, first.id);
    console.log('PASS: payment-before-booking for rides and deliveries, three methods, retries/ownership/races/expiry/atomic rollback, legacy checkout, dispatch, completion, earnings, refunds, payouts, cash separation, receipts, and API auth.');
  } finally {
    if (ownsSchema) {
      assert(/^fetch_demo_test_[a-f0-9]{32}$/.test(schema));
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      console.log('Disposable demo schema removed.');
    }
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL redacted]')); process.exitCode = 1; });
