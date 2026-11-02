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
function harness(options = {}) {
  const states = [], refs = [], requests = [], opened = [];
  let index = 0, refIndex = 0, poll, nextGet;
  let legacy = options.legacy ?? [];
  const page = { items: ["DELIVERY", "RIDE", "SUPPORT"].map((category, i) => ({ id: `notice-${i}`, category, title: `${category} update`, body: "Details", bookingId: category === "SUPPORT" ? null : `booking-${i}`, ticketId: category === "SUPPORT" ? "ticket1" : null, read: false, createdAt: "2026-10-17T12:00:00Z" })), unread: { DELIVERY: 1, RIDE: 1, SUPPORT: 1 } };
  const inboxModule = load("../src/components/fetchit/shared/notification-inbox.tsx", {
    react: { useEffect() {}, useRef: value => refs[refIndex++] ??= { current: value }, useState(value) { const slot = index++; if (!(slot in states)) states[slot] = value; return [states[slot], value => states[slot] = typeof value === "function" ? value(states[slot]) : value]; } },
    "@/lib/store": { useAppStore: selector => selector({ user: { id: "customer1" } }) },
    "@/lib/customer-push": { setPushAccount: async () => {} },
    "@/hooks/use-customer-data": { useCustomerData: (_id, key, initial) => key === "notification-inbox-v2" ? [legacy, update => { legacy = typeof update === "function" ? update(legacy) : update; }] : [initial, () => {}] },
    "@/lib/notification-inbox": grouping,
    "@/hooks/use-visible-poll": { useVisiblePoll(_key, callback) { poll = callback; } },
    "next/navigation": { useRouter: () => ({ push: url => opened.push(url) }) },
    "@/lib/customer-request": { customerResponse: async response => response.json() },
    globals: { navigator: { onLine: true }, fetch: async (url, options = {}) => {
      requests.push({ url, ...options });
      if (options.method === "PATCH") {
        if (patch) await patch();
        const selection = JSON.parse(options.body);
        for (const item of page.items) if (selection.category === item.category || selection.ids?.includes(item.id)) { item.read = true; if (selection.action === "dismiss") item.dismissed = true; }
        for (const category of Object.keys(page.unread)) page.unread[category] = page.items.filter(item => item.category === category && !item.read && !item.dismissed).length;
        return { json: async () => ({ ok: true }) };
      }
      const snapshot = JSON.parse(JSON.stringify({ ...page, support }));
      if (nextGet) { const pending = nextGet; nextGet = null; await pending; }
      return { json: async () => snapshot };
    } },
  });
  const patch = options.patch;
  const support = options.support ?? [];
  const render = () => { index = 0; refIndex = 0; return nodes(inboxModule.NotificationInbox({ onBooking: (id, type) => opened.push({ id, type }) })); };
  render();
  return { render, poll: () => poll(new AbortController().signal), requests, opened, states, deferNextGet: pending => { nextGet = pending; } };
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

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const panel = (h, category = "DELIVERY") => h.render().find(node => node.type === "TabsContent" && node.props.value === category);
const mark = h => nodes(panel(h)).find(node => node.type === "Button" && node.props.children === "Mark as read").props.onClick();

test("marking read updates the badge immediately without waiting for a slow save or reloading the inbox", async () => {
  const save = deferred(), h = harness({ patch: () => save.promise }); await h.poll();
  mark(h);
  assert.equal(h.render().find(node => node.type === "TabsTrigger" && node.props.value === "DELIVERY").props["aria-label"], "Deliveries");
  assert.equal(h.requests.filter(r => r.method === "PATCH").length, 1);
  await h.poll();
  assert.equal(h.requests.length, 2, "polls pause while saving");
  save.resolve(); await flush();
  assert.equal(h.requests.length, 2, "a successful save needs no trailing GET");
});

test("failed saves restore unread badges and show a retryable error", async () => {
  const save = deferred(), h = harness({ patch: () => save.promise }); await h.poll();
  mark(h); save.reject(Error("Save unavailable")); await flush();
  assert.equal(h.render().find(node => node.type === "TabsTrigger" && node.props.value === "DELIVERY").props["aria-label"], "Deliveries, 1 unread");
  assert(h.render().some(node => node.props?.role === "alert"));
});

test("opening another booking stays available while a mark-read save is pending", async () => {
  const save = deferred(), h = harness({ patch: () => save.promise }); await h.poll();
  mark(h);
  const link = nodes(panel(h, "RIDE")).find(node => node.type === "button");
  assert(!link.props.disabled);
  link.props.onClick();
  assert.deepEqual(h.opened, [{ id: "booking-1", type: "RIDE" }]);
  assert.equal(h.requests.filter(r => r.method === "PATCH").length, 1);
  save.resolve(); await flush();
});

test("an older in-flight refresh cannot undo an optimistic read", async () => {
  const get = deferred(), save = deferred(), h = harness({ patch: () => save.promise }); await h.poll();
  h.deferNextGet(get.promise); const refresh = h.poll(); mark(h);
  get.resolve(); await refresh;
  assert.equal(h.render().find(node => node.type === "TabsTrigger" && node.props.value === "DELIVERY").props["aria-label"], "Deliveries");
  save.resolve(); await flush();
});

test("dismiss hides only the chosen notification immediately and persists after refresh", async () => {
  const save = deferred(), h = harness({ patch: () => save.promise }); await h.poll();
  nodes(panel(h)).find(node => node.props?.title === "Dismiss notification").props.onClick();
  assert(!nodes(panel(h)).some(node => node.props?.title === "Dismiss notification"));
  assert.equal(h.opened.length, 0, "dismiss does not open or change a booking");
  assert.deepEqual(JSON.parse(h.requests.find(r => r.method === "PATCH").body).ids, ["notice-0"]);
  save.resolve(); await flush(); await h.poll();
  assert(!nodes(panel(h)).some(node => node.props?.title === "Dismiss notification"));
  assert(nodes(panel(h, "RIDE")).some(node => node.props?.title === "Dismiss notification"));
});

test("failed dismissal restores the notification", async () => {
  const h = harness({ patch: async () => { throw Error("Could not save"); } }); await h.poll();
  nodes(panel(h)).find(node => node.props?.title === "Dismiss notification").props.onClick(); await flush();
  assert(nodes(panel(h)).some(node => node.props?.title === "Dismiss notification"));
});

test("dismissed sources suppress old booking and support duplicates", () => {
  const item = { id: "server", category: "DELIVERY", bookingId: "booking", status: "ACCEPTED", dismissed: true, read: true, createdAt: "2026-11-02T00:00:00Z" };
  const page = { items: [item, { ...item, id: "reply", sourceId: "support:reply", category: "SUPPORT" }], unread: { DELIVERY: 0, RIDE: 0, SUPPORT: 0 } };
  const inbox = grouping.combineInbox(page, [{ id: "old", bookingId: "booking", status: "ACCEPTED", type: "DELIVERY" }], [{ id: "reply", createdAt: item.createdAt }]);
  assert.equal(inbox.items.length, 0);
  assert.equal(inbox.unread.DELIVERY + inbox.unread.SUPPORT, 0);
});
