/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), ts = require("typescript");
const source = ts.transpileModule(fs.readFileSync("src/hooks/use-customer-view-history.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
test("browser Back restores customer views and cannot restore a signed-out dashboard", () => {
  let state = { view: "landing", user: null }, subscriber, onPop, cleanup;
  const history = { state: {}, entries: [], replaceState(value) { this.state = value; }, pushState(value) { this.state = value; this.entries.push(value); } };
  const store = { getState: () => state, subscribe: callback => { subscriber = callback; return () => { subscriber = null; }; } };
  state.setView = view => { const previous = state; state = { ...state, view }; subscriber?.(state, previous); };
  const exports = {};
  new Function("exports", "require", "window", source)(exports, name => name === "react"
    ? { useEffect: effect => { cleanup = effect(); } } : { useAppStore: store },
    { history, addEventListener: (_, cb) => { onPop = cb; }, removeEventListener: () => { onPop = null; } });
  exports.useCustomerViewHistory(true);
  state.setView("login");
  assert.equal(history.entries.length, 1);
  assert.equal(history.state.fetchitView, "login");
  const previous = state; state = { ...state, view: "ride-dashboard", user: { id: "customer" } };
  subscriber(state, previous);
  assert.equal(history.entries.length, 1, "Sign-in replaces its form entry");
  onPop({ state: { fetchitView: "landing" } });
  assert.equal(state.view, "mode-select");
  state.user = null;
  onPop({ state: { fetchitView: "ride-dashboard" } });
  assert.equal(state.view, "landing");
  assert.equal(state.user, null);
  onPop({ state: { fetchitView: "not-a-view" } });
  assert.equal(state.view, "landing");
  cleanup(); assert.equal(subscriber, null); assert.equal(onPop, null);
});
