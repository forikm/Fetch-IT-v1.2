import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../../fetch-rider/src/lib/store.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const rider = { id: "test-rider", name: "Test rider", role: "RIDER", email: "rider@example.invalid" };
const response = (user = null, status = 200) => new Response(JSON.stringify({ user }), { status });
function app(fetch, storage = new Map()) {
  const exports = {};
  vm.runInNewContext(source, { exports, fetch, require, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  } });
  return exports.useAppStore;
}

test("rider logout clears the dashboard immediately even if the network fails", async () => {
  const storage = new Map();
  const store = app(async () => { throw Error("Offline"); }, storage);
  store.getState().setUser(rider);
  await store.getState().logout();
  assert.equal(store.getState().user, null);
  assert.equal(store.getState().view, "landing");
  assert.equal(storage.get("fetchit:rider:pending-logout"), "1");
});

test("reopening after offline rider logout revokes the cookie before reading an account", async () => {
  const storage = new Map([["fetchit:rider:pending-logout", "1"]]);
  const requests = [];
  const store = app(async (path, options) => {
    requests.push([path, options?.method ?? "GET"]);
    return response();
  }, storage);
  await store.getState().bootstrap();
  assert.deepEqual(requests, [["/api/auth/logout", "POST"], ["/api/auth/me", "GET"]]);
  assert.equal(storage.size, 0);
  assert.equal(store.getState().user, null);
});

test("failed cookie revocation cannot silently reopen the rider account", async () => {
  const requests = [];
  const store = app(async path => { requests.push(path); return response(rider, 503); }, new Map([["fetchit:rider:pending-logout", "1"]]));
  await store.getState().bootstrap();
  assert.deepEqual(requests, ["/api/auth/logout"]);
  assert.equal(store.getState().user, null);
  assert.equal(store.getState().bootstrapped, true);
});

test("a delayed rider refresh cannot restore the account after logout", async () => {
  let finish;
  const store = app(path => path === "/api/auth/me" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response()));
  store.getState().setUser(rider);
  const refresh = store.getState().refreshUser();
  await store.getState().logout();
  finish(response(rider)); await refresh;
  assert.equal(store.getState().user, null);
  assert.equal(store.getState().view, "landing");
});

test("a delayed bootstrap cannot overwrite a newer rider sign-in", async () => {
  let finish;
  const store = app(() => new Promise(resolve => { finish = resolve; }));
  const loading = store.getState().bootstrap();
  store.getState().setUser(rider);
  finish(response()); await loading;
  assert.equal(store.getState().user.id, rider.id);
  assert.equal(store.getState().view, "rider-dashboard");
});

test("expired or restricted rider sessions leave the protected dashboard", async () => {
  for (const status of [401, 403]) {
    const store = app(async () => response(null, status));
    store.getState().setUser(rider);
    await store.getState().refreshUser();
    assert.equal(store.getState().user, null);
    assert.equal(store.getState().view, "landing");
  }
});

test("a background account check preserves an unfinished rider login or signup", async () => {
  for (const view of ["login", "signup"]) {
    const store = app(async () => response());
    store.getState().setView(view);
    await store.getState().bootstrap();
    assert.equal(store.getState().view, view);
  }
});
