import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import * as offline from "../src/lib/offline-data.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = ts.transpileModule(fs.readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const user = { id: "test-customer", name: "Test", email: "test@example.invalid", role: "CUSTOMER" };
class Storage {
  items = new Map();
  get length() { return this.items.size; }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
  key(index) { return [...this.items.keys()][index] ?? null; }
}
beforeEach(() => { globalThis.localStorage = new Storage(); globalThis.sessionStorage = new Storage(); });
function app(fetch) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, navigator: { onLine: true }, fetch, require: name => {
    if (name === "./offline-data") return offline;
    if (name === "firebase/auth") return { async signOut() {} };
    if (name === "@/lib/firebase-client") return { getCustomerAuth() { return {}; } };
    return require(name);
  } });
  return exports.useAppStore;
}
test("offline reopening restores only a saved customer view in offline mode", async () => {
  offline.saveOfflineCustomer(user);
  const store = app(async () => { throw new Error("Offline"); });
  await store.getState().bootstrap();
  assert.equal(store.getState().user.id, user.id);
  assert.equal(store.getState().offlineAccess, true);
  assert.equal(store.getState().view, "mode-select");
});
test("an online expired session clears the saved customer instead of restoring it", async () => {
  offline.saveOfflineCustomer(user);
  const store = app(async () => new Response("{}", { status: 401 }));
  await store.getState().bootstrap();
  assert.equal(store.getState().user, null); assert.equal(offline.readOfflineCustomer(), null);
});
test("offline logout clears device data immediately and revokes the cookie before reconnecting", async () => {
  let online = false;
  const requests = [];
  const store = app(async (path, options) => {
    requests.push([path, options?.method ?? "GET"]);
    if (!online) throw new Error("Offline");
    return new Response(JSON.stringify({ user: null }));
  });
  store.getState().setUser(user);
  await store.getState().logout();
  assert.equal(store.getState().user, null); assert.equal(offline.readOfflineCustomer(), null);
  assert.equal(offline.hasPendingLogout(), true);
  await store.getState().bootstrap(); assert.equal(store.getState().user, null);
  requests.length = 0; online = true;
  await store.getState().refreshUser();
  assert.deepEqual(requests, [["/api/auth/logout", "POST"], ["/api/auth/me", "GET"]]);
  assert.equal(offline.hasPendingLogout(), false); assert.equal(store.getState().user, null);
});
test("an in-flight account refresh cannot restore the customer after logout", async () => {
  let resolve;
  const store = app(path => path === "/api/auth/me" ? new Promise(done => { resolve = done; }) : Promise.resolve(new Response("{}")));
  store.getState().setUser(user);
  const refresh = store.getState().refreshUser();
  await store.getState().logout();
  resolve(new Response(JSON.stringify({ user })));
  await refresh;
  assert.equal(store.getState().user, null); assert.equal(offline.readOfflineCustomer(), null);
});
