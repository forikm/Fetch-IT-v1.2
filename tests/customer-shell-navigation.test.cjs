/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const jsx = (type, props) => ({ type, props });
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)]; }
function harness(pathname = '/', nested = false) {
  const events = [];
  const state = { mode: 'ride', setView: view => events.push(['view', view]), chooseMode: mode => events.push(['mode', mode]), openBookingSummary: (...args) => events.push(['booking', ...args]) };
  const useAppStore = selector => selector(state);
  useAppStore.getState = () => state;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/fetchit/shared/customer-app-shell.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
      : name === 'react' ? { createContext: () => ({ Provider: 'Provider' }), useContext: () => nested, useEffect() {} }
      : name === 'next/navigation' ? { usePathname: () => pathname, useRouter: () => ({ push: url => events.push(['route', url]) }) }
      : name === '@/lib/store' ? { useAppStore } : new Proxy({}, { get: (_, key) => key }),
  });
  const tree = nodes(exports.CustomerAppShell({ title: 'Support', selected: 'profile', backToProfile: true, children: { type: 'loading-content', props: {} } }));
  return { tree, events, find: label => tree.find(n => n.props?.['aria-label'] === label) };
}
test('support navigation selects the customer destination before returning to the root route', () => {
  const h = harness('/help');
  h.find('Back to profile').props.onClick();
  assert.deepEqual(h.events, [['view', 'customer-profile'], ['route', '/']]);
  h.events.length = 0;
  h.find('Fetch-It home').props.onClick();
  assert.deepEqual(h.events, [['view', 'mode-select'], ['route', '/']]);
  h.events.length = 0;
  h.tree.find(n => n.type === 'CustomerBottomNav').props.onBookings();
  assert.deepEqual(h.events, [['mode', 'ride'], ['route', '/']]);
});
test('notification booking links preserve the booking and service from support', () => {
  const h = harness('/help');
  h.tree.find(n => n.type === 'NotificationInbox').props.onBooking('owned-booking', 'DELIVERY');
  assert.deepEqual(h.events, [['booking', 'owned-booking', 'delivery'], ['route', '/']]);
});
test('content loading keeps navigation and root navigation does not reload the document', () => {
  const h = harness();
  assert(h.tree.some(n => n.type === 'loading-content'));
  assert(h.tree.some(n => n.type === 'CustomerBottomNav'));
  h.find('Fetch-It home').props.onClick();
  assert.deepEqual(h.events, [['view', 'mode-select']]);
});
test('a page inside the shared shell does not mount duplicate navigation or notification polling', () => {
  const h = harness('/', true);
  assert(h.tree.some(n => n.type === 'loading-content'));
  assert(!h.tree.some(n => n.type === 'CustomerBottomNav' || n.type === 'NotificationInbox' || n.type === 'header'));
});
test('route loading preserves the chosen customer tab and retains the guest loading screen', () => {
  let state = { user: { role: 'CUSTOMER' }, view: 'customer-profile' };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/loading.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
      : name === '@/lib/store' ? { useAppStore: selector => selector(state) }
      : new Proxy({}, { get: (_, key) => key }),
  });
  assert.equal(exports.default().type, 'CustomerAppShell');
  assert.equal(exports.default().props.selected, 'profile');
  state.view = 'mode-select';
  assert.equal(exports.default().props.selected, 'home');
  state.user = null;
  assert.equal(exports.default().type, 'FetchItLoadingScreen');
});
