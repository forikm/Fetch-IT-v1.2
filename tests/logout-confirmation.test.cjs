/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const siblings = process.env.FETCH_SIBLING_ROOT || path.resolve(root, "..");

function compile(file, jsx = false) {
  const source = process.env.LOGOUT_TEST_GIT_REF ? (() => {
    const sourceIndex = file.lastIndexOf(path.sep + "src" + path.sep);
    const repository = file.slice(0, sourceIndex);
    const relative = file.slice(sourceIndex + 1).split(path.sep).join("/");
    return execFileSync("git", ["-C", repository, "show", process.env.LOGOUT_TEST_GIT_REF + ":" + relative], { encoding: "utf8", windowsHide: true });
  })() : fs.readFileSync(file, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: jsx ? ts.JsxEmit.ReactJSX : undefined },
  }).outputText;
}

function sessionApp(kind, accepted, responseStatus = 200) {
  const exports = {}, effects = [], requests = [], storage = new Map([["saved-draft", "keep"]]);
  let confirmations = 0, pending = false;
  const file = kind === "customer" ? path.join(root, "src/lib/store.ts") : path.join(siblings, "fetch-rider/src/lib/store.ts");
  const offline = {
    clearOfflineAccount: () => effects.push("clear-account"),
    hasPendingLogout: () => pending,
    setPendingLogout: value => { pending = value; effects.push("logout-flag"); },
    readOfflineCustomer: () => null, saveOfflineCustomer() {},
  };
  vm.runInNewContext(compile(file), {
    exports,
    window: { confirm(message) { confirmations++; assert.match(message, /log out/i); return accepted; } },
    navigator: { onLine: true },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); effects.push("storage-write"); },
      removeItem: key => { storage.delete(key); effects.push("storage-delete"); },
    },
    fetch: async (url, options) => {
      requests.push({ url, method: options?.method || "GET" });
      return new Response(JSON.stringify({ user: null }), { status: responseStatus });
    },
    require(name) {
      if (name === "./offline-data") return offline;
      if (name === "./auth-progress") return { clearAuthProgress: () => effects.push("clear-progress"), readAuthProgress: () => null };
      if (name === "./signup-onboarding") return { onboardingPending: () => false, setOnboardingPending() {} };
      return require(name);
    },
  });
  const store = exports.useAppStore;
  const user = { id: "user-1", name: "Test account", role: kind === "customer" ? "CUSTOMER" : "RIDER" };
  store.setState({ user, view: kind === "customer" ? "customer-dashboard" : "rider-dashboard" });
  return { store, user, effects, requests, storage, confirmations: () => confirmations };
}

for (const kind of ["customer", "rider"]) {
  test(kind + ": cancelling logout preserves identity, saved data and the server session", async () => {
    const h = sessionApp(kind, false), before = h.store.getState();
    await h.store.getState().logout();
    assert.equal(h.confirmations(), 1);
    assert.equal(h.store.getState(), before);
    assert.equal(h.store.getState().user, h.user);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.effects, []);
    assert.equal(h.storage.get("saved-draft"), "keep");
  });

  test(kind + ": confirming logout clears the user and revokes the server session once", async () => {
    const h = sessionApp(kind, true);
    await h.store.getState().logout();
    assert.equal(h.confirmations(), 1);
    assert.equal(h.store.getState().user, null);
    assert.equal(h.store.getState().view, "landing");
    assert.deepEqual(h.requests, [{ url: "/api/auth/logout", method: "POST" }]);
  });

  for (const status of [401, 403]) {
    test(kind + ": an expired/restricted session (" + status + ") still clears without asking", async () => {
      const h = sessionApp(kind, false, status);
      await h.store.getState().refreshUser();
      assert.equal(h.confirmations(), 0);
      assert.equal(h.store.getState().user, null);
      assert.equal(h.store.getState().view, "landing");
    });
  }
}

for (const kind of ["admin", "superadmin"]) {
  for (const accepted of [false, true]) {
    test(kind + ": " + (accepted ? "confirmation logs out and navigates" : "Cancel sends no logout request or navigation"), async () => {
      const exports = {}, events = [];
      let confirmations = 0;
      vm.runInNewContext(compile(path.join(siblings, "fetch-" + kind, "src/app/dashboard/logout-button.tsx"), true), {
        exports,
        window: { confirm(message) { confirmations++; assert.match(message, /log out/i); return accepted; }, location: { assign: url => events.push(["navigate", url]) } },
        fetch: async (url, options) => { events.push(["fetch", url, options.method]); return new Response("{}"); },
        require(name) {
          if (name === "@/lib/staff-session-sync") return { announceStaffSessionChange: () => events.push(["session-change"]) };
          if (name === "next/navigation") return { useRouter: () => ({
            push: url => events.push(["navigate", url]), refresh: () => events.push(["refresh"]),
          }) };
          if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
          return require(name);
        },
      });
      const button = exports.LogoutButton();
      assert.equal(button.props.type, "button");
      await button.props.onClick();
      assert.equal(confirmations, 1);
      const navigation = events.filter(event => event[0] !== "session-change" && event[0] !== "refresh");
      assert.deepEqual(navigation, accepted ? [["fetch", "/api/auth/logout", "POST"], ["navigate", "/login"]] : []);
      if (!accepted) assert.deepEqual(events, []);
    });
  }
}
