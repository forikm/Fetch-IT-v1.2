import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness() {
  const effects = [], refs = [], listeners = new Map();
  let index = 0, nextTimer = 0;
  const intervals = new Map(), timeouts = new Map();
  const react = {
    useRef(initial) { const slot = index++; return refs[slot] ??= { current: initial }; },
    useEffect(run, deps) {
      const slot = index++;
      if (effects[slot] && deps.every((dep, i) => dep === effects[slot].deps[i])) return;
      effects[slot]?.cleanup?.();
      effects[slot] = { deps, cleanup: run() };
    },
  };
  const surface = {
    visibilityState: "visible",
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL("../src/hooks/use-visible-poll.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require: () => react, window: surface, document: surface,
    navigator: { onLine: true }, AbortController,
    setInterval(fn, ms) { const id = ++nextTimer; intervals.set(id, { fn, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { const id = ++nextTimer; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  });
  return {
    render(poll, key = "booking-1") { index = 0; exports.useVisiblePoll(key, poll); },
    tick() { for (const timer of intervals.values()) timer.fn(); },
    unmount() { effects.forEach((effect) => effect?.cleanup?.()); },
    surface, listeners, intervals,
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("polling starts immediately, runs every three seconds and uses a new callback without restarting", async () => {
  const h = harness(); let first = 0, second = 0;
  h.render(async () => { first++; }); await flush();
  const timer = [...h.intervals.keys()][0];
  assert.equal(first, 1);
  assert.equal(h.intervals.get(timer).ms, 3000);
  h.render(async () => { second++; });
  assert.equal([...h.intervals.keys()][0], timer);
  h.tick(); await flush(); assert.equal(second, 1);
  h.unmount();
});

test("slow requests do not overlap and unmount aborts the active request", async () => {
  const h = harness(); let calls = 0, signal;
  h.render(async (current) => { calls++; signal = current; await new Promise(() => {}); });
  h.tick(); h.tick(); assert.equal(calls, 1);
  h.unmount(); assert.equal(signal.aborted, true); assert.equal(h.intervals.size, 0);
});

test("hidden pages pause checks and returning to the page refreshes immediately", async () => {
  const h = harness(); let calls = 0;
  h.surface.visibilityState = "hidden";
  h.render(async () => { calls++; }); h.tick(); assert.equal(calls, 0);
  h.surface.visibilityState = "visible";
  h.listeners.get("visibilitychange")(); await flush(); assert.equal(calls, 1);
  h.unmount(); assert.equal(h.listeners.size, 0);
});
