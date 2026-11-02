/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');
const uuid = '11111111-2222-4333-8444-555555555555';
function load(file, deps, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, console, Response, TextDecoder, ...globals, require: name => Object.hasOwn(deps, name) ? deps[name] : require(name) });
  return exports;
}
function serverFixture() {
  let now = 0, clockCalls = 0, failLogs = false;
  const logs = [];
  const api = load('src/lib/booking-telemetry.ts', { 'node:perf_hooks': { performance: { now: () => { clockCalls++; return now; } } } }, {
    process: { env: { VERCEL_REGION: 'sin1', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) } },
    console: { info: line => { if (failLogs) throw Error('Logger unavailable'); logs.push(JSON.parse(line)); } },
  });
  return { api, logs, get clockCalls() { return clockCalls; }, advance: ms => { now += ms; }, failLogs: () => { failLogs = true; } };
}
test('server phases and client event correlate with the existing request ID and expose the real region', async () => {
  const f = serverFixture();
  const handler = f.api.withBookingTelemetry('confirm', async () => {
    await f.api.timeBooking('db.ticket_counter', async () => f.advance(5100));
    return new Response('confirmed', { headers: { 'X-Request-ID': uuid } });
  });
  const response = await handler(new NextRequest('https://fixture.invalid/api/bookings', { method: 'POST', headers: { 'X-Booking-Event-ID': uuid } }));
  assert.equal(await response.text(), 'confirmed');
  assert.equal(response.headers.get('X-Function-Region'), 'sin1');
  assert.match(response.headers.get('Server-Timing'), /app;dur=5100/);
  assert.equal(f.logs[0].slow, true); assert.equal(f.logs[0].requestId, uuid); assert.equal(f.logs[0].clientEventId, uuid);
  assert.equal(f.logs[0].spans[0].name, 'db.ticket_counter');
});
test('slow successful reads are always logged; invalid correlation IDs and phase names are excluded', async () => {
  const f = serverFixture();
  const handler = f.api.withBookingTelemetry('list', async () => {
    f.api.recordBookingTiming('secret@example.invalid', 100);
    for (let i = 0; i < 45; i++) f.api.recordBookingTiming('db.lookup', 1);
    f.advance(5000); return new Response('{}');
  });
  await handler(new NextRequest('https://fixture.invalid/api/bookings', { headers: { 'X-Booking-Event-ID': 'private@example.invalid' } }));
  assert.equal(f.logs.length, 1); assert.equal(f.logs[0].spans.length, 40); assert.equal(f.logs[0].droppedSpans, 5);
  assert(!JSON.stringify(f.logs).includes('@')); assert.equal(f.logs[0].slow, true);
});
test('concurrent requests and inherited background work cannot contaminate response phases', async () => {
  const f = serverFixture(); let release, releaseAfter, background;
  const waiting = new Promise(resolve => { release = resolve; });
  const after = new Promise(resolve => { releaseAfter = resolve; });
  const a = f.api.withBookingTelemetry('confirm', async () => { await waiting; f.api.recordBookingTiming('db.first', 1); background = after.then(() => f.api.timeBooking('db.after_response', async () => {})); return new Response('{}'); });
  const b = f.api.withBookingTelemetry('fare', async () => { f.api.recordBookingTiming('routing.provider', 1); return new Response('{}'); });
  const pending = a(new NextRequest('https://fixture.invalid/api/bookings', { method: 'POST' }));
  await b(new NextRequest('https://fixture.invalid/api/fare/estimate', { method: 'POST' })); release(); await pending;
  const calls = f.clockCalls; releaseAfter(); await background;
  assert.equal(f.clockCalls, calls, 'inherited post-response work does not start response timers');
  assert.deepEqual(f.logs.map(log => log.spans.map(span => span.name)), [['routing.provider'], ['db.first']]);
});
test('logging failure preserves the original booking response', async () => {
  const f = serverFixture(); f.failLogs();
  const handler = f.api.withBookingTelemetry('confirm', async () => new Response('confirmed'));
  assert.equal(await (await handler(new NextRequest('https://fixture.invalid/api/bookings', { method: 'POST' }))).text(), 'confirmed');
});
test('client measurement is nonblocking, reports once, and correlates with Server-Timing', async () => {
  let now = 0; const frames = [], calls = [];
  const { startBookingTiming } = load('src/lib/booking-client-timing.ts', {}, {
    performance: { now: () => now }, crypto: { randomUUID: () => uuid }, requestAnimationFrame: cb => frames.push(cb),
    fetch: (url, options) => { calls.push({ url, options }); return Promise.reject(Error('Offline telemetry')); },
  });
  const timer = startBookingTiming('confirm'); now = 5100;
  timer.response(new Response('{}', { headers: { 'X-Request-ID': uuid, 'Server-Timing': 'app;dur=4000' } }));
  timer.finish('confirmed'); timer.finish('failed');
  assert.equal(calls.length, 0); frames.shift()(); frames.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/telemetry/booking');
  const event = JSON.parse(calls[0].options.body); assert.equal(event.requestId, uuid); assert.equal(event.backendMs, 4000); assert.equal(event.durationMs, 5100);
});
function endpointFixture(session = { uid: 'customer', role: 'CUSTOMER' }) {
  const logs = [], limits = [];
  const api = load('src/app/api/telemetry/booking/route.ts', {
    'next/server': { NextResponse }, '@/lib/session': { getSession: async () => session },
    '@/lib/request-guard': { limitRequests: async (...args) => limits.push(args), RateLimitError: class extends Error {} },
    '@/lib/booking-telemetry': { validTimingId: value => value === uuid },
  }, { console: { info: line => logs.push(JSON.parse(line)) } });
  return { logs, limits, post: (body, headers = {}) => api.POST(new NextRequest('https://fixture.invalid/api/telemetry/booking', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })) };
}
const event = { action: 'confirm', eventId: uuid, requestId: uuid, outcome: 'confirmed', durationMs: 5000, beforePaintMs: 4900, backendMs: 4000 };
test('authenticated timing ingestion logs only approved anonymous fields and marks the threshold', async () => {
  const f = endpointFixture(); assert.equal((await f.post({ ...event, address: 'Private address', email: 'private@example.invalid' })).status, 204);
  assert.equal(f.logs[0].slow, true); assert(!JSON.stringify(f.logs).includes('Private')); assert(!JSON.stringify(f.logs).includes('@'));
  assert.equal(f.limits[0][1], 'customer'); assert.equal(f.logs[0].source, 'client_reported');
});
test('telemetry rejects cross-origin, unauthenticated, oversized and malformed reports', async () => {
  assert.equal((await endpointFixture(null).post(event)).status, 401);
  assert.equal((await endpointFixture().post(event, { origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await endpointFixture().post({ ...event, extra: 'x'.repeat(3000) })).status, 413);
  for (const invalid of [{ ...event, durationMs: -1 }, { ...event, eventId: 'bad' }, { ...event, action: 'secret' }]) assert.equal((await endpointFixture().post(invalid)).status, 400);
});
