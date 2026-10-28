import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, mocks = {}) {
  const exports = {};
  const jsx = (type, props, key) => ({ type, props, key });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Set, Map, ...mocks.globals, require: name => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : mocks[name] ?? new Proxy({}, { get: (_, key) => String(key) }) });
  return exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const grouping = load("../src/lib/notification-inbox.ts", { "./customer-booking-ui": { customerStatusLabel: status => status } });
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const states = [], refs = [], requests = [], opened = [];
  let index = 0, refIndex = 0, poll;
  const page = { items: ["DELIVERY", "RIDE", "SUPPORT"].map((category, i) => ({ id: `notice-${i}`, category, title: `${category} update`, body: "Details", bookingId: category === "SUPPORT" ? null : `booking-${i}`, ticketId: category === "SUPPORT" ? "ticket1" : null, read: false, createdAt: "2026-10-17T12:00:00Z" })), unread: { DELIVERY: 1, RIDE: 1, SUPPORT: 1 } };
  const module = load("../src/components/fetchit/shared/notification-inbox.tsx", {
    react: { useEffect() {}, useRef: value => refs[refIndex++] ??= { current: value }, useState(value) { const slot = index++; if (!(slot in states)) states[slot] = value; return [states[slot], value => states[slot] = typeof value === "function" ? value(states[slot]) : value]; } },
    "@/lib/store": { useAppStore: selector => selector({ user: { id: "customer1" } }) },
    "@/lib/customer-push": { setPushAccount: async () => {} },
    "@/hooks/use-customer-data": { useCustomerData: (_id, _key, initial) => [initial, () => {}] },
    "@/lib/notification-inbox": grouping,
    "@/hooks/use-visible-poll": { useVisiblePoll(_key, callback) { poll = callback; } },
    "next/navigation": { useRouter: () => ({ push: url => opened.push(url) }) },
    "@/lib/customer-request": { customerResponse: async response => response.json() },
    globals: { navigator: { onLine: true }, fetch: async (url, options = {}) => {
      requests.push({ url, ...options });
      if (options.method === "PATCH") {
        const selection = JSON.parse(options.body);
        for (const item of page.items) if (selection.category === item.category || selection.ids?.includes(item.id)) item.read = true;
        for (const category of Object.keys(page.unread)) page.unread[category] = page.items.filter(item => item.category === category && !item.read).length;
        return { json: async () => ({ ok: true }) };
      }
      return { json: async () => JSON.parse(JSON.stringify(url.includes("/support/") ? { items: [] } : page)) };
    } },
  });
  const render = () => { index = 0; refIndex = 0; return nodes(module.NotificationInbox({ onBooking: (id, type) => opened.push({ id, type }) })); };
  render();
  return { render, poll: () => poll(new AbortController().signal), requests, opened, states };
}

test("category labels keep independent red unread circles and tab changes do not mark updates read", async () => {
  const h = harness(); await h.poll();
  let tree = h.render();
  const tabs = tree.filter(node => node.type === "TabsTrigger");
  assert.deepEqual(tabs.map(node => node.props["aria-label"]), ["Deliveries, 1 unread", "Rides, 1 unread", "Support, 1 unread"]);
  const badges = tree.filter(node => typeof node.type === "function" && node.type.name === "Badge");
  assert.equal(badges.length, 4);
  for (const badge of badges) assert.match(badge.type(badge.props).props.className, /rounded-full bg-red-600/);
  tree.find(node => node.type === "Tabs").props.onValueChange("RIDE");
  tree = h.render(); assert.equal(tree.find(node => node.type === "Tabs").props.value, "RIDE");
  assert(!h.requests.some(request => request.method === "PATCH"));
  const ridePanel = tree.find(node => node.type === "TabsContent" && node.props.value === "RIDE");
  nodes(ridePanel).find(node => node.type === "Button").props.onClick(); await flush();
  tree = h.render();
  assert.equal(tree.find(node => node.type === "TabsTrigger" && node.props.value === "RIDE").props["aria-label"], "Rides");
  assert.equal(tree.find(node => node.type === "TabsTrigger" && node.props.value === "DELIVERY").props["aria-label"], "Deliveries, 1 unread");
  assert.equal(tree.find(node => node.type === "TabsTrigger" && node.props.value === "SUPPORT").props["aria-label"], "Support, 1 unread");
});
test("selecting a delivery notification opens its booking and clears only that update", async () => {
  const h = harness(); await h.poll();
  const panel = h.render().find(node => node.type === "TabsContent" && node.props.value === "DELIVERY");
  nodes(panel).find(node => node.type === "button").props.onClick(); await flush();
  assert.deepEqual(h.opened, [{ id: "booking-0", type: "DELIVERY" }]);
  const selection = JSON.parse(h.requests.find(request => request.method === "PATCH").body);
  assert.deepEqual(selection.ids, ["notice-0"]);
});
test("selecting a support notification opens the specific support conversation", async () => {
  const h = harness(); await h.poll();
  const panel = h.render().find(node => node.type === "TabsContent" && node.props.value === "SUPPORT");
  nodes(panel).find(node => node.type === "button").props.onClick(); await flush();
  assert.equal(h.opened[0], "/help?ticket=ticket1");
});
