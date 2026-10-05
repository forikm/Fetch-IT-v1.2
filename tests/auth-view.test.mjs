import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import * as progress from "../src/lib/auth-progress.ts";
import * as signup from "../src/lib/customer-signup.ts";
import { normalizePhilippinePhone } from "../src/lib/phone.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = ts.transpileModule(fs.readFileSync(new URL("../src/components/fetchit/shared/auth-view.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
class Storage {
  items = new Map();
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, value); }
  removeItem(key) { this.items.delete(key); }
}
beforeEach(() => { globalThis.localStorage = new Storage(); });
const saved = { mode: "signup", email: "pending@example.invalid", name: "Pending Customer", phone: "+639171234567", firebaseUid: "pending-user", verificationSent: true };
function harness(firebaseUser) {
  let cursor = 0;
  let dirty = true;
  let poll;
  let tree;
  let observer;
  const slots = [];
  const effects = new Map();
  const queued = [];
  const requests = [];
  const state = { user: null, view: "signup", setView(view) { state.view = view; }, setUser(user) { state.user = user; progress.clearAuthProgress(); } };
  const store = selector => selector(state);
  store.getState = () => state;
  const auth = { currentUser: firebaseUser };
  const sdk = {
    onAuthStateChanged(_, callback) { observer = callback; callback(auth.currentUser); return () => {}; },
    async reload(user) { user.emailVerified = true; },
    async updateProfile(user, profile) { user.displayName = profile.displayName; },
    async signOut() { auth.currentUser = null; observer(null); },
    async sendEmailVerification() { requests.push("verification-email"); },
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = effects.get(index);
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        queued.push(() => { previous?.cleanup?.(); effects.set(index, { deps, cleanup: callback() }); });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, process: { env: { NODE_ENV: "production" } },
    fetch: async (path, options) => { requests.push({ path, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ user: { id: "fetch-user", role: "CUSTOMER" } })); },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "firebase/auth") return sdk;
      if (name === "@/lib/firebase-client") return { getCustomerAuth: () => auth };
      if (name === "@/lib/auth-progress") return progress;
      if (name === "@/lib/customer-signup") return signup;
      if (name === "@/lib/phone") return { normalizePhilippinePhone };
      if (name === "@/lib/store") return { useAppStore: store };
      if (name === "@/hooks/use-visible-poll") return { useVisiblePoll(key, callback) { poll = key ? callback : null; } };
      return new Proxy({}, { get: (_, key) => String(key) });
    },
  });
  function render() {
    for (let attempt = 0; attempt < 10; attempt++) {
      dirty = false; cursor = 0;
      tree = exports.AuthView({ initialMode: "signup" });
      while (queued.length) queued.shift()();
      if (!dirty) return tree;
    }
    throw new Error("Render did not settle");
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(child => nodes(child));
    return [node, ...nodes(node.props?.children)];
  }
  render();
  return { state, requests, render, nodes: () => nodes(tree), get poll() { return poll; } };
}
function firebaseUser(uid = saved.firebaseUid) {
  return { uid, email: saved.email, emailVerified: false, displayName: saved.name, async getIdToken(force) { assert.equal(force, true); return "fixture-verified-token"; } };
}

test("returning from email restores verification details and completes with the verified token", async () => {
  progress.saveAuthProgress(saved);
  const app = harness(firebaseUser());
  assert.equal(app.nodes().find(node => node.props?.id === "verification-phone").props.value, saved.phone);
  assert(app.poll);
  await app.poll(new AbortController().signal);
  app.render();
  assert.equal(app.state.user.id, "fetch-user");
  assert.deepEqual(app.requests, [{ path: "/api/auth/firebase-session", body: { idToken: "fixture-verified-token", phone: saved.phone } }]);
  assert.equal(progress.readAuthProgress(), null);
});

test("verification confirmed on return waits for a missing phone without posting a session", async () => {
  progress.saveAuthProgress({ ...saved, phone: "" });
  const app = harness(firebaseUser());
  await app.poll(new AbortController().signal);
  app.render();
  assert.equal(app.state.user, null);
  assert.deepEqual(app.requests, []);
  assert(app.nodes().some(node => node.props?.role === "status" && /Enter your phone number/.test(node.props.children)));
  assert(app.nodes().some(node => node.type === "Button" && node.props.children.includes("Continue")));
});

test("a different Firebase identity cannot reuse the saved phone or sent-email state", () => {
  progress.saveAuthProgress(saved);
  const other = { ...firebaseUser("other-user"), email: "other@example.invalid" };
  const app = harness(other);
  assert.equal(app.nodes().find(node => node.props?.id === "verification-phone").props.value, "");
  assert.equal(progress.readAuthProgress().firebaseUid, other.uid);
  assert.equal(progress.readAuthProgress().verificationSent, false);
});

test("leaving the verification screen during a background check prevents session creation", async () => {
  progress.saveAuthProgress(saved);
  const app = harness(firebaseUser());
  const controller = new AbortController(); controller.abort();
  await app.poll(controller.signal);
  assert.equal(app.state.user, null);
  assert.deepEqual(app.requests, []);
});
