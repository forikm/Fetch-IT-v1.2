import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as ui from "../src/lib/customer-booking-ui.ts";
import * as policy from "../src/lib/payment-policy.ts";

const source = fs.readFileSync(new URL("../src/components/fetchit/shared/customer-payment-card.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const cash = { paymentMethod: "CASH", paymentStatus: "UNPAID", status: "IN_TRANSIT", dropoffReachedAt: "2026-10-29T01:00:00Z", totalFare: 89, customerPaidAmount: null, riderReceivedAmount: null, customerPaidAt: null, riderReceivedAt: null, paidAt: null, paymentReference: null };
function nodes(node) { return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
const text = tree => nodes(tree).flatMap(n => [n.props?.children].flat().filter(v => typeof v === "string" || typeof v === "number")).join(" ");
function harness(record = cash, type = "DELIVERY") {
  const slots = [], effects = [], requests = [], handlers = {};
  let cursor = 0, tree;
  let getResponse, postResponse;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++; if (!(i in slots)) { slots[i] = deps; effects.push(callback); } },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, Number, Error, AbortController, document: { hidden: false }, navigator: { onLine: true },
    setInterval: () => 1, clearInterval() {},
    window: { addEventListener(name, callback) { handlers[name] = callback; }, removeEventListener() {}, location: { assign() {} } },
    fetch: async (url, options = {}) => { requests.push({ url, ...options }); return options.method === "POST" ? postResponse?.() ?? Response.json({ booking: record }) : getResponse?.() ?? Response.json({ booking: record }); },
    require(name) { if (name === "react") return hooks; if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; if (name === "@/lib/customer-booking-ui") return ui; if (name === "@/lib/payment-policy") return policy; return { Button: "button" }; },
  });
  const render = () => { cursor = 0; tree = exports.CustomerPaymentCard({ bookingId: "booking1", type }); return tree; };
  render(); effects.forEach(effect => effect());
  const find = (type, label) => nodes(render()).find(n => n.type === type && (!label || n.props.children === label));
  return { render, find, requests, handlers, setGet: fn => { getResponse = fn; }, setPost: fn => { postResponse = fn; }, async ready() { await flush(); await flush(); render(); } };
}

test("customer payment display omits earnings and keeps cash entry behind an explicit action", async () => {
  const h = harness({ ...cash, paymentMethod: "DEMO_GCASH", demoCommission: 12, demoRiderEarnings: 77, demoPayoutReference: "private-payout" });
  await h.ready();
  assert.match(text(h.render()), /₱89.00/);
  assert.doesNotMatch(text(h.render()), /commission|earnings|payout|private-payout/i);
  const c = harness(); await c.ready();
  assert.equal(c.find("form"), undefined);
  c.find("button", "Confirm cash payment").props.onClick();
  assert(c.find("form"));
});

test("cash confirmation sends the entered amount once and waits for server confirmation", async () => {
  const h = harness(); await h.ready();
  h.find("button", "Confirm cash payment").props.onClick();
  let finish;
  h.setPost(() => new Promise(resolve => { finish = resolve; }));
  const form = h.find("form");
  const first = form.props.onSubmit({ preventDefault() {} });
  const second = form.props.onSubmit({ preventDefault() {} });
  await flush();
  assert.equal(h.requests.filter(r => r.method === "POST").length, 1);
  assert.deepEqual(JSON.parse(h.requests.at(-1).body), { amount: "89.00" });
  finish(Response.json({ booking: { ...cash, customerPaidAt: new Date().toISOString(), customerPaidAmount: 89, paymentStatus: "PENDING" } }));
  await Promise.all([first, second]);
  assert.match(text(h.render()), /Waiting for your rider to confirm receipt/);
  assert.doesNotMatch(text(h.render()), /You confirmed.*Paid/);
  assert.equal(h.find("form"), undefined);
});

test("a delayed pre-confirmation poll cannot overwrite a newer cash confirmation", async () => {
  const h = harness(); await h.ready();
  let stale;
  h.setGet(() => new Promise(resolve => { stale = resolve; }));
  const poll = h.handlers.online();
  h.find("button", "Confirm cash payment").props.onClick();
  h.setPost(() => Response.json({ booking: { ...cash, customerPaidAt: new Date().toISOString(), customerPaidAmount: 89, paymentStatus: "PENDING" } }));
  await h.find("form").props.onSubmit({ preventDefault() {} });
  stale(Response.json({ booking: cash })); await poll;
  assert.match(text(h.render()), /Waiting for your rider to confirm receipt/);
});

test("ride payments use driver wording and cancelled unpaid bookings do not request payment", async () => {
  const ride = harness(cash, "RIDE"); await ride.ready();
  assert.match(text(ride.render()), /Pay your driver in cash/);
  const cancelled = harness({ ...cash, status: "CANCELLED" }); await cancelled.ready();
  assert.match(text(cancelled.render()), /Booking cancelled/);
  assert.equal(cancelled.find("button", "Confirm cash payment"), undefined);
  assert.doesNotMatch(text(cancelled.render()), /Pay your rider/);
});

test("delivery cash controls remain hidden before drop-off arrival", async () => {
  for (const status of ["PENDING", "MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"]) {
    const h = harness({ ...cash, status, dropoffReachedAt: null }); await h.ready();
    assert.equal(h.find("button", "Confirm cash payment"), undefined, status);
    assert.equal(h.find("form"), undefined, status);
    assert.match(text(h.render()), /Pay at drop-off/);
  }
});

test("cash mismatches remain under review and matching confirmations show paid", async () => {
  const mismatch = harness({ ...cash, paymentStatus: "PENDING", customerPaidAt: "2026-10-30T01:00:00Z", riderReceivedAt: "2026-10-30T01:01:00Z", customerPaidAmount: 80, riderReceivedAmount: 89 });
  await mismatch.ready();
  assert.match(text(mismatch.render()), /Needs review/);
  assert.match(text(mismatch.render()), /do not match the fare/);
  assert.equal(mismatch.find("button", "Confirm cash payment"), undefined);
  const paid = harness({ ...cash, paymentStatus: "PAID", customerPaidAt: "2026-10-30T01:00:00Z", riderReceivedAt: "2026-10-30T01:01:00Z", customerPaidAmount: 89, riderReceivedAmount: 89, paidAt: "2026-10-30T01:01:00Z" });
  await paid.ready();
  assert.match(text(paid.render()), /Paid/);
  assert.doesNotMatch(text(paid.render()), /Waiting for|Needs review/);
  assert.equal(paid.find("button", "Confirm cash payment"), undefined);
});
