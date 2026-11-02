const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
test('opening and cancelling the safety dialog does not request GPS or send an alert', async () => {
  const state = [], refs = []; let slot = 0, refSlot = 0, gps = 0, posts = 0;
  const jsx = (type, props) => ({ type, props });
  const react = { useState: initial => { const index = slot++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; }, useRef: value => refs[refSlot++] ?? (refs[refSlot - 1] = { current: value }) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/fetchit/customer/ride-sos-button.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name.endsWith('/button') ? { Button: 'Button' } : Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription','DialogFooter','DialogClose'].map(key => [key, key])), navigator: { onLine: true, geolocation: { getCurrentPosition(resolve) { gps++; resolve({ coords: { latitude: 16, longitude: 120, accuracy: 5 }, timestamp: Date.now() }); } } }, fetch: async () => { posts++; return Response.json({ ticket: {} }); }, AbortController, setTimeout, clearTimeout, Error });
  function render() { slot = 0; refSlot = 0; return exports.RideSosButton({ bookingId: 'ride', disabled: false }); }
  function find(node, predicate) { if (!node || typeof node !== 'object') return; if (predicate(node)) return node; for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; } }
  const button = tree => find(tree, n => n.type === 'Button' && n.props.children === 'Alert Fetch-It staff');
  button(render()).props.onClick(); let tree = render(); let dialog = find(tree, n => n.type === 'Dialog');
  assert.equal(dialog.props.open, true); assert.equal(gps, 0); assert.equal(posts, 0);
  dialog.props.onOpenChange(false); assert.equal(find(render(), n => n.type === 'Dialog').props.open, false); assert.equal(posts, 0);
  button(render()).props.onClick(); tree = render(); find(tree, n => n.type === 'Button' && n.props.children === 'Send safety alert').props.onClick();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(gps, 1); assert.equal(posts, 1);
});
