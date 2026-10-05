import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearOfflineAccount, hasPendingLogout, OFFLINE_MAX_AGE, readOfflineCustomer, readSnapshot, saveOfflineCustomer, saveSnapshot, setPendingLogout } from "../src/lib/offline-data.ts";

class Storage {
  items = new Map();
  get length() { return this.items.size; }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
  key(index) { return [...this.items.keys()][index] ?? null; }
}
const customer = id => ({ id, name: "Test customer", email: `${id}@example.invalid`, role: "CUSTOMER", token: "must-not-be-saved" });
beforeEach(() => { globalThis.localStorage = new Storage(); globalThis.sessionStorage = new Storage(); });

test("offline identity only stores display fields and snapshots belong to the current customer", () => {
  saveOfflineCustomer(customer("a"));
  assert.equal(readOfflineCustomer().id, "a");
  assert.equal(readOfflineCustomer().token, undefined);
  saveSnapshot("a", "/api/bookings?type=RIDE", { bookings: [{ id: "ride", deliveryProofs: [{ photoUrl: "large-private-photo" }] }] });
  assert.deepEqual(readSnapshot("a", "/api/bookings?type=RIDE").data.bookings[0].deliveryProofs, []);
  assert.equal(readSnapshot("b", "/api/bookings?type=RIDE"), null);
  saveOfflineCustomer(customer("b"));
  assert.equal(readSnapshot("a", "/api/bookings?type=RIDE"), null);
  assert.equal(localStorage.getItem("fetchit:a:offline:/api/bookings?type=RIDE"), null);
});
test("expired and damaged identities and snapshots are never used", () => {
  saveOfflineCustomer(customer("a"));
  localStorage.setItem("fetchit:a:offline:test", JSON.stringify({ savedAt: Date.now() - OFFLINE_MAX_AGE - 1, data: { status: "ACCEPTED" } }));
  assert.equal(readSnapshot("a", "test"), null);
  localStorage.setItem("fetchit:a:offline:test", "broken JSON");
  assert.equal(readSnapshot("a", "test"), null);
  localStorage.setItem("fetchit:offline-customer-v1", JSON.stringify({ savedAt: Date.now() - OFFLINE_MAX_AGE - 1, data: customer("a") }));
  assert.equal(readOfflineCustomer(), null);
});
test("detail polling cannot evict cached history pages and each category is bounded", () => {
  saveOfflineCustomer(customer("a"));
  saveSnapshot("a", "/api/bookings?filter=history", { bookings: [{ id: "old-booking" }] });
  for (let index = 0; index < 50; index++) saveSnapshot("a", `/api/bookings/detail-${index}`, { booking: { id: String(index) } });
  assert.equal(readSnapshot("a", "/api/bookings?filter=history").data.bookings[0].id, "old-booking");
  assert.equal([...localStorage.items.keys()].filter(key => key.includes("offline:/api/bookings/detail-")).length, 20);
});
test("sign-out removes local drafts, saved places and booking snapshots and blocks offline restoration", () => {
  saveOfflineCustomer(customer("a"));
  localStorage.setItem("fetchit:a:ride-booking-draft", "private draft");
  localStorage.setItem("fetchit:a:places", "private places");
  sessionStorage.setItem("fetchit:a:support-draft:general", "private message");
  saveSnapshot("a", "/api/bookings?filter=active", { bookings: [] });
  localStorage.setItem("other-app", "preserve");
  setPendingLogout(true);
  clearOfflineAccount("a");
  assert.equal(readOfflineCustomer(), null);
  assert.equal([...localStorage.items.keys()].filter(key => key.startsWith("fetchit:a:")).length, 0);
  assert.equal(sessionStorage.length, 0);
  assert.equal(localStorage.getItem("other-app"), "preserve");
  assert.equal(hasPendingLogout(), true);
  setPendingLogout(false);
  assert.equal(hasPendingLogout(), false);
  assert.equal(readOfflineCustomer(), null);
});
test("unavailable and full storage do not break the online app", () => {
  localStorage.setItem = () => { throw new Error("Quota exceeded"); };
  assert.doesNotThrow(() => saveOfflineCustomer(customer("a")));
  assert.doesNotThrow(() => saveSnapshot("a", "bookings", { bookings: [] }));
  assert.equal(readOfflineCustomer(), null);
});
