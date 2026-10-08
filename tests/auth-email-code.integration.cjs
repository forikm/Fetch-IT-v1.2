// Real PostgreSQL transactions in a disposable schema; Firebase and SMTP are
// replaced with in-memory adapters. Never creates real accounts or sends email.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { NextRequest } = require('next/server');
const ts = require('typescript');
if (process.env.RUN_AUTH_EMAIL_INTEGRATION !== '1') throw new Error('Set RUN_AUTH_EMAIL_INTEGRATION=1.');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, '.env'));
const schema = 'fetch_auth_code_test_' + crypto.randomUUID().replaceAll('-', '');
const target = new URL(process.env.DATABASE_URL);
target.searchParams.set('schema', schema);
target.searchParams.set('options', `-c search_path=${schema},pg_catalog`);
const databaseUrl = target.toString();
Object.assign(process.env, { NODE_ENV: 'production', SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  EMAIL_CODE_SECRET: crypto.randomBytes(32).toString('hex'), NEXT_PUBLIC_EMAIL_CODE_AUTH: 'true',
  GMAIL_SENDER: 'fixture-sender@gmail.com', GMAIL_APP_PASSWORD: 'fixturepassword123' });
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const messages = [], firebaseUsers = new Map(), updates = [], revocations = [];
let ownsSchema = false, cookie = '', failMail = false;
const fakeAuth = {
  async verifyIdToken(token) { const uid = token.replace('token:', ''); const user = firebaseUsers.get(uid); if (!user || !token.startsWith('token:')) throw Error('Invalid token'); return { uid, email: user.email, auth_time: user.authTime ?? Math.floor(Date.now() / 1000), email_verified: user.emailVerified }; },
  async getUser(uid) { const user = firebaseUsers.get(uid); if (!user) throw Object.assign(Error('Not found'), { code: 'auth/user-not-found' }); return { ...user }; },
  async getUserByEmail(email) { const user = [...firebaseUsers.values()].find(u => u.email === email); if (!user) throw Object.assign(Error('Not found'), { code: 'auth/user-not-found' }); return { ...user }; },
  async updateUser(uid, data) { updates.push({ uid, ...data }); Object.assign(firebaseUsers.get(uid), data); return this.getUser(uid); },
  async revokeRefreshTokens(uid) { revocations.push(uid); },
};
const cached = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (cached.has(absolute)) return cached.get(absolute);
  const exports = {};
  cached.set(absolute, exports);
  const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports, Buffer, process, console: { info() {}, error() {} }, Date,
    require(name) {
      if (name === './db' || name === '@/lib/db') return { db };
      if (name === './firebase-admin' || name === '@/lib/firebase-admin') return { getCustomerAdminAuth: () => fakeAuth };
      // libphonenumber checks plain-object prototypes; execute the real helper
      // in its own Node realm rather than passing VM-realm options to it.
      if (name === '@/lib/phone') return require(path.join(root, 'src/lib/phone.ts'));
      if (name === 'next/headers') return { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined,
        set(_, value) { cookie = value; }, delete() { cookie = ''; } }) };
      if (name === 'nodemailer') return { createTransport: () => ({ close() {}, async sendMail(message) {
        if (failMail) throw Error('Simulated delivery failure'); messages.push(message); return { accepted: [message.to] };
      } }) };
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(absolute), name + '.ts')));
      if (name.startsWith('@/')) return load(name.replace('@/', 'src/') + '.ts');
      return require(name);
    },
  }, { filename: absolute });
  return exports;
}
async function prepare() {
  assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname = ${schema}`).length, 0);
  ownsSchema = true;
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', windowsHide: true, timeout: 90000 });
  assert.equal(result.status, 0, 'Temporary schema migrations must succeed.');
  assert((await db.$queryRaw`SHOW search_path`)[0].search_path.includes(schema));
  for (const fn of await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${schema}`) {
    assert(/^fetch_[a-z_]+$/.test(fn.name));
    await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);
  }
}
function firebase(uid, email) { firebaseUsers.set(uid, { uid, email, emailVerified: false, disabled: false, providerData: [{ providerId: 'password' }] }); }
function mailCode() { const match = messages.at(-1).text.match(/code is ([0-9]{6})/); assert(match); return match[1]; }
async function quotaReset() { await db.rateLimitBucket.deleteMany(); }
(async () => {
  try {
    await prepare();
    const { handleEmailCode } = load('src/lib/auth-email-api.ts');
    const { withRequestLog } = load('src/lib/request-guard.ts');
    const { verifyPassword } = load('src/lib/password.ts');
    const { createSessionToken, getSession, verifySessionToken } = load('src/lib/session.ts');
    const exchange = load('src/app/api/auth/firebase-session/route.ts').POST;
    const profile = load('src/app/api/auth/me/route.ts').PATCH;
    async function request(action, body, expected = 200, headers = {}) {
      const req = new NextRequest('https://fixture.invalid/api/auth/code', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const res = await withRequestLog('fixture:email-code', r => handleEmailCode(r, action))(req);
      const data = await res.json(); assert.equal(res.status, expected, data.error);
      assert(res.headers.get('X-Request-ID')); assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
      return { data, res };
    }
    firebase('firebase-one', 'one@example.invalid'); firebase('firebase-two', 'two@example.invalid');
    const user = await db.user.create({ data: { name: 'Code fixture', email: 'one@example.invalid', role: 'CUSTOMER',
      authIdentities: { create: { provider: 'FIREBASE', providerUserId: 'firebase-one' } } } });
    const booking = await db.booking.create({ data: { refCode: 'AUTH-CODE-FIXTURE', customerId: user.id,
      pickupLabel: 'Fixture pickup', pickupLat: 14.6, pickupLng: 120.9, dropoffLabel: 'Fixture dropoff', dropoffLat: 14.7, dropoffLng: 121,
      vehicleClass: 'MOTORCYCLE', distanceKm: 1, baseFare: 50, totalFare: 50 } });
    await request('send-verification', {}, 401);
    await request('send-verification', { idToken: 'token:firebase-one' }, 403, { origin: 'https://attacker.invalid' });
    let challenge = (await request('send-verification', { idToken: 'token:firebase-one', email: 'attacker@example.invalid' })).data;
    assert.equal(messages.at(-1).to, user.email);
    assert.equal('code' in challenge, false);
    const row = await db.authEmailCode.findUnique({ where: { id: challenge.challengeId } });
    assert.equal(row.codeHash.length, 64); assert.notEqual(row.codeHash, mailCode());
    const limited = await request('send-verification', { idToken: 'token:firebase-one' }, 429);
    assert(Number(limited.res.headers.get('Retry-After')) > 0);
    await request('verify-email', { idToken: 'token:firebase-two', challengeId: row.id, code: mailCode() }, 400);
    await request('reset-password', { challengeId: row.id, code: mailCode(), password: 'newpass' }, 400);
    let code = mailCode();
    await Promise.all([0, 1, 2, 3, 4].map(() => request('verify-email', { idToken: 'token:firebase-one', challengeId: row.id,
      code: code === '000000' ? '111111' : '000000' }, 400)));
    assert.equal((await db.authEmailCode.findUnique({ where: { id: row.id } })).attempts, 5);
    await request('verify-email', { idToken: 'token:firebase-one', challengeId: row.id, code }, 400);
    await quotaReset();
    challenge = (await request('send-verification', { idToken: 'token:firebase-one' })).data; code = mailCode();
    const confirms = await Promise.all([0, 1].map(async () => {
      const req = new NextRequest('https://fixture.invalid/api/auth/code', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'token:firebase-one', challengeId: challenge.challengeId, code }) });
      return (await handleEmailCode(req, 'verify-email')).status;
    }));
    assert.deepEqual(confirms.sort(), [200, 400]); assert.equal(updates.filter(u => u.emailVerified === true).length, 1);
    await request('verify-email', { idToken: 'token:firebase-one', challengeId: challenge.challengeId, code }, 400);
    await quotaReset();
    const previous = (await request('send-verification', { idToken: 'token:firebase-two' })).data;
    const oldCode = mailCode(); await quotaReset();
    challenge = (await request('send-verification', { idToken: 'token:firebase-two' })).data;
    await request('verify-email', { idToken: 'token:firebase-two', challengeId: previous.challengeId, code: oldCode }, 400);
    await db.authEmailCode.update({ where: { id: challenge.challengeId }, data: { expiresAt: new Date(Date.now() - 1) } });
    await request('verify-email', { idToken: 'token:firebase-two', challengeId: challenge.challengeId, code: mailCode() }, 400);
    await quotaReset();
    const unknown = (await request('send-reset', { email: 'unknown@example.invalid' })).data;
    const beforeMessages = messages.length;
    const rider = await db.user.create({ data: { name: 'Rider fixture', email: 'rider@example.invalid', role: 'RIDER' } });
    const disallowed = (await request('send-reset', { email: rider.email })).data;
    assert.equal(messages.length, beforeMessages);
    const reset = (await request('send-reset', { email: user.email })).data;
    assert.deepEqual(Object.keys(unknown).sort(), Object.keys(reset).sort()); assert.equal(unknown.message, reset.message);
    assert.equal(disallowed.message, reset.message);
    await request('reset-password', { challengeId: unknown.challengeId, code: '123456', password: 'newpass' }, 400);
    cookie = createSessionToken({ uid: user.id, email: user.email, name: user.name, role: user.role });
    const originalAuthentication = verifySessionToken(cookie).iat;
    assert.equal((await profile(new NextRequest('https://fixture.invalid/api/auth/me', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Updated fixture', phone: '+639171234567' }) }))).status, 200);
    assert.equal(verifySessionToken(cookie).iat, originalAuthentication, 'Profile changes must preserve the original authentication time.');
    assert(await getSession()); code = mailCode();
    await request('reset-password', { challengeId: reset.challengeId, code, password: 'short' }, 400);
    await request('reset-password', { challengeId: reset.challengeId, code, password: 'newpass' });
    assert.equal(firebaseUsers.get('firebase-one').password, 'newpass'); assert(revocations.includes('firebase-one'));
    assert.equal(await getSession(), null); assert.equal((await db.user.findUnique({ where: { id: user.id } })).email, user.email);
    assert.equal((await db.booking.findUnique({ where: { id: booking.id } })).customerId, user.id);
    firebaseUsers.get('firebase-one').authTime = Math.floor(originalAuthentication / 1000) - 5;
    const exchangeRequest = () => new NextRequest('https://fixture.invalid/api/auth/firebase-session', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: 'token:firebase-one' }) });
    assert.equal((await exchange(exchangeRequest())).status, 401, 'An old Firebase authentication cannot recreate a cookie after reset.');
    firebaseUsers.get('firebase-one').authTime = Math.floor((await db.user.findUnique({ where: { id: user.id } })).authInvalidBefore.getTime() / 1000) + 2;
    assert.equal((await exchange(exchangeRequest())).status, 200);
    assert.equal((await getSession()).uid, user.id);
    await request('reset-password', { challengeId: reset.challengeId, code, password: 'otherpass' }, 400);
    const { hashPassword } = load('src/lib/password.ts');
    const legacy = await db.user.create({ data: { name: 'Older account', email: 'legacy@example.invalid', role: 'CUSTOMER',
      authIdentities: { create: { provider: 'PASSWORD', providerUserId: 'legacy@example.invalid', passwordHash: hashPassword('oldpass') } } } });
    cookie = createSessionToken({ uid: legacy.id, email: legacy.email, name: legacy.name, role: legacy.role });
    await quotaReset();
    challenge = (await request('send-reset', { email: legacy.email })).data;
    await request('reset-password', { challengeId: challenge.challengeId, code: mailCode(), password: 'sixsix' });
    const passwordIdentity = await db.authIdentity.findFirst({ where: { userId: legacy.id, provider: 'PASSWORD' } });
    assert(verifyPassword('sixsix', passwordIdentity.passwordHash)); assert.equal(verifyPassword('oldpass', passwordIdentity.passwordHash), false);
    assert.equal(await getSession(), null);
    cookie = createSessionToken({ uid: legacy.id, email: legacy.email, name: legacy.name, role: legacy.role,
      iat: (await db.user.findUnique({ where: { id: legacy.id } })).authInvalidBefore.getTime() + 1 });
    assert(await getSession());
    await quotaReset(); failMail = true;
    assert.equal((await request('send-reset', { email: legacy.email })).data.message, unknown.message);
    assert.equal(await db.authEmailCode.count({ where: { email: legacy.email } }), 0);
    await quotaReset();
    await request('send-verification', { idToken: 'token:firebase-two' }, 503);
    process.env.NEXT_PUBLIC_EMAIL_CODE_AUTH = 'false';
    await request('send-reset', { email: legacy.email }, 503);
    console.log('PASS: real DB code hashing, expiry, five-attempt locks, replay/concurrent consumption, resend replacement/cooldown, identity binding, reset privacy, Firebase and legacy password resets, session revocation, and delivery failure. No real emails/accounts.');
  } finally {
    try { if (ownsSchema) { assert(/^fetch_auth_code_test_[a-f0-9]{32}$/.test(schema)); await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } }
    finally { await db.$disconnect(); }
  }
})().catch(error => {
  console.error('Email code integration failed; no application records were changed.');
  // Locations only: assertion values can contain credential fixture data.
  console.error(String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4).join('\n'));
  process.exitCode = 1;
});
