/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function endpoint(env, fail = false) {
  const exports = {};
  let sweeps = 0;
  const dependencies = {
    'next/server': { NextResponse: Response },
    'node:crypto': crypto,
    '@/lib/db': { db: {} },
    '@/lib/staff-notifications': {
      refreshOperationalSignals: async () => {
        sweeps++;
        if (fail) throw Error('private database detail');
      },
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/maintenance/notifications/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Buffer, process: { env }, require: name => dependencies[name] });
  return {
    get: authorization => exports.GET(new Request('https://fixture.invalid/api/maintenance/notifications', {
      headers: authorization ? { authorization } : {},
    })),
    sweeps: () => sweeps,
  };
}

test('dedicated monitor credential authorizes one sweep and bypasses response caches', async () => {
  const h = endpoint({ NOTIFICATION_MONITOR_SECRET: 'monitor-fixture', CRON_SECRET: 'receipt-fixture' });
  const response = await h.get('Bearer monitor-fixture');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.equal(h.sweeps(), 1);
});

test('missing, invalid, and receipts credentials cannot run the dedicated monitor', async () => {
  const h = endpoint({ NOTIFICATION_MONITOR_SECRET: 'monitor-fixture', CRON_SECRET: 'receipt-fixture' });
  for (const authorization of [undefined, 'Bearer wrong', 'Bearer monitor-fixturE', 'Bearer receipt-fixture']) {
    const response = await h.get(authorization);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(h.sweeps(), 0);
});

test('legacy installations can still use CRON_SECRET without a dedicated secret', async () => {
  const h = endpoint({ CRON_SECRET: 'legacy-fixture' });
  assert.equal((await h.get('Bearer legacy-fixture')).status, 200);
  assert.equal(h.sweeps(), 1);
});

test('unconfigured endpoint fails closed', async () => {
  const h = endpoint({});
  assert.equal((await h.get('Bearer undefined')).status, 401);
  assert.equal(h.sweeps(), 0);
});

test('database failures return a private generic error and no success', async () => {
  const h = endpoint({ NOTIFICATION_MONITOR_SECRET: 'monitor-fixture' }, true);
  const response = await h.get('Bearer monitor-fixture');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { error: 'Notification monitoring is unavailable.' });
});

async function runMonitor(fetch, env = {}) {
  const calls = [], logs = [], errors = [];
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const process = { env: { CUSTOMER_URL: 'https://fixture.invalid', NOTIFICATION_MONITOR_SECRET: 'monitor-fixture', ...env }, argv: [] };
  vm.runInNewContext(fs.readFileSync('scripts/monitor-notifications.cjs', 'utf8'), {
    process, URL, AbortSignal,
    fetch: async (...args) => { calls.push(args); return fetch(...args); },
    console: {
      log: value => { logs.push(value); complete(); },
      error: value => { errors.push(value); complete(); },
    },
  });
  await done;
  await new Promise(resolve => setImmediate(resolve));
  return { calls, logs, errors, exitCode: process.exitCode };
}

test('runner sends the dedicated credential once and accepts a confirmed JSON sweep', async () => {
  const h = await runMonitor(() => Response.json({ ok: true, checkedAt: '2026-11-02T12:00:00.000Z' }));
  assert.equal(h.exitCode, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'https://fixture.invalid/api/maintenance/notifications');
  assert.equal(h.calls[0][1].headers.authorization, 'Bearer monitor-fixture');
  assert.equal(h.calls[0][1].redirect, 'error');
  assert.equal(JSON.parse(h.logs[0]).status, 'ok');
  assert.equal(h.errors.length, 0);
});

test('runner retains legacy scheduler compatibility', async () => {
  const h = await runMonitor(() => Response.json({ ok: true, checkedAt: '2026-11-02T12:00:00.000Z' }), {
    NOTIFICATION_MONITOR_SECRET: '', CRON_SECRET: 'legacy-fixture',
  });
  assert.equal(h.exitCode, 0);
  assert.equal(h.calls[0][1].headers.authorization, 'Bearer legacy-fixture');
});

test('runner fails for unauthorized/unavailable endpoints without logging response bodies', async () => {
  for (const status of [401, 503]) {
    const h = await runMonitor(() => new Response('private-response-body', { status }));
    assert.equal(h.exitCode, 1);
    assert.equal(h.logs.length, 0);
    assert.equal(JSON.parse(h.errors[0]).message, 'Monitoring endpoint returned ' + status);
    assert.ok(!h.errors[0].includes('private-response-body'));
  }
});

test('runner rejects HTML protection pages and malformed success results', async () => {
  for (const response of [new Response('<html>sign in</html>'), Response.json({ ok: false }), Response.json({ ok: true, checkedAt: 'invalid' })]) {
    const h = await runMonitor(() => response);
    assert.equal(h.exitCode, 1);
    assert.equal(h.logs.length, 0);
    assert.equal(JSON.parse(h.errors[0]).message, 'Monitoring endpoint returned an invalid result.');
  }
});

test('runner reports request failure without echoing exception details or secrets', async () => {
  const h = await runMonitor(() => { throw Error('network details monitor-fixture'); });
  assert.equal(h.exitCode, 1);
  assert.equal(JSON.parse(h.errors[0]).message, 'Monitoring request failed or timed out.');
  assert.ok(!JSON.stringify(h.logs.concat(h.errors)).includes('monitor-fixture'));
});
