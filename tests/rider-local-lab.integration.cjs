// Read-only assertions after the documented browser correction round trip.
// Usage: RUN_LOCAL_RIDER_LAB=1 node tests/rider-local-lab.integration.cjs <applicationId>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { PDFDocument } = require('pdf-lib');
async function main() {
  if (process.env.RUN_LOCAL_RIDER_LAB !== '1') { console.log('Skipped: explicitly enable the local lab integration check.'); return; }
  const root = path.resolve(__dirname, '..');
  const state = JSON.parse(fs.readFileSync(path.join(root, 'local-rider-lab/state.json')));
  assert.match(state.schema, /^fetch_rider_lab_[a-f0-9]{32}$/);
  assert.equal(state.riderUrl, 'http://localhost:3011');
  process.loadEnvFile(path.join(root, '.env'));
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', state.schema);
  url.searchParams.set('options', `-c search_path=${state.schema},pg_catalog`);
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    assert.equal((await db.$queryRawUnsafe('SELECT current_schema() AS schema'))[0].schema, state.schema);
    const app = await db.riderApplication.findUniqueOrThrow({ where: { id: process.argv[2] }, include: { user: true, documents: true, emails: true, events: true } });
    assert(app.user.email.endsWith('@rider-demo.example.invalid'));
    assert.equal(app.status, 'SUBMITTED');
    const current = app.documents.filter(d => d.current), or = current.find(d => d.kind === 'OR');
    assert.equal(current.length, 10); assert.equal(app.documents.length, 11);
    assert.equal(or.version, 2); assert.equal(or.status, 'PENDING');
    assert(current.filter(d => d.kind !== 'OR').every(d => d.version === 1));
    assert.equal(current.find(d => d.kind === 'NBI').status, 'ACCEPTED');
    assert.equal(app.documents.find(d => !d.current && d.kind === 'OR').status, 'NEEDS_CORRECTION');
    assert(app.emails.some(e => e.kind === 'CORRECTIONS' && e.status === 'SENT'));
    const origin = 'http://localhost:3022';
    const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'reviewer@fetch-demo.example.invalid', password: 'LocalDemo-Only-2026!' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const endpoint = `${origin}/api/rider-applications/${app.id}?document=${or.id}`;
    const privateFile = await fetch(endpoint, { headers: { Cookie: cookie } });
    assert.equal(privateFile.status, 200); assert.match(privateFile.headers.get('content-type'), /application\/pdf/);
    const pdf = await PDFDocument.load(await privateFile.arrayBuffer());
    assert.equal(pdf.getPageCount(), 1); assert.match(pdf.getTitle(), /^DEMO \/ NOT VALID/);
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch('http://localhost:3011/api/local-demo', { method: 'POST', headers: { Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: '{"action":"account"}' })).status, 404);
    const riderLogin = await fetch(state.riderUrl + '/api/auth/login', { method: 'POST', headers: { Origin: state.riderUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: app.user.email, password: 'LocalDemo-Only-2026!' }) });
    assert.equal(riderLogin.status, 200);
    const riderCookie = riderLogin.headers.get('set-cookie').split(';')[0];
    const rider = await fetch(state.riderUrl + '/api/rider/application', { headers: { Cookie: riderCookie } });
    assert.equal(rider.status, 200); assert.equal((await rider.json()).application.status, 'SUBMITTED');
    const inbox = await fetch(state.riderUrl + '/api/local-demo?inbox=1', { headers: { Cookie: riderCookie } });
    const mail = (await inbox.json()).messages.find(m => m.subject.includes('corrections'));
    assert(mail.text.includes(app.user.name) && mail.text.includes('blurred official receipt'));
    console.log('PASS: isolated schema; submitted/resubmitted application; OR v2 only; accepted NBI retained; old OR history; captured correction email; authenticated private PDF; anonymous read blocked; cross-origin demo blocked; matching Rider status.');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
