import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://customer.test";
function harness() {
  const handlers = {}, buckets = new Map(), removed = [], requested = [];
  let online = true, skipWaitingCalls = 0;
  const failedPaths = new Set();
  const key = value => new URL(typeof value === "string" ? value : value.url, origin).href;
  const caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const bucket = buckets.get(name);
      return { async put(request, response) { bucket.set(key(request), response); }, async match(request) { return bucket.get(key(request))?.clone(); } };
    },
    async keys() { return [...buckets.keys()]; },
    async delete(name) { removed.push(name); return buckets.delete(name); },
  };
  const self = { location: { origin }, addEventListener(type, callback) { handlers[type] = callback; }, async skipWaiting() { skipWaitingCalls++; }, clients: { async claim() {} } };
  const fetch = async request => {
    if (!online) throw new Error("No connection");
    const url = key(request); requested.push(url);
    const path = new URL(url).pathname;
    if (failedPaths.has(path)) throw new Error("Resource unavailable");
    const text = path === "/" || path === "/help" ? '<script src="/_next/static/chunks/app.js"></script><link href="/_next/static/chunks/app.css" />'
      : path.endsWith(".css") ? 'body { src: url(/_next/static/media/font.woff2) }' : "public asset";
    const response = new Response(text); Object.defineProperty(response, "type", { value: "basic" }); return response;
  };
  vm.runInNewContext(source, { self, caches, fetch, URL, Response, AbortController, setTimeout, clearTimeout });
  const dispatch = async (type, request) => {
    const waits = []; let result;
    handlers[type]({ request, waitUntil(promise) { waits.push(promise); }, respondWith(promise) { result = promise; } });
    const response = result ? await result : undefined;
    await Promise.all(waits); return response;
  };
  return { caches, buckets, removed, requested, dispatch, setOnline(value) { online = value; }, failPath(path) { failedPaths.add(path); }, skipWaitingCalls() { return skipWaitingCalls; } };
}
test("installation caches the shell and its JS/CSS/fonts before the app is controlled", async () => {
  const h = harness(); await h.dispatch("install");
  assert(h.requested.includes(origin + "/_next/static/chunks/app.js"));
  assert(h.requested.includes(origin + "/_next/static/media/font.woff2"));
  h.setOnline(false);
  const response = await h.dispatch("fetch", { url: origin + "/", method: "GET", mode: "navigate" });
  assert.match(await response.text(), /app.js/);
  const script = await h.dispatch("fetch", { url: origin + "/_next/static/chunks/app.js", method: "GET", mode: "cors" });
  assert.equal(await script.text(), "public asset");
  const help = await h.dispatch("fetch", { url: origin + "/help?ticket=private-id", method: "GET", mode: "navigate" });
  assert.match(await help.text(), /app.css/);
});
test("service worker bypasses writes, private API navigations, and third-party maps", async () => {
  const h = harness();
  for (const [url, method, mode] of [[origin + "/api/bookings", "POST", "cors"], [origin + "/api/bookings/test/receipt", "GET", "navigate"], [origin + "/api/auth/me", "GET", "cors"], ["https://maps.googleapis.com/test", "GET", "cors"], [origin + "/socket.io/test", "GET", "cors"]]) {
    assert.equal(await h.dispatch("fetch", { url, method, mode }), undefined);
  }
  assert.equal(h.buckets.size, 0);
});
test("upgrade removes only Fetch-It customer caches", async () => {
  const h = harness(); await h.caches.open("other-app"); await h.caches.open("fetchit-customer-v6"); await h.dispatch("install"); await h.dispatch("activate");
  assert.deepEqual(h.removed, ["fetchit-customer-v6"]);
  assert((await h.caches.keys()).includes("other-app"));
});
test("a first offline visit receives an honest connection-needed response", async () => {
  const h = harness(); h.setOnline(false);
  const response = await h.dispatch("fetch", { url: origin + "/", method: "GET", mode: "navigate" });
  assert.equal(response.status, 503); assert.match(await response.text(), /first time/);
});
test("a partial update never replaces the working worker when core resources are missing", async () => {
  for (const missing of ["/", "/_next/static/chunks/app.js"]) {
    const h = harness(); await h.caches.open("fetchit-customer-v6"); h.failPath(missing);
    await assert.rejects(h.dispatch("install"), /unavailable/);
    assert.equal(h.skipWaitingCalls(), 0); assert((await h.caches.keys()).includes("fetchit-customer-v6"));
  }
});
