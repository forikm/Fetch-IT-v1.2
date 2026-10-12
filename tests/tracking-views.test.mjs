import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
function load(file, mocks) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, ...mocks.globals, require(name) {
    if (name === "react/jsx-runtime") return jsx;
    return mocks[name] ?? new Proxy({}, { get: (_, key) => key === "cn" ? (...args) => args.join(" ") : String(key) });
  } });
  return exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const constants = { VEHICLES: { MOTORCYCLE: { label: "Motor" } }, statusLabel: status => status };
const ride = { id: "ride-1", refCode: "RIDE-TEST", status: "ACCEPTED", etaMinutes: 10, riderId: "rider-1", rider: { name: "Test driver", rating: 5 },
  vehicleClass: "MOTORCYCLE", passengers: 1, totalFare: 60, pickupLat: 14.6, pickupLng: 120.9, dropoffLat: 14.7, dropoffLng: 121, trackingUpdates: [] };

test("ride tracking renders current booking GPS and clears it after reassignment", () => {
  let props = { ride: { ...ride }, onClose() {}, onUpdated(update) { props.ride = { ...props.ride, ...update }; } };
  let update;
  const { RideTrackingView } = load("../src/components/fetchit/customer/ride-tracking-view.tsx", {
    "@/lib/constants": constants,
    "@/hooks/use-tracking-updates": { useTrackingUpdates: (_, callback) => { update = callback; } },
  });
  const render = () => nodes(RideTrackingView(props));
  const map = () => render().find(node => node.type === "LiveTrackingMap");
  assert.equal(map().props.rider, null);
  update({ trackingUpdates: [{ lat: 14.65, lng: 120.95 }] });
  assert.equal(map().props.rider.lat, 14.65);
  update({ trackingUpdates: [{ lat: 14.66, lng: 120.96 }] });
  assert.equal(map().props.rider.lng, 120.96);
  update({ riderId: "rider-2", status: "MATCHED", trackingUpdates: [] });
  assert.equal(map().props.rider, null);
  assert(!render().some(node => node.type === "RidePickupOtp"));
  update({ status: "ACCEPTED" });
  assert.equal(render().find(node => node.type === "RidePickupOtp").key, "ride-1:rider-2");
  update({ status: "PICKED_UP" });
  assert(!render().some(node => node.type === "RidePickupOtp"));
});

function riderHarness({ lists = { active: [ride] }, tab = "active", selected = ride, request } = {}) {
  const states = [null, tab, lists, selected, {}], refs = [];
  let index = 0, refIndex = 0, poll, pollKey;
  const react = {
    useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }]; },
    useCallback: fn => fn, useEffect() {}, useRef: value => refs[refIndex++] ??= { current: value },
  };
  const { RiderDashboard } = load("../../fetch-rider/src/components/fetchit/rider/rider-dashboard.tsx", {
    react,
    "@/lib/store": { useAppStore: selector => selector({ user: { id: "rider-1", isOnline: true } }) },
    "@/hooks/use-toast": { useToast: () => ({ toast() {} }) },
    "@/hooks/use-visible-poll": { useVisiblePoll(key, callback) { pollKey = key; poll = callback; } },
    "@/lib/constants": { ...constants, BOOKING_STATUS_FLOW: ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"] },
    globals: { fetch: async path => path.includes("stats") ? { ok: true, json: async () => ({}) } : request ? request(path) : jobResponse([ride]) },
  });
  function render() { index = 0; refIndex = 0; return nodes(RiderDashboard()); }
  return { states, render, get key() { return pollKey; }, poll: signal => poll(signal ?? new AbortController().signal) };
}
const jobResponse = jobs => ({ ok: true, json: async () => ({ jobs, bookings: jobs }) });
const component = (tree, name) => tree.find(node => typeof node.type === "function" && node.type.name === name);
const flush = () => new Promise(resolve => setImmediate(resolve));

test("the rider Active screen polls jobs, refreshes open details and removes reassigned jobs", async () => {
  let payload = [{ ...ride, status: "PICKED_UP" }];
  const h = riderHarness({ request: async () => jobResponse(payload) });
  h.render(); assert.equal(h.key, "rider-1:active");
  await h.poll();
  assert.equal(h.states[3].status, "PICKED_UP");
  assert.equal(component(h.render(), "ActiveJobFlow").props.job.status, "PICKED_UP");
  payload = []; await h.poll();
  assert.equal(h.states[2].active.length, 0); assert.equal(h.states[3], null);
  assert(!component(h.render(), "ActiveJobFlow"));
});

test("an aborted rider job response cannot repopulate a screen after leaving it", async () => {
  const h = riderHarness({ lists: { active: [] }, selected: null });
  h.render(); const controller = new AbortController(); controller.abort();
  await h.poll(controller.signal);
  assert.equal(h.states[2].active.length, 0);
});

test("rides and deliveries keep their cards, open details and actions during a status refresh", async () => {
  for (const type of ["RIDE", "DELIVERY"]) {
    const job = { ...ride, type };
    let finish;
    const h = riderHarness({ lists: { active: [job] }, selected: job, request: () => new Promise(resolve => { finish = resolve; }) });
    const before = h.render();
    component(before, "ActiveJobFlow").props.onUpdated({ status: "PICKED_UP" });
    const during = h.render();
    assert.equal(component(during, "JobCard").key, component(before, "JobCard").key);
    assert.equal(component(during, "ActiveJobFlow").props.job.status, "PICKED_UP");
    assert(!during.some(node => node.type === "Skeleton"));
    finish(jobResponse([{ ...job, status: "PICKED_UP" }])); await flush();
    assert.equal(component(h.render(), "JobCard").props.job.status, "PICKED_UP");
  }
});

test("failed and malformed refreshes preserve the visible job and open actions", async () => {
  for (const request of [async () => { throw Error("Offline"); }, async () => ({ ok: true, json: async () => ({}) })]) {
    const h = riderHarness({ request });
    h.render(); await assert.rejects(h.poll());
    const tree = h.render();
    assert.equal(component(tree, "JobCard").props.job.id, ride.id);
    assert.equal(component(tree, "ActiveJobFlow").props.job.id, ride.id);
    assert(!tree.some(node => node.type === "Skeleton"));
    assert(tree.some(node => node.props?.role === "status"));
  }
});

test("returning to a loaded tab keeps its own cards without showing a different tab's jobs", () => {
  const available = { ...ride, id: "available-job", status: "PENDING" };
  const history = { ...ride, id: "completed-job", status: "DELIVERED" };
  const h = riderHarness({ lists: { active: [ride], available: [available], history: [history] } });
  for (const [tab, id] of [["available", available.id], ["history", history.id], ["active", ride.id]]) {
    h.states[1] = tab;
    const tree = h.render();
    assert.equal(component(tree, "JobCard").props.job.id, id);
    assert(!tree.some(node => node.type === "Skeleton"));
  }
});

test("an older poll cannot undo a newer status-action refresh", async () => {
  let oldResponse, calls = 0;
  const h = riderHarness({ request: () => ++calls === 1 ? new Promise(resolve => { oldResponse = resolve; }) : Promise.resolve(jobResponse([{ ...ride, status: "PICKED_UP" }])) });
  const tree = h.render(), older = h.poll();
  component(tree, "ActiveJobFlow").props.onUpdated({ status: "PICKED_UP" });
  await flush();
  oldResponse(jobResponse([ride])); await older;
  assert.equal(component(h.render(), "JobCard").props.job.status, "PICKED_UP");
  assert.equal(h.states[3].status, "PICKED_UP");
});
