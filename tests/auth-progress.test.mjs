import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readAuthProgress, saveAuthProgress, clearAuthProgress, AUTH_PROGRESS_MAX_AGE } from "../src/lib/auth-progress.ts";
class Storage {
  items = new Map();
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
}
const draft = { mode: "signup", email: "pending@example.invalid", name: "Pending Customer", phone: "+639171234567", firebaseUid: "pending-firebase", verificationSent: true };
beforeEach(() => { globalThis.localStorage = new Storage(); });
test("verification details survive reopening with no password or token stored", () => {
  saveAuthProgress({ ...draft, password: "never-store", idToken: "never-store", refreshToken: "never-store" });
  assert.deepEqual(readAuthProgress(), draft);
  assert.doesNotMatch([...localStorage.items.values()].join(""), /never-store|password|Token/);
});
test("expired, malformed and future-dated progress is discarded", () => {
  for (const value of ["bad json", JSON.stringify({ savedAt: Date.now() - AUTH_PROGRESS_MAX_AGE - 1000, data: draft }),
    JSON.stringify({ savedAt: Date.now() + 10000, data: draft }), JSON.stringify({ savedAt: Date.now(), data: { mode: "customer-dashboard" } })]) {
    localStorage.setItem("fetchit:auth-progress-v1", value);
    assert.equal(readAuthProgress(), null);
    assert.equal(localStorage.getItem("fetchit:auth-progress-v1"), null);
  }
});
test("clearing progress removes all saved signup details", () => {
  saveAuthProgress(draft); clearAuthProgress(); assert.equal(readAuthProgress(), null);
});
test("restricted or full device storage does not break signup", () => {
  globalThis.localStorage = { getItem() { throw Error("Denied"); }, setItem() { throw Error("Full"); }, removeItem() { throw Error("Denied"); } };
  assert.doesNotThrow(() => saveAuthProgress(draft));
  assert.equal(readAuthProgress(), null);
  assert.doesNotThrow(clearAuthProgress);
});
