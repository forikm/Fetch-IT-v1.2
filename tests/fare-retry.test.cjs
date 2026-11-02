const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const source = ts.createSourceFile('dashboard.tsx', fs.readFileSync('src/components/fetchit/customer/customer-dashboard.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'fetchEstimate') handler = node.getText(source); ts.forEachChild(node, visit); }
visit(source);
class CustomerRequestError extends Error { constructor(message, retryAfterSeconds) { super(message); this.retryAfterSeconds = retryAfterSeconds; } }
function fixture(fetch, customerResponse = async res => res.json()) {
  const app = { online: true, offlineAccess: false, canEstimate: () => true, fareRequest: { current: null }, fareRetryAt: { current: 0 }, fareSequence: { current: 0 },
    startBookingTiming: () => ({ headers: {}, response() {}, finish() {} }), AbortController, setTimeout, clearTimeout, Date, Error, CustomerRequestError,
    bookingType: 'RIDE', paymentMethod: 'CASH', isRide: true, passengers: '2', pickupLat: '16', pickupLng: '120', pickupLabel: 'A', dropoffLat: '16.01', dropoffLng: '120.01', dropoffLabel: 'B', vehicleClass: 'TRICYCLE', cargoWeightKg: '1', scheduledAt: '', pickupScheduleIso: () => undefined, fareKey: 'route', fetch, customerResponse,
    setEstimating(value) { app.estimating = value; }, setEstimate(value) { app.estimate = value; }, setEstimateError(value) { app.error = value; }, setEstimatedKey(value) { app.key = value; }, setFareRetrySeconds(value) { app.seconds = value; } };
  vm.runInNewContext(ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, app);
  return app;
}
test('rapid fare retries share one in-flight request', async () => {
  let resolve, calls = 0;
  const app = fixture(() => { calls++; return new Promise(done => { resolve = done; }); });
  const first = app.fetchEstimate(); await app.fetchEstimate(); assert.equal(calls, 1);
  resolve(Response.json({ fare: { totalFare: 50 } })); await first;
  assert.equal(app.estimate.fare.totalFare, 50); assert.equal(app.estimating, false); assert.equal(app.fareRequest.current, null);
});
test('cooldown blocks provider retries until the deadline then permits recovery', async () => {
  let calls = 0;
  const app = fixture(async () => { calls++; return Response.json({}); }, async () => { throw new CustomerRequestError('Wait for directions', 60); });
  await app.fetchEstimate(); assert.equal(app.seconds, 60); assert.equal(app.error, 'Wait for directions');
  await app.fetchEstimate(); assert.equal(calls, 1);
  app.fareRetryAt.current = Date.now() - 1; app.customerResponse = async () => ({ fare: { totalFare: 50 } });
  await app.fetchEstimate(); assert.equal(calls, 2); assert.equal(app.estimate.fare.totalFare, 50);
});
test('superseded fare responses cannot replace the current route', async () => {
  let resolve;
  const app = fixture(() => new Promise(done => { resolve = done; }));
  const old = app.fetchEstimate(); app.fareSequence.current++;
  resolve(Response.json({ fare: { totalFare: 999 } })); await old; assert.equal(app.estimate, null);
});
