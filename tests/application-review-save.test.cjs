const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const root = path.resolve(__dirname, '..');

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {}; cache.set(filename, exports);
    const localRequire = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith('.css')) return {};
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
      return require(name);
    };
    new Function('exports', 'require', ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText)(exports, localRequire);
    return exports;
  }
  return load;
}

function fixture(overrides = {}) {
  const app = { id: 'application', userId: 'rider', version: 3, status: 'SUBMITTED', vehicleClass: 'MOTORCYCLE', services: ['DELIVERY'], fields: {}, fieldReviews: {},
    assignedToId: 'reviewer', documents: [{ id: 'document', kind: 'LICENSE', current: true, status: 'PENDING', pathname: 'private/file' }], events: [], emails: [], user: { id: 'rider', name: 'Rider', email: 'rider@example.invalid', isBanned: false }, ...overrides };
  let snapshots = 0, writes = 0, mails = 0;
  const copy = () => structuredClone(app);
  const db = {
    $queryRaw: async () => [],
    user: { findUnique: async () => ({ ...app.user, role: 'RIDER' }) },
    riderApplication: {
      upsert: async () => copy(),
      findUnique: async () => { snapshots++; return copy(); },
      findUniqueOrThrow: async () => { snapshots++; return copy(); },
      update: async ({ data, include }) => { assert.equal(include, undefined); writes++; for (const [key, value] of Object.entries(data)) app[key] = key === 'version' ? app.version + value.increment : value; return copy(); },
    },
    riderApplicationDocument: { update: async ({ where, data }) => { writes++; Object.assign(app.documents.find(d => d.id === where.id), data); } },
    riderApplicationEvent: { create: async ({ data }) => { writes++; const event = { id: 'saved-event', ...data }; app.events.unshift(event); return event; } },
    adminAudit: { create: async () => { writes++; } },
    riderServiceApproval: { findMany: async () => [] },
  };
  db.$transaction = callback => callback(db);
  const load = loader({ './db': { db }, './request-guard': { RateLimitError: class extends Error {} },
    './application-storage': {}, './application-mail': { sendApplicationEmail: async () => { mails++; }, orientationLetter() {}, applicationMessage() {} } });
  const actor = { id: 'reviewer', role: 'SAFETY', name: 'Reviewer' };
  const api = load('src/lib/application-staff-api.ts').staffApplicationRequest;
  const call = (body = {}, person = actor) => api(new NextRequest('https://admin.example.invalid/api/rider-applications/application', {
    method: 'POST', headers: { origin: 'https://admin.example.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'review', section: 'identity', status: 'ACCEPTED', version: 3, ...body }),
  }), person, app.id);
  return { app, call, remove: documentId => load('src/lib/rider-application.ts').removeApplicationDocument('rider', app.version, documentId), counts: () => ({ snapshots, writes, mails }) };
}

test('save returns the committed decision, incremented version and its audit event using only two detail snapshots', async () => {
  const f = fixture();
  const section = Object.keys(loader()('src/lib/rider-application-policy.ts').SECTION_FIELDS)[0];
  const response = await f.call({ section });
  assert.equal(response.status, 200);
  const { application } = await response.json();
  assert.equal(application.version, 4); assert.equal(application.fieldReviews[section].status, 'ACCEPTED');
  assert.equal(application.events[0].action, 'REVIEW'); assert.equal(application.documents[0].pathname, undefined);
  assert.deepEqual(f.counts(), { snapshots: 2, writes: 3, mails: 0 });
});

test('document decisions return their new status immediately without sending an email', async () => {
  const f = fixture(), response = await f.call({ documentId: 'document', status: 'NEEDS_CORRECTION', reason: 'Please replace the blurred photo.' });
  assert.equal(response.status, 200);
  const { application } = await response.json();
  assert.equal(application.documents[0].status, 'NEEDS_CORRECTION');
  assert.equal(application.events[0].details.documentId, 'document');
  assert.deepEqual(f.counts(), { snapshots: 2, writes: 4, mails: 0 });
});

test('stale versions, another reviewer, banned applicants and expired documents still block writes', async () => {
  for (const [overrides, body, actor, status] of [
    [{}, { version: 2 }, undefined, 409],
    [{ assignedToId: 'someone-else' }, {}, undefined, 403],
    [{ user: { isBanned: true } }, {}, undefined, 403],
    [{ documents: [{ id: 'document', current: true, kind: 'LICENSE', expiresAt: new Date(0) }] }, { documentId: 'document' }, undefined, 400],
    [{}, {}, { id: 'support', name: 'Support', role: 'SUPPORT' }, 403],
  ]) {
    const f = fixture(overrides), response = await f.call(body, actor);
    assert.equal(response.status, status); assert.equal(f.counts().writes, 0);
  }
});

test('undoing a replacement restores only feedback from the current submission, never an older real or demo application cycle', async () => {
  for (const currentCycle of [true, false]) {
    const submittedAt = new Date('2026-10-28T00:00:00Z');
    const f = fixture({ status: 'NEEDS_CORRECTION', submittedAt, documents: [
      { id: 'replacement', kind: 'OR', version: 2, current: true, status: 'PENDING' },
      { id: 'flagged', kind: 'OR', version: 1, current: false, status: 'NEEDS_CORRECTION', reason: 'Upload the clear receipt.', reviewedAt: new Date(currentCycle ? '2026-10-28T01:00:00Z' : '2026-10-27T00:00:00Z') },
    ] });
    const saved = await f.remove('replacement');
    assert.equal(saved.version, 4);
    assert.equal(saved.documents.find(d => d.id === 'replacement').current, false);
    assert.equal(saved.documents.find(d => d.id === 'flagged').current, currentCycle);
    assert.equal(saved.documents.find(d => d.id === 'flagged').reason, 'Upload the clear receipt.');
    assert.equal(saved.events[0].action, 'DOCUMENT_REMOVED');
    assert.equal(f.counts().mails, 0);
  }
});

