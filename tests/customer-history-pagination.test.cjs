/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness() {
  const queries = [];
  const records = Array.from({ length: 21 }, (_, i) => ({ id: 'booking-' + i, refCode: 'FIT-' + i, customerId: 'owner' }));
  const exports = {};
  const dependencies = {
    '@/lib/matching-policy': {}, '@/lib/request-guard': { withRequestLog: (_, handler) => handler },
    '@/lib/db-data': { bookingView: b => b }, 'next/server': { NextResponse: Response },
    '@/lib/customer-access': { requireCustomer: async () => ({ uid: 'owner' }), customerErrorResponse: e => { throw e; } },
    '@/lib/dispatch': { expireRiderOffers: async () => {} }, '@/lib/db': { db: { booking: {
      findMany: async query => { queries.push(query); const start = query.cursor ? records.findIndex(row => row.id === query.cursor.id) + query.skip : 0; return records.slice(start, start + query.take); },
    } } }, '@/lib/ticket': { omitTicket: b => b },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/bookings/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Response, URL, console, require: name => dependencies[name] ?? {} });
  return { queries, get: async query => (await exports.GET(new Request('https://fixture.invalid/api/bookings?' + query))).json() };
}
test('history loads 10 at a time and exposes all 21 bookings through read-only cursors', async () => {
  const h = harness(), seen = [];
  let cursor;
  do {
    const result = await h.get('filter=history&type=DELIVERY' + (cursor ? '&cursor=' + cursor : ''));
    assert(result.bookings.length <= 10);
    seen.push(...result.bookings.map(row => row.id)); cursor = result.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 21);
  assert.deepEqual(h.queries.map(q => q.take), [11, 11, 11]);
  assert(h.queries.every(q => q.where.customerId === 'owner' && q.where.type === 'DELIVERY'));
});
test('history search, status and dates remain scoped; active bookings retain their existing page size', async () => {
  const h = harness();
  await h.get('filter=history&type=RIDE&q=Dagupan&status=DELIVERED&from=2026-01-01&to=2026-12-31');
  const where = h.queries[0].where;
  assert.equal(where.customerId, 'owner'); assert.equal(where.type, 'RIDE'); assert.equal(where.status, 'DELIVERED');
  assert.equal(where.OR[0].refCode.contains, 'Dagupan'); assert(where.createdAt.gte && where.createdAt.lte);
  await h.get('filter=active&type=RIDE'); assert.equal(h.queries[1].take, 101);
});
