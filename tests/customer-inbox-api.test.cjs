/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness() {
  const calls = [], exports = {};
  class CustomerError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const dependencies = {
    'next/server': { NextResponse: Response }, '@/lib/db': { db: {} },
    '@/lib/customer-access': { requireCustomer: async () => ({ uid: 'signed-in-owner' }), CustomerError, customerErrorResponse: error => Response.json({ error: error.message }, { status: error.status }) },
    '@/lib/push-delivery': {}, '@/lib/customer-inbox-actions': { updateCustomerInbox: async (_db, owner, selection) => { calls.push({ owner, selection }); } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/notifications/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, console, require: name => dependencies[name] });
  return { calls, patch: body => exports.PATCH(new Request('https://fixture.invalid/api/notifications', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })) };
}
test('notification changes use the signed-in owner and retain an explicit snapshot cutoff', async () => {
  const h = harness(), before = '2026-01-01T12:00:00.000Z';
  assert.equal((await h.patch({ action: 'dismiss', ids: ['notice'], customerId: 'forged-owner', before })).status, 200);
  assert.equal(h.calls[0].owner, 'signed-in-owner');
  assert.equal(h.calls[0].selection.dismiss, true);
  assert.equal(h.calls[0].selection.before.toISOString(), before);
});
test('read and legacy-support actions remain supported while invalid and bulk-dismiss selectors are rejected', async () => {
  const h = harness();
  for (const body of [{ category: 'RIDE' }, { action: 'read', supportIds: ['message'] }]) assert.equal((await h.patch(body)).status, 200);
  for (const body of [null, [], {}, { action: 'delete', ids: ['n'] }, { action: 'dismiss', category: 'RIDE' }, { ids: [''] }, { ids: Array(101).fill('n') }, { supportIds: [123] }, { category: 'OTHER' }, { ids: ['n'], before: 'not-a-date' }]) {
    assert.equal((await h.patch(body)).status, 400);
  }
  assert.equal(h.calls.length, 2);
});
