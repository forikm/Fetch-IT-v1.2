import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as bookingUi from "../src/lib/customer-booking-ui.ts";

const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
function load(file, mocks) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, ...mocks.globals, require(name) {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/customer-booking-ui") return bookingUi;
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
  type: "RIDE", vehicleClass: "MOTORCYCLE", passengers: 1, totalFare: 60, pickupLat: 14.6, pickupLng: 120.9, dropoffLat: 14.7, dropoffLng: 121, trackingUpdates: [] };

test("ride tracking renders current booking GPS and clears it after reassignment", () => {
  let props = { ride: { ...ride }, onClose() {}, onUpdated(update) { props.ride = { ...props.ride, ...update }; } };
  let update;
  const { RideTrackingView } = load("../src/components/fetchit/customer/ride-tracking-view.tsx", {
    "@/lib/constants": constants,
    "@/hooks/use-ride-location": { useRideLocation: () => ({ location: null, message: "" }) },
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

test("accepted ride cards open details by card or keyboard button without intercepting other actions", () => {
  let opened = 0;
  const { CustomerBookingCard } = load("../src/components/fetchit/customer/customer-booking-card.tsx", { "@/lib/constants": constants });
  const props = { booking: ride, readOnly: false, onTrack: () => opened++, onRefresh() {}, onRepeat() {} };
  const tree = CustomerBookingCard(props);
  tree.props.onClick({ target: { closest: () => null } });
  assert.equal(opened, 1);
  for (const element of ["button", "a", "[role='dialog']"]) {
    tree.props.onClick({ target: { closest: selector => { assert(selector.includes(element)); return {}; } } });
  }
  assert.equal(opened, 1);
  const button = nodes(tree).find(node => node.type === "button" && node.props["aria-label"]?.includes("profile and map"));
  button.props.onClick();
  assert.equal(opened, 2);
  for (const status of ["PENDING", "MATCHED", "CANCELLED", "DELIVERED"]) {
    assert.equal(CustomerBookingCard({ ...props, booking: { ...ride, status } }).props.onClick, undefined);
  }
  assert.equal(CustomerBookingCard({ ...props, booking: { ...ride, type: "DELIVERY" } }).props.onClick, undefined);
});

test("ride details show the rider profile, local position, and an emergency dialer link", () => {
  const local = { lat: 14.61, lng: 120.91 };
  let trackingEnabled;
  const { RideTrackingView } = load("../src/components/fetchit/customer/ride-tracking-view.tsx", {
    "@/lib/constants": constants,
    "@/hooks/use-tracking-updates": { useTrackingUpdates() {} },
    "@/hooks/use-ride-location": { useRideLocation(enabled) { trackingEnabled = enabled; return { location: enabled ? local : null, message: "Location enabled" }; } },
  });
  const booking = { ...ride, rider: { ...ride.rider, phone: "+639171234567", vehiclePlate: "ABC 123", totalDeliveries: 24 } };
  const render = status => nodes(RideTrackingView({ ride: { ...booking, status }, onClose() {}, onUpdated() {} }));
  const tree = render("ACCEPTED");
  assert.equal(trackingEnabled, true);
  assert.equal(tree.find(node => node.type === "LiveTrackingMap").props.customer, local);
  assert.equal(tree.find(node => node.type === "a" && node.props.children?.includes("Dial 911")).props.href, "tel:911");
  assert(tree.some(node => node.type === "dd" && node.props.children === "ABC 123"));
  assert(tree.some(node => node.type === "dd" && node.props.children === 24));
  assert(tree.some(node => node.type === "a" && node.props.href === "tel:+639171234567"));
  assert(tree.some(node => node.type === "CancelBooking"));
  for (const status of ["PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"]) {
    const next = render(status);
    assert(!next.some(node => node.type === "CancelBooking"));
    assert.equal(trackingEnabled, ["PICKED_UP", "IN_TRANSIT"].includes(status));
  }
});

test("cancellation submits Driver asked for cancellation as the saved reason", async () => {
  const states = [], pending = { current: false };
  let index = 0, submitted, cancelled = 0;
  const { CancelBooking } = load("../src/components/fetchit/shared/cancel-booking.tsx", {
    react: { useRef: () => pending, useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value; }]; } },
    "@/hooks/use-online-status": { useOnlineStatus: () => true },
    "@/lib/customer-request": { customerResponse: async response => response },
    globals: { fetch: async (url, options) => { submitted = { url, body: JSON.parse(options.body) }; return {}; } },
  });
  const render = () => { index = 0; return nodes(CancelBooking({ bookingId: ride.id, onCancelled: () => cancelled++ })); };
  let tree = render();
  assert(tree.some(node => node.type === "option" && node.props.children === "Driver asked for cancellation"));
  tree.find(node => node.type === "select").props.onChange({ target: { value: "Driver asked for cancellation" } });
  tree = render();
  await tree.find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(submitted.url, `/api/bookings/${ride.id}/cancel`);
  assert.equal(submitted.body.reason, "Driver asked for cancellation");
  assert.equal(cancelled, 1);
});

test("device location updates and permission failure clear the marker and stop watching on close", () => {
  const states = [], effects = [];
  let index = 0, success, failure, cleared;
  const { useRideLocation: readLocation } = load("../src/hooks/use-ride-location.ts", {
    react: {
      useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value; }]; },
      useEffect(effect) { effects.push(effect); },
    },
    globals: { navigator: { geolocation: {
      watchPosition(onSuccess, onError) { success = onSuccess; failure = onError; return 7; },
      clearWatch(id) { cleared = id; },
    } } },
  });
  const render = enabled => { index = 0; return readLocation(enabled); };
  assert.equal(render(true).location, null);
  const cleanup = effects[0]();
  success({ coords: { latitude: 14.62, longitude: 120.92 } });
  assert.equal(render(true).location.lat, 14.62);
  failure({ code: 1 });
  assert.equal(render(true).location, null);
  assert.match(render(true).message, /Location access is off/);
  cleanup();
  assert.equal(cleared, 7);
  success({ coords: { latitude: 99, longitude: 99 } });
  assert.equal(render(true).location, null);
  assert.equal(render(false).location, null);
  assert.equal(effects.at(-1)(), undefined);
});

