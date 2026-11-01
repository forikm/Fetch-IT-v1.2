/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), ts = require("typescript");
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = tree => nodes(tree).flatMap(n => [n.props?.children].flat().filter(v => typeof v === "string")).join(" ");
const flush = () => new Promise(resolve => setImmediate(resolve));
const booking = { id: "delivery-1", refCode: "FIT-1", type: "DELIVERY", status: "DELIVERED", riderId: "rider-1", rider: null,
  pickupLabel: "Market", dropoffLabel: "Capitol", vehicleClass: "MOTORCYCLE", totalFare: 69, distanceKm: 1, createdAt: "2026-11-01T01:00:00Z", updatedAt: "2026-11-01T02:00:00Z", deliveryProofs: [] };

function hooks() {
  const slots = [], pending = [];
  let index = 0;
  const changed = (old, deps) => !old || deps.some((value, i) => !Object.is(value, old[i]));
  return {
    reset() { index = 0; },
    effects() { for (const effect of pending.splice(0)) effect(); },
    react: {
      useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useMemo(fn, deps) { const i = index++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
      useCallback(fn, deps) { const i = index++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: fn }; return slots[i].value; },
      useEffect(fn, deps) { const i = index++, old = slots[i]; if (changed(old?.deps, deps)) { slots[i] = { deps, cleanup: old?.cleanup }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    },
  };
}

function load(h, overrides = {}) {
  const exports = {}, store = { user: { id: "customer-1" }, bookingsTab: "history", offlineAccess: false, newBookingRequested: false };
  const useAppStore = selector => selector(store); useAppStore.getState = () => store;
  const mocks = {
    react: h.react,
    "@/lib/store": { useAppStore },
    "@/hooks/use-online-status": { useOnlineStatus: () => true },
    "@/hooks/use-toast": { useToast: () => ({ toast() {} }) },
    "@/hooks/use-completed-booking-ratings": { useCompletedBookingRatings: () => ({ ratingBooking: null, observeRatings: observe, dismissRating() {} }) },
    "@/hooks/use-booking-updates": { useBookingUpdates: () => ({ lastChecked: null, offline: false }) },
    "@/hooks/use-customer-overlay-history": { useCustomerOverlayHistory() {} },
    "@/hooks/use-tracking-updates": { useTrackingUpdates() {} },
    "@/lib/booking-wait": { isAwaitingAcceptance: status => ["PENDING", "MATCHED"].includes(status), mergeBookingUpdate: (a, b) => ({ ...a, ...b }) },
    "../shared/history-filters": { HistoryFilters: "HistoryFilters", emptyHistoryFilter: { query: "", status: "", from: "", to: "" } },
    "@/lib/customer-booking-ui": { customerStatusLabel: status => status, formatPeso: value => `₱${value}`, locationUpdateLabel: () => "", routeTimeLabel: () => "" },
    "@/lib/constants": { VEHICLES: { MOTORCYCLE: { label: "Motorcycle" } } },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    ...overrides,
  };
  const source = ts.transpileModule(fs.readFileSync("src/components/fetchit/customer/customer-dashboard.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("exports", "require", "window", source + "\nexports.TrackingView = TrackingView;")(exports, name => {
    if (name === "react/jsx-runtime") return jsx;
    return mocks[name] ?? new Proxy({}, { get: (_, key) => String(key) });
  }, { addEventListener() {}, removeEventListener() {} });
  return { ...exports, store };
}
function observe() {}

async function dashboard(reply) {
  const h = hooks(), requests = [];
  const app = load(h, { "@/lib/offline-bookings": { readCustomerBooking: async (_user, path, signal) => {
    requests.push({ path, signal });
    return path.includes("?") ? { data: { bookings: [booking], nextCursor: null }, cached: false } : reply(path, signal);
  } } });
  const render = () => { h.reset(); const tree = nodes(app.CustomerDashboard({})); h.effects(); return tree; };
  render(); await flush();
  return { render, requests, store: app.store };
}

test("completed history loads full proof details before opening the proof view", async () => {
  let finish;
  const app = await dashboard(() => new Promise(resolve => { finish = resolve; }));
  app.render().find(n => n.type === "BookingHistoryRow").props.onOpen();
  let tree = app.render();
  assert.equal(tree.find(n => n.type === "BookingHistoryRow").props.opening, true);
  assert.match(text(tree), /Loading delivery proof/);
  assert(!tree.some(n => n.type?.name === "TrackingView"));
  const full = { ...booking, deliveryProofs: [{ id: "photo", proofType: "PHOTO", photoUrl: "/api/bookings/delivery-1/proof/photo/photo" }] };
  finish({ data: { booking: full }, cached: false }); await flush(); tree = app.render();
  assert.deepEqual(app.requests.map(r => r.path), ["/api/bookings?filter=history&type=DELIVERY", "/api/bookings/delivery-1"]);
  assert.match(text(tree), /Delivery completed/);
  assert(!tree.some(n => n.type === "BookingSummary"));
  assert.equal(tree.find(n => n.props?.booking === full).props.booking.deliveryProofs[0].photoUrl, full.deliveryProofs[0].photoUrl);
});

test("failed proof loading keeps history available and offers a retry", async () => {
  let fail = true;
  const app = await dashboard(() => fail ? Promise.reject(Error("Connection interrupted")) : Promise.resolve({ data: { booking }, cached: false }));
  app.render().find(n => n.type === "BookingHistoryRow").props.onOpen(); await flush();
  let tree = app.render();
  assert.equal(tree.find(n => n.type === "BookingHistoryRow").props.opening, false);
  const retry = tree.find(n => n.type === "RequestError"); assert.match(retry.props.message, /Connection interrupted/);
  fail = false; retry.props.onRetry(); await flush(); tree = app.render();
  assert.match(text(tree), /Delivery completed/);
  assert.equal(app.requests.filter(r => !r.path.includes("?")).length, 2);
});

test("leaving history aborts proof loading and ignores a late response", async () => {
  let finish;
  const app = await dashboard(() => new Promise(resolve => { finish = resolve; }));
  app.render().find(n => n.type === "BookingHistoryRow").props.onOpen();
  const request = app.requests.at(-1);
  app.store.bookingsTab = "active"; app.render();
  assert.equal(request.signal.aborted, true);
  finish({ data: { booking }, cached: false }); await flush();
  assert(!text(app.render()).includes("Delivery completed"));
});

test("completed proof comes first, defers its map until expanded, and explains missing photos", () => {
  const h = hooks(), app = load(h);
  const tree = nodes(app.TrackingView({ booking, onClose() {}, onUpdated() {} }));
  const route = tree.find(n => n.type === "details");
  assert.equal(route.props.open, false);
  assert(tree.findIndex(n => n.type === "Card") < tree.indexOf(route));
  assert.match(text(tree), /No photo recorded for this delivery/);
  assert(!tree.some(n => n.props?.label === "View delivery photo"));
  assert(!tree.some(n => n.type === "LiveTrackingMap"));
  route.props.onToggle({ currentTarget: { open: true } }); h.reset();
  const expanded = nodes(app.TrackingView({ booking, onClose() {}, onUpdated() {} }));
  assert.equal(expanded.find(n => n.type === "LiveTrackingMap").props.showLiveStatus, false);
  h.reset();
  const active = nodes(app.TrackingView({ booking: { ...booking, status: "IN_TRANSIT" }, onClose() {}, onUpdated() {} }));
  assert.equal(active.find(n => n.type === "BookingTimeline").props.compact, true);
  assert.equal(active.find(n => n.type === "LiveTrackingMap").props.showLiveStatus, true);
});
