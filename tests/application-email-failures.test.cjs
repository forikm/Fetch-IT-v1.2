const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');
const root = path.resolve(__dirname, '..');
class ApplicationError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
class RateLimitError extends Error { constructor() { super('Wait before resending.'); this.retryAfter = 47; } }
function load(file, mocks, env = {}, logs = []) {
  mocks = { "./local-demo-runtime": { localDemoEnabled: () => false }, "./local-demo-files": {}, "./application-demo-mode": {}, ...mocks };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, Buffer, Response, File, Date, Uint8Array, process: { env }, console: { error: (...args) => logs.push(args) }, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return exports;
}
test('invalid sender configuration logs only safe flags and never tries SMTP', () => {
  const logs = [];
  const mod = load('src/lib/application-mail.ts', { './db': { db: {} }, './rider-application-policy': { ApplicationError }, nodemailer: { createTransport() { throw Error('SMTP must not start'); } } }, { GMAIL_SENDER: 'fixture@gmail.com', GMAIL_APP_PASSWORD: 'TOO_SHORT' }, logs);
  assert.throws(() => mod.applicationTransport(), error => error.status === 503 && error.code === 'EMAIL_SENDER_UNAVAILABLE');
  assert.equal(logs[0][1].senderValid, true);
  assert.equal(logs[0][1].passwordLengthValid, false);
  assert(!JSON.stringify(logs).includes('fixture@gmail.com'));
  assert(!JSON.stringify(logs).includes('TOO_SHORT'));
});
function fixture(mode) {
  const logs = [], scopes = [];
  const counters = { challenges: 0, sent: 0, closed: 0 };
  const mocks = {
    './db': { db: { authEmailCode: { upsert: async () => { counters.challenges++; } } } },
    './rider-application': { ensureApplication: async () => ({ id: 'fixture-app', user: { email: 'applicant@example.invalid' } }) },
    './rider-application-policy': { ApplicationError }, './application-storage': {}, './application-upload': {},
    './application-staff-api': { readApplicationBody: async () => ({ action: 'send-code' }), applicationErrorResponse: error => NextResponse.json({ error: error instanceof ApplicationError || error instanceof RateLimitError ? error.message : 'Application unavailable.' }, { status: error instanceof RateLimitError ? 429 : 503, headers: error instanceof RateLimitError ? { 'Retry-After': String(error.retryAfter) } : {} }) },
    './application-mail': { applicationTransport() {
      if (mode === 'configuration') throw new ApplicationError('Email unavailable.', 503);
      return { sender: 'fixture@gmail.com', transport: { close() { counters.closed++; }, async sendMail() { counters.sent++; if (mode === 'smtp') throw Object.assign(new Error('PRIVATE_SMTP_RESPONSE'), { code: 'EAUTH' }); return { accepted: ['applicant@example.invalid'] }; } } };
    } },
    './request-guard': { RateLimitError, safeErrorCode: e => e.code || 'INTERNAL', limitRequests: async scope => { scopes.push(scope); if (mode === 'rate' && scope.endsWith('email-minute')) throw new RateLimitError(); } },
    './session-secret': { sessionSecret: () => 'a'.repeat(40) },
  };
  return { ...load('src/lib/application-applicant-api.ts', mocks, {}, logs), logs, scopes, counters };
}
async function send(f) { return f.applicantRequest(new NextRequest('https://fixture.invalid/api/rider/application', { method: 'POST', body: '{}' }), 'fixture-user'); }
test('an unavailable sender does not consume email quota or create an unusable code', async () => {
  const f = fixture('configuration');
  assert.equal((await send(f)).status, 503);
  assert(!f.scopes.some(s => s.includes('application-email-')));
  assert.equal(f.counters.challenges, 0);
  assert.equal(f.counters.sent, 0);
});
test('resend rate limiting keeps Retry-After and closes the unused transport', async () => {
  const f = fixture('rate'), res = await send(f);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '47');
  assert.deepEqual(f.counters, { challenges: 0, sent: 0, closed: 1 });
});
test('SMTP errors have actionable safe diagnostics without private messages', async () => {
  const f = fixture('smtp');
  assert.equal((await send(f)).status, 503);
  assert.equal(f.logs[0][1].stage, 'smtp-send');
  assert.equal(f.logs[0][1].code, 'EAUTH');
  assert(!JSON.stringify(f.logs).includes('PRIVATE_SMTP_RESPONSE'));
  assert(!JSON.stringify(f.logs).includes('applicant@example.invalid'));
  assert.deepEqual(f.counters, { challenges: 1, sent: 1, closed: 1 });
});
