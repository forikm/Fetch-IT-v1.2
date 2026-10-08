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
if (process.env.RUN_MEMBER_INTEGRATION !== '1') throw Error('Set RUN_MEMBER_INTEGRATION=1.');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, '.env'));
const schema = 'fetch_members_test_' + crypto.randomUUID().replaceAll('-', '');
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
  vm.runInNewContext(compiled, { exports, Buffer, process, console: { info() {}, error() {} }, Date,
    require(name) {
      if (name === './db' || name === '@/lib/db') return { db };
      if ((name === './session' || name === '@/lib/session') && owner !== path.resolve(root, '../fetch-admin')) return { getSession: async () => session };
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
async function request(handler, body, status = 200, id) {
  const response = await handler(new NextRequest('https://fixture.invalid/api/test', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://fixture.invalid' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const data = await response.json();
  assert.equal(response.status, status, `Expected ${status}; got ${response.status}: ${data.error || ''}`);
  return data;
}
async function main() {
  try {
    await prepare();
    const customer = await db.user.create({ data: { name: 'Customer', email: 'customer@fixture.invalid' } });
    const otherCustomer = await db.user.create({ data: { name: 'Other', email: 'other@fixture.invalid' } });
    const { hashPassword, verifyPassword } = load('../fetch-admin/src/lib/password.ts');
    const admin = await db.user.create({ data: { name: 'Admin', email: 'admin@fixture.invalid', role: 'ADMIN', authIdentities: { create: { provider: 'PASSWORD', providerUserId: 'admin@fixture.invalid', passwordHash: hashPassword('oldpassword') } } } });
    const riders = [];
    for (let index = 0; index < 3; index++) riders.push(await db.user.create({ data: { name: `Rider ${index}`, email: `rider${index}@fixture.invalid`, role: 'RIDER', riderProfile: { create: { vehicleClass: index === 2 ? 'SEDAN' : 'MOTORCYCLE' } }, riderPresence: { create: { isOnline: true } } } }));
    let sequence = 0;
    const booking = (data = {}) => db.booking.create({ data: { refCode: `MEMBER-${++sequence}`, customerId: customer.id, pickupLabel: 'Pickup', pickupLat: 14.6, pickupLng: 121, dropoffLabel: 'Destination', dropoffLat: 14.61, dropoffLng: 121.01, vehicleClass: 'MOTORCYCLE', distanceKm: 2, baseFare: 50, totalFare: 100, ...data } });
    const { confirmCashPayment, reviewPayment } = load('src/lib/payments.ts');
    const { assignRider, expireRiderOffers } = load('src/lib/dispatch.ts');
    const { PATCH } = load('../fetch-rider/src/app/api/bookings/[id]/route.ts');
    const cancel = load('src/app/api/bookings/[id]/cancel/route.ts').POST;

    const cash = await booking({ riderId: riders[0].id, status: 'DELIVERED', deliveredAt: new Date() });
    await assert.rejects(confirmCashPayment(db, cash.id, actor(otherCustomer), '100'), /participant/);
    await assert.rejects(confirmCashPayment(db, cash.id, actor(riders[1]), '100'), /participant/);
    await Promise.all([confirmCashPayment(db, cash.id, actor(customer), '100.00'), confirmCashPayment(db, cash.id, actor(riders[0]), 100)]);
    const paid = await db.booking.findUnique({ where: { id: cash.id } });
    assert.equal(paid.paymentStatus, 'PAID'); assert(paid.paidAt); assert.equal(paid.paymentReference, `CASH-${cash.refCode}`);
    assert.equal(await db.paymentEvent.count({ where: { bookingId: cash.id } }), 2);
    await confirmCashPayment(db, cash.id, actor(customer), 100);
    assert.equal(await db.paymentEvent.count({ where: { bookingId: cash.id } }), 2, 'Retry must not duplicate confirmation');
    await assert.rejects(confirmCashPayment(db, cash.id, actor(customer), 90), /final/);
    await reviewPayment(db, cash.id, actor(admin), { status: 'REFUNDED', reason: 'Cash returned to customer' });
    await assert.rejects(reviewPayment(db, cash.id, actor(admin), { status: 'PAID', reason: 'Replay' }), /final/);

    const discrepancy = await booking({ riderId: riders[0].id, status: 'DELIVERED' });
    await confirmCashPayment(db, discrepancy.id, actor(customer), 90);
    await confirmCashPayment(db, discrepancy.id, actor(riders[0]), 100);
    assert.equal((await db.booking.findUnique({ where: { id: discrepancy.id } })).paymentStatus, 'PENDING');
    await assert.rejects(confirmCashPayment(db, discrepancy.id, actor(customer), 100), /already recorded/);
    await reviewPayment(db, discrepancy.id, actor(admin), { status: 'PAID', reason: 'Verified remaining 10 pesos collected', reference: 'Manual-verified' });
    assert.equal(await db.adminAudit.count({ where: { action: 'PAYMENT_UPDATED' } }), 2);
    await assert.rejects(reviewPayment(db, discrepancy.id, actor(customer), { status: 'UNPAID', reason: 'Unauthorized' }), /Admin/);
    await assert.rejects(reviewPayment(db, (await booking()).id, actor(admin), { status: 'REFUNDED', reason: 'No payment' }), /Only a paid/);

    const dispatched = await booking();
    await assert.rejects(assignRider(db, dispatched.id, actor(admin), 'Assign', riders[2].id), /matching vehicle/);
    await assignRider(db, dispatched.id, actor(admin), 'Assign first available', riders[0].id);
    let offer = await db.booking.findUnique({ where: { id: dispatched.id } });
    assert.equal(offer.status, 'MATCHED'); assert(offer.assignmentExpiresAt > new Date());
    await db.booking.update({ where: { id: offer.id }, data: { assignmentExpiresAt: new Date(Date.now() - 1) } });
    await Promise.all([expireRiderOffers(db), expireRiderOffers(db)]);
    offer = await db.booking.findUnique({ where: { id: dispatched.id } });
    assert.equal(offer.riderId, riders[1].id); assert(offer.excludedRiderIds.includes(riders[0].id));
    assert.equal(await db.bookingEvent.count({ where: { bookingId: offer.id, action: 'REASSIGNED' } }), 1);
    session = { ...actor(riders[0]), email: riders[0].email };
    await request(PATCH, { status: 'ACCEPTED' }, 409, offer.id);
    session = { ...actor(riders[1]), email: riders[1].email };
    await request(PATCH, { status: 'ACCEPTED' }, 200, offer.id);
    assert.equal((await db.booking.findUnique({ where: { id: offer.id } })).assignmentExpiresAt, null);
    await assignRider(db, offer.id, actor(riders[1]), 'Unable to reach pickup');
    offer = await db.booking.findUnique({ where: { id: offer.id } });
    assert.equal(offer.status, 'PENDING'); assert.equal(offer.riderId, null);
    assert.equal(offer.excludedRiderIds.length, 2);

    const a = await booking(), b = await booking();
    const reserved = await Promise.allSettled([assignRider(db, a.id, actor(admin), 'Dispatch A', riders[0].id), assignRider(db, b.id, actor(admin), 'Dispatch B', riders[0].id)]);
    assert.equal(reserved.filter(item => item.status === 'fulfilled').length, 1, 'A rider cannot hold two concurrent offers');
    await db.booking.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: 'CANCELLED', assignmentExpiresAt: null } });
    const picked = await booking({ riderId: riders[0].id, status: 'PICKED_UP', pickedUpAt: new Date() });
    await assert.rejects(assignRider(db, picked.id, actor(admin), 'Too late', riders[1].id), /before pickup/);
    const paymentStarted = await booking({ riderId: riders[0].id, status: 'ACCEPTED', customerPaidAt: new Date(), customerPaidAmount: 100 });
    await assert.rejects(assignRider(db, paymentStarted.id, actor(admin), 'Payment started', riders[1].id), /Payment has been recorded/);
    const future = await booking({ scheduledAt: new Date(Date.now() + 86400000) });
    await assert.rejects(assignRider(db, future.id, actor(admin), 'Too early', riders[1].id), /scheduled/);

    session = { ...actor(customer), email: customer.email };
    const cancellable = await booking();
    await request(cancel, {}, 400, cancellable.id);
    await request(cancel, { reason: 'Plans changed' }, 200, cancellable.id);
    assert.equal((await db.booking.findUnique({ where: { id: cancellable.id } })).cancellationReason, 'Plans changed');
    await request(cancel, { reason: 'Too late' }, 400, picked.id);

    const { adminPasswordReset } = load('../fetch-admin/src/lib/admin-password-reset.ts');
    const send = req => adminPasswordReset(req, 'send'), reset = req => adminPasswordReset(req, 'reset');
    const { createAdminSessionToken } = load('../fetch-admin/src/lib/session.ts');
    const { currentAdmin } = load('../fetch-admin/src/lib/admin-access.ts');
    cookie = createAdminSessionToken({ uid: admin.id, email: admin.email, name: admin.name });
    assert(await currentAdmin());
    const unknown = await request(send, { email: 'unknown@fixture.invalid' });
    const customerReset = await request(send, { email: customer.email });
    assert.equal(customerReset.message, unknown.message);
    assert.equal(messages.length, 0, 'Admin recovery cannot recover customer accounts');
    const challenge = await request(send, { email: admin.email });
    assert.equal(challenge.message, unknown.message);
    const code = messages.at(-1).text.match(/code is ([0-9]{6})/)[1];
    const row = await db.authEmailCode.findUnique({ where: { id: challenge.challengeId } });
    assert.notEqual(row.codeHash, code);
    assert.equal(await load('../fetch-admin/src/lib/auth-email-code.ts').consumeEmailCode(challenge.challengeId, 'RESET_PASSWORD', code), null, 'Admin code cannot be used for customer recovery');
    await request(reset, { challengeId: challenge.challengeId, code: 'x', password: 'newpassword' }, 400);
    await request(reset, { challengeId: challenge.challengeId, code, password: 'newpassword' });
    assert.equal(await currentAdmin(), null, 'Old admin session is revoked');
    const identity = await db.authIdentity.findFirst({ where: { userId: admin.id, provider: 'PASSWORD' } });
    assert(verifyPassword('newpassword', identity.passwordHash)); assert(!verifyPassword('oldpassword', identity.passwordHash));
    await request(reset, { challengeId: challenge.challengeId, code, password: 'anotherpassword' }, 400);
    assert.equal(await db.adminAudit.count({ where: { action: 'PASSWORD_RESET' } }), 1);
    const login = load('../fetch-admin/src/app/api/auth/login/route.ts').POST;
    await request(login, { email: admin.email, password: 'oldpassword' }, 401);
    await request(login, { email: admin.email, password: 'newpassword' });
    assert(await currentAdmin());
    assert.equal(await db.adminAudit.count({ where: { action: 'LOGIN_SUCCEEDED' } }), 1);
    assert.equal(await db.adminAudit.count({ where: { action: 'LOGIN_FAILED' } }), 1);
    await db.rateLimitBucket.deleteMany(); failMail = true;
    const failedDelivery = await request(send, { email: admin.email });
    assert.equal(failedDelivery.message, unknown.message);
    assert.equal(await db.authEmailCode.count({ where: { email: admin.email, purpose: 'ADMIN_RESET_PASSWORD' } }), 0);
    console.log('PASS: concurrent cash confirmations, mismatches, review/refund, access control, timed offers, expiry races, declines, rider reservation races, pickup/payment guards, cancellation reasons, admin recovery, code replay protection, session revocation, login history and mail failure. No real emails or application records changed.');
  } finally {
    try { if (ownsSchema) { assert(/^fetch_members_test_[a-f0-9]{32}$/.test(schema)); await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } }
    finally { await db.$disconnect(); }
  }
}
main().catch(error => { console.error('Member integration check failed:', String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); console.error(String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4).join('\n')); process.exitCode = 1; });