test("the map draws, moves and removes the customer marker alongside booking markers", async () => {
  const states = [], refs = [], markers = [];
  let index = 0, refIndex = 0, effects = [];
  class Marker {
    constructor(options) { this.options = options; this.position = options.position; this.map = options.map; markers.push(this); }
    setMap(map) { this.map = map; }
    setPosition(point) { this.position = point; }
  }
  class Map {
    fitBounds(bounds) { this.bounds = bounds; }
    getBounds() { return { contains: () => true }; }
  }
  class LatLngBounds {
    points = [];
    extend(point) { this.points.push(point); }
  }
  const { LiveTrackingMap } = load("../src/components/fetchit/shared/live-tracking-map.tsx", {
    react: {
      useRef(initial) { const slot = refIndex++; return refs[slot] ??= { current: initial }; },
      useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value; }]; },
      useEffect(effect) { effects.push(effect); },
    },
    "@/lib/google-maps-loader": { loadGoogleMaps: async () => {} },
    globals: { window: { google: { maps: { Marker, Map, LatLngBounds, Polyline: class { setMap() {} }, SymbolPath: { CIRCLE: 0 } } } } },
  });
  const props = { pickup: { lat: 14.6, lng: 120.9 }, dropoff: { lat: 14.7, lng: 121 }, rider: null, customer: { lat: 14.61, lng: 120.91 } };
  function render() { index = 0; refIndex = 0; effects = []; LiveTrackingMap(props); }
  render();
  refs[0].current = {};
  const cleanup = effects[0]();
  await Promise.resolve();
  render();
  effects[2]();
  const customer = markers.find(marker => marker.options.title === "Your current location");
  assert(customer);
  assert.equal(customer.options.icon.fillColor, "#2563eb");
  assert.equal(customer.map.bounds.points.length, 3);
  props.customer = { lat: 14.62, lng: 120.92 };
  render(); effects[2]();
  assert.equal(customer.position, props.customer);
  assert.equal(markers.length, 3);
  props.customer = null;
  render(); effects[2]();
  assert.equal(customer.map, null);
  cleanup();
  assert(markers.every(marker => marker.map === null));
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
