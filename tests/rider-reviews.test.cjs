const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { NextResponse } = require('next/server');
function load(file, deps = {}, globals = {}) { deps = { '@/lib/booking-telemetry': { withBookingTelemetry: (_, fn) => fn }, '@/lib/request-guard': { withRequestLog: (_, fn) => fn }, ...deps }; const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, Date, URL, console, AbortController, queueMicrotask, require: name => { if (!(name in deps)) throw Error(name); return deps[name]; }, ...globals }); return exports; }
const helpers = load('src/lib/rider-reviews.ts');
test('review pages are bounded and expose no customer identity, booking address, or contact fields', async () => {
  let query; const rows = Array.from({ length: 11 }, (_, n) => ({ id: 'review-' + n, rating: 5, comment: n ? null : 'Helpful rider', createdAt: new Date('2026-11-02T01:00:00Z'), booking: { type: 'RIDE' }, customerId: 'PRIVATE_ID', email: 'PRIVATE_EMAIL', pickup: 'PRIVATE_ADDRESS' }));
  const data = await helpers.getRiderReviews({ customerReview: { findMany: async input => { query = input; return rows; } } }, 'rider-own', null);
  assert.equal(query.where.riderId, 'rider-own'); assert.equal(query.take, 11); assert.equal(data.reviews.length, 10); assert.equal(data.nextCursor, 'review-9'); assert.equal(data.reviews[0].service, 'RIDE'); assert(!JSON.stringify(data).includes('PRIVATE'));
});
test('a cursor from another rider is rejected; equal timestamps paginate by ID', async () => {
  let query; const db = { customerReview: { findFirst: async ({ where }) => where.id === 'own' && where.riderId === 'r' ? { id: 'own', createdAt: new Date('2026-11-02') } : null, findMany: async input => { query = input; return []; } } };
  await assert.rejects(helpers.getRiderReviews(db, 'r', 'someone-else'), helpers.ReviewPageError);
  await assert.rejects(helpers.getRiderReviews(db, 'r', 'invalid cursor'), helpers.ReviewPageError);
  const result = await helpers.getRiderReviews(db, 'r', 'own'); assert.equal(query.where.OR[1].id.lt, 'own'); assert.equal(result.nextCursor, null);
});
test('Customer can view only the assigned rider on their own booking; query-string rider ID is ignored', async () => {
  let owned = true, reads = 0; class CustomerError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const api = load('src/app/api/bookings/[id]/rider/reviews/route.ts', { 'next/server': { NextResponse }, '@/lib/db': { db: { booking: { findFirst: async ({ where }) => { assert.equal(where.customerId, 'customer-own'); return owned ? { riderId: 'assigned' } : null; } } } }, '@/lib/customer-access': { requireCustomer: async () => ({ uid: 'customer-own' }), CustomerError, customerErrorResponse: e => NextResponse.json({ error: e.message }, { status: e.status || 503 }) }, '@/lib/rider-reviews': { ...helpers, getRiderReviews: async (_, id) => { reads++; assert.equal(id, 'assigned'); return { reviews: [], nextCursor: null }; } } });
  const run = () => api.GET(new Request('https://test.invalid/api/bookings/booking/rider/reviews?riderId=other'), { params: Promise.resolve({ id: 'booking' }) });
  assert.equal((await run()).status, 200); owned = false; assert.equal((await run()).status, 404); assert.equal(reads, 1);
});
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
test('the profile rating toggles an accessible review panel, including for a new rider', () => {
  const slots = []; let index = 0; const hooks = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], fn => { slots[i] = typeof fn === 'function' ? fn(slots[i]) : fn; }]; }, useId: () => 'reviews-own', useEffect() {} };
  const jsx = (type, props) => ({ type, props });
  const api = load('src/components/fetchit/shared/rider-profile.tsx', { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, './rider-reviews': { RiderReviews: 'Reviews' }, '@/hooks/use-customer-overlay-history': { useCustomerOverlayHistory() {} }, '@/components/ui/button': { Button: 'Button' }, '@/components/ui/dialog': {}, '@/lib/constants': { VEHICLES: {} } });
  const render = () => { index = 0; return api.RiderProfileDetails({ profile: { name: 'Test Rider', memberSince: '2026-11-01', rating: null, ratingCount: 0, completedBookings: 0, services: [] }, reviewsEndpoint: '/own/reviews' }); };
  let tree = render(), button = nodes(tree).find(n => n.type === 'button'); assert.equal(button.props.disabled, false); assert.equal(button.props['aria-expanded'], false); assert(!nodes(tree).some(n => n.type === 'Reviews'));
  button.props.onClick(); tree = render(); assert.equal(nodes(tree).find(n => n.type === 'button').props['aria-expanded'], true); assert.equal(nodes(tree).find(n => n.type === 'Reviews').props.endpoint, '/own/reviews');
});

function reviewList(fetcher) {
  const slots = [], effects = [], cleanups = []; let index = 0;
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const hooks = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = index++; if (!same(slots[i]?.deps,deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = index++; if (!same(slots[i],deps)) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const api = load('src/components/fetchit/shared/rider-reviews.tsx', { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@/components/ui/button': { Button: 'button' } }, { fetch: fetcher });
  const render = () => { index = 0; const tree = api.RiderReviews({ endpoint: '/own/reviews' }); while(effects.length) effects.shift()(); return tree; };
  return { render, async flush() { await new Promise(resolve => setImmediate(resolve)); return render(); } };
}
const content = n => typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(content).join(' ') : n && typeof n === 'object' ? content(n.props?.children) : '';
test('reviews show an empty state; an initial network error has a working retry', async () => {
  const empty = reviewList(async () => Response.json({ reviews: [], nextCursor: null })); empty.render(); assert.match(content(await empty.flush()), /No customer reviews yet/);
  let calls = 0; const retry = reviewList(async () => { if (++calls === 1) throw Error('Offline'); return Response.json({ reviews: [{ id: 'r', rating: 4, comment: 'Careful driver', createdAt: '2026-11-02T00:00:00Z', service: 'RIDE' }], nextCursor: null }); });
  retry.render(); let tree = await retry.flush(); assert.match(content(tree), /Reviews could not load/); nodes(tree).find(n => n.type === 'button').props.onClick(); retry.render(); tree = await retry.flush(); assert.match(content(tree), /Careful driver/); assert.match(content(tree), /Passenger ride/); assert.equal(calls, 2);
});
