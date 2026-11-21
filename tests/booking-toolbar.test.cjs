/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm');
const jsx = (type, props) => ({ type, props });
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/fetchit/customer/booking-toolbar.tsx','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText, {exports:exportsForTest,require:name=>name==='react/jsx-runtime'?{jsx,jsxs:jsx}:new Proxy({}, {get:(_,key)=>key})});
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree,...nodes(tree.props?.children)]; }
function render(overrides={}) {
 const calls=[];
 const tree=nodes(exportsForTest.BookingToolbar({isRide:true,tab:'active',showBook:true,status:'Updated just now',paused:false,refreshing:false,refreshDisabled:false,onTab:value=>calls.push(['tab',value]),onService:value=>calls.push(['service',value]),onBook:()=>calls.push(['book']),onRefresh:()=>calls.push(['refresh']),...overrides}));
 return {tree,calls};
}
test('service and status controls navigate without starting or submitting a booking',()=>{
 const h=render();h.tree.find(n=>n.type==='button'&&n.props.children==='Deliveries').props.onClick();h.tree.find(n=>n.type==='Tabs').props.onValueChange('history');
 assert.deepEqual(h.calls,[['service','delivery'],['tab','history']]);
 assert.equal(h.tree.find(n=>n.type==='button'&&n.props.children==='Rides').props['aria-pressed'],true);
});
test('book and refresh remain separate actions; empty states can own the booking action',()=>{
 const h=render();h.tree.find(n=>n.props['aria-label']==='Book a ride').props.onClick();h.tree.find(n=>n.props['aria-label']==='Refresh bookings').props.onClick();
 assert.deepEqual(h.calls,[['book'],['refresh']]);
 assert(!render({showBook:false}).tree.some(n=>n.props['aria-label']==='Book a ride'));
});
test('paused updates stay explicit and refreshing disables the refresh control',()=>{
 const h=render({paused:true,status:'You’re offline. Saved statuses may be out of date.',refreshDisabled:true});
 assert.equal(h.tree.find(n=>n.props['aria-label']==='Refresh bookings').props.disabled,true);
 assert.match(h.tree.find(n=>n.props.role==='status').props.children,/offline/);
 const updating=render({refreshing:true,refreshDisabled:true});assert.equal(updating.tree.find(n=>n.props['aria-label']==='Updating bookings').props.disabled,true);
});
