/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), ts = require("typescript");
const source = ts.transpileModule(fs.readFileSync("src/lib/google-maps-loader.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function fixture() {
  const window = {}, scripts = new Map(), timers = new Map();
  let appended = 0, timerId = 0;
  const document = {
    getElementById: id => scripts.get(id),
    createElement: () => ({ remove() { scripts.delete(this.id); } }),
    head: { appendChild(script) { appended++; scripts.set(script.id, script); } },
  };
  const exports = {};
  new Function("exports", "window", "document", "process", "setTimeout", "clearTimeout", source)(
    exports, window, document, { env: { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "fixture" } },
    callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id),
  );
  return { window, scripts, timers, load: exports.loadGoogleMaps, appended: () => appended };
}
test("concurrent consumers share one map request, and a failed request can be retried", async () => {
  const app = fixture();
  const first = app.load(), second = app.load();
  assert.equal(first, second); assert.equal(app.appended(), 1);
  const failed = assert.rejects(first, /couldn’t load/);
  app.scripts.get("google-maps-js-sdk").onerror();
  await failed;
  assert.equal(app.window.__googleMapsLoaderPromise__, undefined);
  assert.equal(app.scripts.size, 0);
  const retry = app.load(); assert.equal(app.appended(), 2);
  app.window.google = { maps: { places: {} } };
  app.window.__onGoogleMapsLoaded__();
  await retry;
  assert.equal(app.timers.size, 0);
  await app.load(); assert.equal(app.appended(), 2);
});
test("a stalled map request times out and can retry without reloading the page", async () => {
  const app = fixture(), pending = app.load();
  const failed = assert.rejects(pending, /too long/);
  [...app.timers.values()][0]();
  await failed;
  const retry = app.load();
  app.window.google = { maps: { places: {} } };
  app.window.__onGoogleMapsLoaded__();
  await retry;
  assert.equal(app.appended(), 2);
});
