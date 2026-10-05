import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import * as offline from "../src/lib/offline-data.ts";
import { customerResponse } from "../src/lib/customer-request.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = ts.transpileModule(fs.readFileSync(new URL("../src/lib/offline-bookings.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
class Storage {
  items = new Map();
  get length() { return this.items.size; }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
  key(index) { return [...this.items.keys()][index] ?? null; }
}
const path = "/api/bookings?filter=active&type=RIDE";
beforeEach(() => {
  globalThis.localStorage = new Storage(); globalThis.sessionStorage = new Storage();
  offline.saveOfflineCustomer({ id: "customer", name: "Test", email: "test@example.invalid", role: "CUSTOMER" });
});
function reader(fetch, online = true) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => name === "./offline-data" ? offline : { customerResponse }, fetch, navigator: { onLine: online }, Date, Error });
  return exports.readCustomerBooking;
}
test("successful online reads are stored and a later disconnection uses the timestamped snapshot", async () => {
  const data = { bookings: [{ id: "ride" }], nextCursor: null };
  const read = reader(async () => new Response(JSON.stringify(data)));
  assert.equal((await read("customer", path)).cached, false);
  const disconnected = reader(async () => { throw new Error("Connection lost"); });
  const cached = await disconnected("customer", path);
  assert.equal(cached.cached, true); assert.deepEqual(cached.data, data); assert(cached.savedAt > 0);
});
test("offline reads skip the network and explain when a view has never been saved", async () => {
  const read = reader(() => { throw Error("Must not send a request"); }, false);
  await assert.rejects(read("customer", path), /hasn’t been saved/);
  offline.saveSnapshot("customer", path, { bookings: [] });
  assert.equal((await read("customer", path)).cached, true);
});
test("authentication failures clear private snapshots and never fall back to cached success", async () => {
  offline.saveSnapshot("customer", path, { bookings: [{ id: "private" }] });
  const read = reader(async () => new Response(JSON.stringify({ error: "Expired session" }), { status: 401 }));
  await assert.rejects(read("customer", path), /session has expired/);
  assert.equal(offline.readSnapshot("customer", path), null);
  assert.equal(offline.readOfflineCustomer(), null);
});
test("aborted requests cannot apply cached data after leaving a view", async () => {
  offline.saveSnapshot("customer", path, { bookings: [] });
  const controller = new AbortController(); controller.abort();
  const read = reader(async () => { throw new Error("Aborted"); });
  await assert.rejects(read("customer", path, controller.signal), /Aborted/);
});
test("mutation, tracking, receipt and support routes never use the snapshot helper", async () => {
  const read = reader(() => { throw new Error("Must not request this route"); });
  for (const forbidden of ["/api/bookings/id/cancel", "/api/bookings/status?ids=test", "/api/bookings/id/receipt", "/api/support"]) {
    await assert.rejects(read("customer", forbidden), /not available offline/);
  }
});
