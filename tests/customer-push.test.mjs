import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Buffer, URL, require: name => mocks[name] });
  return exports;
}
const { validPushEndpoint, parsePushSubscription } = load("../src/lib/push-input.ts");
test("push subscriptions accept browser services and reject local, forged and malformed endpoints", () => {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const valid = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") } };
  assert(parsePushSubscription(valid));
  for (const endpoint of ["http://fcm.googleapis.com/send/x", "https://localhost/send/x", "https://127.0.0.1/send/x", "https://fcm.googleapis.com.evil.test/x", "https://evil.test/?next=fcm.googleapis.com", "https://user:pass@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://web.push.apple.com/", "https://web.push.apple.com/x#fragment"]) assert.equal(validPushEndpoint(endpoint), false, endpoint);
  for (const endpoint of ["https://web.push.apple.com/test", "https://updates.push.services.mozilla.com/wpush/test", "https://wns2.notify.windows.com/test"]) assert(validPushEndpoint(endpoint));
  assert.equal(parsePushSubscription({ ...valid, keys: { ...valid.keys, auth: "x" } }), null);
  assert.equal(parsePushSubscription({ ...valid, keys: { ...valid.keys, p256dh: Buffer.alloc(65).toString("base64url") } }), null);
});

test("inbox groups delivery, ride and support separately without replaying legacy duplicates", () => {
  const { combineInbox } = load("../src/lib/notification-inbox.ts", { "./constants": { statusLabel: status => status } });
  const page = { unread: { DELIVERY: 1, RIDE: 3, SUPPORT: 1 }, items: [
    { id: "new-delivery", bookingId: "d", category: "DELIVERY", status: "ACCEPTED", createdAt: "2026-10-17T12:00:00Z", read: false },
    { id: "new-support", sourceId: "support:s1", category: "SUPPORT", createdAt: "2026-10-17T12:01:00Z", read: false },
  ] };
  const combined = combineInbox(page, [
    { id: "legacy-duplicate", bookingId: "d", type: "DELIVERY", status: "ACCEPTED", createdAt: "2026-10-17T12:00:00Z", read: false },
    { id: "legacy-ride", bookingId: "r", type: "RIDE", status: "IN_TRANSIT", createdAt: "2026-10-17T11:00:00Z", read: false },
  ], [{ id: "s1", createdAt: "2026-10-17T12:01:00Z", read: false }, { id: "old-support", createdAt: "2026-10-16T12:01:00Z", read: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(combined.unread)), { DELIVERY: 1, RIDE: 4, SUPPORT: 1 });
  assert.equal(combined.items.length, 4);
  assert.equal(combined.items[0].id, "new-support");
  assert(!combined.items.some(item => item.id === "legacy-duplicate"));
});

function workerHarness() {
  const handlers = {}, shown = [], opened = [], navigated = [], messages = [];
  let active = "customer-a", clients = [], closed = 0;
  const context = { URL, Promise, indexedDB: { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx = { objectStore: () => ({
          get() { const operation = { result: active }; queueMicrotask(() => tx.oncomplete()); return operation; },
          put(value) { active = value; queueMicrotask(() => tx.oncomplete()); return {}; },
        }) }; return tx;
      } };
      request.onsuccess();
    }); return request;
  } }, self: { location: { origin: "https://fetch.test" }, addEventListener(type, handler) { handlers[type] = handler; },
    registration: { async showNotification(title, options) { shown.push({ title, ...options }); }, async getNotifications() { return [{ close() { closed++; } }]; } },
    clients: { async matchAll() { return clients; }, async openWindow(url) { opened.push(url); } },
  } };
  vm.runInNewContext(fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  async function dispatch(type, props) { let pending; handlers[type]({ ...props, waitUntil(task) { pending = task; } }); await pending; }
  return { shown, opened, navigated, messages, get active() { return active; }, get closed() { return closed; },
    dispatch, addClient() { clients = [{ url: "https://fetch.test/", async navigate(url) { navigated.push(url); return this; }, async focus() { messages.push("focused"); }, postMessage(message) { messages.push(message); } }]; } };
}
const notice = { id: "notice1", customerId: "customer-a", category: "RIDE", title: "Your driver accepted your ride", body: "RIDE-123", url: "/?booking=ride1&type=RIDE" };
test("a push displays with every page closed and opens the exact ride on tap", async () => {
  const h = workerHarness();
  await h.dispatch("push", { data: { json: () => notice } });
  assert.equal(h.shown.length, 1); assert.match(h.shown[0].title, /^Rides/);
  assert.equal(h.shown[0].tag, "notice1");
  await h.dispatch("notificationclick", { notification: { data: h.shown[0].data, close() {} } });
  const url = new URL(h.opened[0]);
  assert.equal(url.searchParams.get("booking"), "ride1"); assert.equal(url.searchParams.get("notice"), "notice1");
});
test("push refreshes an open inbox and tapping support navigates an existing window", async () => {
  const h = workerHarness(); h.addClient();
  await h.dispatch("push", { data: { json: () => ({ ...notice, category: "SUPPORT", url: "/help?ticket=ticket1" }) } });
  assert.equal(h.messages[0].type, "FETCHIT_PUSH");
  await h.dispatch("notificationclick", { notification: { data: h.shown[0].data, close() {} } });
  assert.equal(new URL(h.navigated[0]).pathname, "/help"); assert.equal(new URL(h.navigated[0]).searchParams.get("ticket"), "ticket1");
  assert(h.messages.includes("focused"));
});
test("sign-out closes old alerts, persists locally and suppresses a previous account's push", async () => {
  const h = workerHarness();
  await h.dispatch("message", { data: { type: "PUSH_ACCOUNT", customerId: null } });
  assert.equal(h.active, null); assert.equal(h.closed, 1);
  await h.dispatch("push", { data: { json: () => notice } }); assert.equal(h.shown.length, 0);
  await h.dispatch("message", { data: { type: "PUSH_ACCOUNT", customerId: "customer-b" } });
  await h.dispatch("push", { data: { json: () => notice } }); assert.equal(h.shown.length, 0);
  await h.dispatch("notificationclick", { notification: { data: { customerId: "customer-a", url: notice.url }, close() {} } });
  assert.equal(h.opened[0], "https://fetch.test/");
});
test("malformed payloads and external notification targets are ignored", async () => {
  const h = workerHarness();
  for (const data of [{ ...notice, url: "https://evil.test/" }, { ...notice, category: "other" }, { ...notice, url: "/api/auth/logout" }]) await h.dispatch("push", { data: { json: () => data } });
  await h.dispatch("push", { data: { json() { throw new Error("Invalid JSON"); } } });
  assert.equal(h.shown.length, 0);
});
