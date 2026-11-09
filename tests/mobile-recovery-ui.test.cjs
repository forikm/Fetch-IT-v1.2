const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const flush = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)]; }
function text(tree) { return typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : ''; }
function harness(file, name, props, image = {complete:false,naturalWidth:0}) {
  const slots=[], effects=[], timers=[]; let cursor=0;
  const react={
    useState(value) { const i=cursor++; if (!(i in slots)) slots[i]=typeof value==='function'?value():value; return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}]; },
    useRef(value) { const i=cursor++; return slots[i]??={current:value}; },
    useEffect(fn,deps) { const i=cursor++,old=slots[i]; if(!old||deps.some((value,n)=>!Object.is(value,old.deps[n]))) { old?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();}); } },
  };
  const exports={};
  const jsx=(type,props,key)=>({type,props,key});
  const code=ts.transpileModule(fs.readFileSync(file,'utf8')+(name==='ProofImage'?'\nexport { ProofImage };':''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,queueMicrotask,setTimeout:(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer;},clearTimeout:timer=>timer.cancelled=true,require:n=>n==='react'?react:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:new Proxy({}, {get:(_,key)=>key})});
  function render() { cursor=0;const tree=exports[name](props);for(const node of nodes(tree))if(node.type==='img'&&node.props.ref)node.props.ref.current=image;effects.splice(0).forEach(fn=>fn());return tree; }
  return {render, timers, find:(type,label)=>nodes(render()).find(n=>n.type===type&&(!label||text(n).trim()===label)), unmount(){for(const slot of slots)slot?.cleanup?.();}};
}
const photo='src/components/fetchit/customer/delivery-photo-preview.tsx';
test('photo loading reserves its frame and ends when the image arrives',()=>{
 const h=harness(photo,'ProofImage',{src:'/private-photo'});assert.match(text(h.render()),/Loading delivery photo/);assert.equal(h.find('div').props['aria-busy'],undefined);
 const img=h.find('img');assert.match(img.props.className,/h-48/);img.props.onLoad();assert.doesNotMatch(text(h.render()),/Loading delivery photo/);
});
test('a cached photo loaded before hydration does not remain hidden behind a spinner',async()=>{
 const h=harness(photo,'ProofImage',{src:'/private-photo'},{complete:true,naturalWidth:500});h.render();await flush();assert.doesNotMatch(text(h.render()),/Loading delivery photo/);assert.doesNotMatch(h.find('img').props.className,/opacity-0/);
});
test('failed photo retry creates a new image and can recover without reopening the booking',()=>{
 const h=harness(photo,'ProofImage',{src:'/private-photo'});h.find('img').props.onError();assert.match(text(h.render()),/couldn’t load/);h.find('Button','Retry photo').props.onClick();assert.equal(h.find('img').key,1);h.find('img').props.onLoad();assert.doesNotMatch(text(h.render()),/couldn’t load|Loading delivery photo/);
});
test('a failed thumbnail does not prevent the full-size photo from loading independently',()=>{
 const thumb=harness(photo,'ProofImage',{src:'/private-photo',onEnlarge(){}}),full=harness(photo,'ProofImage',{src:'/private-photo',full:true});thumb.find('img').props.onError();full.find('img').props.onLoad();assert.match(text(thumb.render()),/Retry photo/);assert.doesNotMatch(text(full.render()),/Retry photo|Loading delivery photo/);
});
test('slow-request feedback waits five seconds and cancels its timer when the request ends',()=>{
 const h=harness('src/components/fetchit/shared/slow-request-feedback.tsx','SlowRequestFeedback',{message:'Still checking your booking.'});assert.equal(h.render(),null);assert.equal(h.timers[0].delay,5000);h.timers[0].fn();assert.match(text(h.render()),/Still checking/);h.unmount();assert.equal(h.timers[0].cancelled,true);
});
test('filtered history has a direct Clear filters action; first use offers booking',()=>{
 let clears=0,bookings=0;const props={history:true,filtered:true,service:'rides',offline:false,onClear:()=>clears++,onBook:()=>bookings++};
 const filtered=harness('src/components/fetchit/customer/booking-empty-state.tsx','BookingEmptyState',props);filtered.find('Button','Clear filters').props.onClick();assert.equal(clears,1);
 const first=harness('src/components/fetchit/customer/booking-empty-state.tsx','BookingEmptyState',{...props,filtered:false});assert.match(text(first.render()),/No booking history yet/);first.find('Button','Book a ride').props.onClick();assert.equal(bookings,1);
 const offline=harness('src/components/fetchit/customer/booking-empty-state.tsx','BookingEmptyState',{...props,filtered:false,offline:true});assert.match(text(offline.render()),/No saved bookings|Reconnect/);assert(offline.find('Button','Prepare a booking'));
});
