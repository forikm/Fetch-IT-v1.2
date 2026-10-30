/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
function compile(file) { return ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText; }
const expiry = {}; new Function("exports", compile("src/lib/job-expiry.ts"))(expiry);
const logic = {}; new Function("exports", "require", compile("src/lib/booking-wait.ts"))(logic, name => { if (name === "./job-expiry") return expiry; throw Error(name); });
const compiled = compile("src/components/fetchit/customer/booking-wait-status.tsx");
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => nodes(node).flatMap(item => [item.props?.children].flat().filter(value => typeof value === "string")).join(" ");
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(reply, { online = true, paused = false, status = "PENDING" } = {}) {
  let index = 0, tree; const slots = [], effects = new Map(), cleanups = [], requests = [], updates = [];
  const booking = { id: "one", type: "RIDE", status, createdAt: new Date(Date.now() - 300000).toISOString() };
  const react = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++; const old = effects.get(i); if (!old || deps.some((dep, n) => !Object.is(dep, old[n]))) { effects.set(i, deps); const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
  };
  const exports = {};
  new Function("exports", "require", "fetch", "window", "setInterval", "clearInterval", compiled)(exports, name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/booking-wait") return logic;
    if (name === "@/lib/store") return { useAppStore: selector => selector({ offlineAccess: false }) };
    if (name === "@/hooks/use-online-status") return { useOnlineStatus: () => online };
    if (name === "@/lib/customer-request") return { customerResponse: async (response, fallback) => { const data = await response.json(); if (!response.ok) throw Error(fallback); return data; } };
    return { Button: "button" };
  }, async (url, init) => { requests.push({ url, init }); return reply(url, init); }, { addEventListener() {}, removeEventListener() {} }, () => 1, () => {});
  const render = () => { index = 0; return tree = exports.BookingWaitStatus({ booking, updatesPaused: paused, onUpdated: update => updates.push(update) }); };
  render();
  return { requests, updates, render, text: () => text(tree), button: () => nodes(tree).find(node => node.type === "button"), close: () => cleanups.forEach(fn => fn()) };
}

test("checking an existing booking is a single GET and can reveal acceptance without creating a new request", async () => {
  let release;
  const app = harness(() => new Promise(resolve => { release = resolve; }));
  app.button().props.onClick(); app.button().props.onClick(); app.render();
  assert.equal(app.requests.length, 1); assert.equal(app.requests[0].init.method, undefined);
  assert.equal(app.requests[0].url, "/api/bookings/status?onlyTracked=1&ids=one");
  assert.equal(app.button().props.disabled, true);
  release(Response.json({ bookings: [{ id: "one", status: "ACCEPTED" }] })); await flush(); app.render();
  assert.equal(app.updates[0].status, "ACCEPTED");
  assert.match(app.text(), /Latest booking status checked/); app.close();
});

test("a failed status check is retryable and does not change the booking", async () => {
  let fail = true;
  const app = harness(() => fail ? Response.json({}, { status: 503 }) : Response.json({ bookings: [{ id: "one", status: "PENDING" }] }));
  app.button().props.onClick(); await flush(); app.render();
  assert.match(app.text(), /Couldn’t check the latest status/);
  assert.equal(app.button().props.children, "Retry status check"); assert.equal(app.updates.length, 0);
  fail = false; app.button().props.onClick(); await flush(); app.render();
  assert.equal(app.updates.length, 1); app.close();
});

test("paused and offline views show the last known state without claiming that matching is live", () => {
  for (const online of [true, false]) {
    const app = harness(() => { throw Error("Unexpected request"); }, { online, paused: true });
    assert.match(app.text(), /Booking updates paused/); assert.match(app.text(), /Last known status/);
    assert.equal(app.button().props.disabled, !online); assert.equal(app.requests.length, 0); app.close();
  }
});

test("accepted bookings have no waiting warning or retry action", () => {
  const app = harness(() => { throw Error("Unexpected request"); }, { status: "ACCEPTED" });
  assert.equal(app.render(), null); assert.equal(app.requests.length, 0); app.close();
});
