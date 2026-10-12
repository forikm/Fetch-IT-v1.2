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

test("the rider Active screen polls jobs, refreshes open details and removes reassigned jobs", async () => {
  const states = [null, "active", [ride], false, ride];
  let index = 0, poll, pollKey, payload = [{ ...ride, status: "PICKED_UP" }];
  const react = {
    useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }]; },
    useCallback: fn => fn, useEffect() {}, useRef: value => ({ current: value }),
  };
  const { RiderDashboard } = load("../../fetch-rider/src/components/fetchit/rider/rider-dashboard.tsx", {
    react,
    "@/lib/store": { useAppStore: selector => selector({ user: { id: "rider-1", isOnline: true } }) },
    "@/hooks/use-toast": { useToast: () => ({ toast() {} }) },
    "@/hooks/use-visible-poll": { useVisiblePoll(key, callback) { pollKey = key; poll = callback; } },
    "@/lib/constants": { ...constants, BOOKING_STATUS_FLOW: ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"] },
    globals: { fetch: async path => ({ ok: true, json: async () => path.includes("stats") ? {} : { bookings: payload } }) },
  });
  function render() { index = 0; return nodes(RiderDashboard()); }
  render(); assert.equal(pollKey, "rider-1:active");
  await poll(new AbortController().signal);
  assert.equal(states[4].status, "PICKED_UP");
  assert.equal(render().find(node => typeof node.type === "function" && node.type.name === "ActiveJobFlow").props.job.status, "PICKED_UP");
  payload = []; await poll(new AbortController().signal);
  assert.equal(states[2].length, 0); assert.equal(states[4], null);
  assert(!render().some(node => typeof node.type === "function" && node.type.name === "ActiveJobFlow"));
});

test("an aborted rider job response cannot repopulate a screen after leaving it", async () => {
  const states = [null, "active", [], false, null];
  let index = 0, poll;
  const { RiderDashboard } = load("../../fetch-rider/src/components/fetchit/rider/rider-dashboard.tsx", {
    react: { useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }]; }, useCallback: fn => fn, useEffect() {}, useRef: value => ({ current: value }) },
    "@/lib/store": { useAppStore: selector => selector({ user: { id: "rider-1" } }) },
    "@/hooks/use-toast": { useToast: () => ({ toast() {} }) },
    "@/hooks/use-visible-poll": { useVisiblePoll(_, callback) { poll = callback; } },
    globals: { fetch: async () => ({ ok: true, json: async () => ({ bookings: [ride] }) }) },
  });
  RiderDashboard(); const controller = new AbortController(); controller.abort();
  await poll(controller.signal);
  assert.equal(states[2].length, 0);
});
