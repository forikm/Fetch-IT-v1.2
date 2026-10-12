import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

for (const app of ["fetch-customer", "fetch-rider"]) {
  function harness() {
    const window = new EventTarget(), displayMode = new EventTarget();
    displayMode.matches = false;
    window.matchMedia = () => displayMode;
    const subscriptions = [];
    const compiled = ts.transpileModule(readFileSync(new URL(`../../${app}/src/components/fetchit/shared/install-pwa-button.tsx`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, window, Event, require: name => name === "react" ? {
      useSyncExternalStore(subscribe, read) { const control = { snapshot: read() }; control.cleanup = subscribe(() => { control.snapshot = read(); }); subscriptions.push(control); return control.snapshot; },
    } : {} });
    return { window, displayMode, subscriptions, hook: exports.useInstallPrompt };
  }
  test(`${app}: consuming a captured install prompt updates every control and prevents duplicate use`, async () => {
    const h = harness(); let calls = 0;
    h.window.__deferredInstallPrompt__ = { async prompt() { calls++; }, userChoice: Promise.resolve({ outcome: "dismissed" }) };
    const first = h.hook(), second = h.hook();
    assert(first.canInstall && second.canInstall);
    await Promise.all([first.install(), second.install()]);
    assert.equal(calls, 1);
    assert(h.subscriptions.every(control => control.snapshot === null));
    h.subscriptions.forEach(control => control.cleanup());
  });
  test(`${app}: installed display mode hides the install option and updates subscribed controls`, () => {
    const h = harness();
    h.window.__deferredInstallPrompt__ = { async prompt() {}, userChoice: Promise.resolve({ outcome: "accepted" }) };
    assert(h.hook().canInstall);
    h.displayMode.matches = true;
    h.displayMode.dispatchEvent(new Event("change"));
    assert.equal(h.subscriptions[0].snapshot, null);
    assert.equal(h.hook().canInstall, false);
    h.subscriptions.forEach(control => control.cleanup());
  });
}
