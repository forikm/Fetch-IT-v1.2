const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function load(file, deps = {}) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Math, require: name => { if (!(name in deps)) throw Error(name); return deps[name]; } }); return exports; }
const eta = load('src/lib/eta-policy.ts');
test('4.39 km free-flow six-minute route becomes a local planning estimate, per vehicle', () => {
  const car = eta.planningTravelSeconds(4390, 360, 'SEDAN');
  assert.equal(Math.ceil(car / 60), 15); assert.equal(eta.travelTimeRange(car), '15–19');
  assert.equal(Math.ceil(eta.planningTravelSeconds(4390, 360, 'TRICYCLE') / 60), 16);
  assert.equal(Math.ceil(eta.planningTravelSeconds(4390, 360, 'MOTORCYCLE') / 60), 13);
});
test('a slower provider route is never reduced; provider data and cache objects are unchanged', () => {
  const route = Object.freeze({ distanceMeters: 4390, durationSeconds: 1800 });
  assert.equal(eta.planningTravelSeconds(route.distanceMeters, route.durationSeconds, 'SEDAN'), 1860);
  assert.equal(route.durationSeconds, 1800);
  assert.equal(eta.planningTravelSeconds(4390, 360, 'SEDAN', 10), 1641);
});
test('rounding, short trips and invalid input do not produce zero or negative displayed times', () => {
  assert.equal(eta.travelTimeRange(0), '1–3'); assert.equal(eta.travelTimeRange(61), '2–4');
  assert(eta.planningTravelSeconds(100, 0, 'SEDAN') >= 60);
  for (const bad of [-1, NaN, Infinity]) { assert.throws(() => eta.planningTravelSeconds(bad, 1, 'SEDAN')); assert.throws(() => eta.travelTimeRange(bad)); }
});
test('Customer road quotes change travel time without changing distance or fare components', () => {
  const constants = load('src/lib/constants.ts');
  const fare = load('src/lib/fare.ts', { './eta-policy': eta, '@/lib/constants': constants, './constants': constants, './platform-policy': { configuredSurge: () => 1 } });
  const input = { pickup: { lat: 16.02, lng: 120.23 }, dropoff: { lat: 16.04, lng: 120.27 }, vehicleClass: 'SEDAN', when: new Date('2026-11-02T02:00:00Z'), route: { distanceKm: 4.39, durationSeconds: 360 } };
  const fast = fare.quoteRideFare(input), slow = fare.quoteRideFare({ ...input, route: { ...input.route, durationSeconds: 1800 } });
  assert.equal(fast.etaMinutes, 15); assert.equal(slow.etaMinutes, 31); assert.equal(fast.distanceKm, 4.39);
  assert.equal(JSON.stringify(fast.fare), JSON.stringify(slow.fare));
  const delivery = fare.quoteFare({ ...input, cargoWeightKg: 10 });
  assert.equal(delivery.etaMinutes, 25, 'delivery handling time is added exactly once');
});
