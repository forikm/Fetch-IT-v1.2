const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('src/components/fetchit/customer/ride-confirmations.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const pickup={id:'ride',type:'RIDE',status:'PICKED_UP',dropoffLabel:'Booked destination',updatedAt:'2026-11-18T01:00:00Z',customerPickupConfirmedAt:null,customerDropoffConfirmedAt:null};
function nodes(node){return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):node.type==='dialog'&&!node.props.open?[]:[node,...nodes(node.props?.children)];}
const text=tree=>nodes(tree).flatMap(n=>[n.props?.children].flat().filter(v=>typeof v==='string'||typeof v==='number')).join(' ');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(initial=pickup,{lostResponse=false,fail=false}={}) {
  let booking={...initial},cursor=0,disabled=false,calls=[],release,online=true,updates=0;
  let savedBooking={...initial};
  const slots=[],cleanups=[];
  const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=v;}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;cleanups.push(fn());}}};
  const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  const fetch=async(url,options={})=>{calls.push({url,...options});
    if(options.method!=='POST')return Response.json({booking:savedBooking});
    if(release)await release;
    if(fail)return Response.json({error:'Rejected before saving'},{status:409});
    const {action}=JSON.parse(options.body);savedBooking={...savedBooking,[action==='PICKUP'?'customerPickupConfirmedAt':'customerDropoffConfirmedAt']:'2026-11-18T02:00:00Z',updatedAt:'2026-11-18T02:00:00Z'};
    if(lostResponse)throw Error('Failed to fetch');return Response.json({booking:savedBooking});};
  const exports={};
  vm.runInNewContext(source,{exports,AbortController,AbortSignal,Error,navigator:{get onLine(){return online;}},fetch,
    require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return runtime;if(name==='@/components/ui/button')return{Button:'button'};
      if(name==='@/components/ui/dialog')return Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'].map(key=>[key,key==='Dialog'?'dialog':key]));
      if(name==='@/lib/customer-request')return{customerResponse:async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);return data;}};
      if(name==='@/lib/booking-client-timing')return{startBookingTiming:()=>({headers:{},response(){},finish(){}})};
      if(name==='@/lib/booking-mutation-client')return{savedMutation:async(url,saved)=>{const data=await(await fetch(url)).json();return saved(data)?data:null;}};
      throw Error(name);}});
  const render=()=>{cursor=0;return exports.CustomerRideConfirmations({ride:booking,disabled,onUpdated:update=>{updates++;booking={...booking,...update};}});};
  const find=label=>nodes(render()).find(n=>n.type==='button'&&n.props.children===label);
  return{render,find,calls,setOffline(){online=false;},setDisabled(value=true){disabled=value;},hold(){let done;release=new Promise(resolve=>{done=resolve;});return done;},unmount(){cleanups.forEach(fn=>fn?.());},get booking(){return booking;},get updates(){return updates;},setStatus(status){booking={...booking,status};}};
}
test('the pickup button requires a second confirmation and records the correct action once',async()=>{
  const h=harness();assert.match(text(h.render()),/Are you on board/);assert.equal(h.calls.length,0);
  h.find('I’m on board').props.onClick();assert.equal(h.calls.length,0);assert.match(text(h.render()),/Confirm you’re on board/);
  await h.find('Confirm pickup').props.onClick();assert.equal(h.calls.length,1);assert.equal(JSON.parse(h.calls[0].body).action,'PICKUP');assert.match(text(h.render()),/Pickup confirmed/);assert.equal(h.find('I’m on board'),undefined);
});
test('not yet dismisses without a mutation; inactive and delivery bookings have no controls',()=>{
  const h=harness();h.find('I’m on board').props.onClick();h.find('Not yet').props.onClick();assert.equal(h.calls.length,0);
  for(const state of [{...pickup,type:'DELIVERY'},{...pickup,status:'ACCEPTED'},{...pickup,status:'CANCELLED'},{...pickup,status:'DELIVERED'}])assert.equal(harness(state).render(),null);
});
test('drop-off is offered only during the trip after the saved pickup acknowledgement',async()=>{
  const h=harness({...pickup,status:'IN_TRANSIT',customerPickupConfirmedAt:'2026-11-18T01:01:00Z'});
  h.find('I’ve arrived at drop-off').props.onClick();assert.match(text(h.render()),/Booked destination/);assert.match(text(h.render()),/Payment confirmation is a separate step/);
  await h.find('Confirm drop-off').props.onClick();assert.equal(JSON.parse(h.calls[0].body).action,'DROPOFF');assert.match(text(h.render()),/Arrival confirmed/);assert.equal(h.find('I’ve arrived at drop-off'),undefined);
});
test('reopening with saved acknowledgements does not ask the customer to confirm again',()=>{
  const h=harness({...pickup,status:'IN_TRANSIT',customerPickupConfirmedAt:'saved',customerDropoffConfirmedAt:'saved'});assert.match(text(h.render()),/Arrival confirmed/);assert.equal(h.find('I’m on board'),undefined);assert.equal(h.find('I’ve arrived at drop-off'),undefined);
});
test('rapid taps share a pending request and offline or paused updates never submit',async()=>{
  const h=harness(),done=h.hold();h.find('I’m on board').props.onClick();const button=h.find('Confirm pickup');const first=button.props.onClick();await button.props.onClick();assert.equal(h.calls.length,1);assert.equal(h.find('Saving confirmation…').props.disabled,true);done();await first;
  const offline=harness();offline.find('I’m on board').props.onClick();offline.setOffline();await offline.find('Confirm pickup').props.onClick();assert.equal(offline.calls.length,0);assert.match(text(offline.render()),/Reconnect/);
  const paused=harness();paused.setDisabled();assert.equal(paused.find('I’m on board').props.disabled,true);
});
test('a lost response recovers the saved acknowledgement with one read and no resubmission',async()=>{
  const h=harness(pickup,{lostResponse:true});h.find('I’m on board').props.onClick();await h.find('Confirm pickup').props.onClick();await flush();await flush();assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.calls.length,2);assert.match(text(h.render()),/Your confirmation is saved/);assert.equal(h.updates,1);
});
test('definite errors retain the confirmation form and allow the customer to cancel and refresh',async()=>{
  const h=harness(pickup,{fail:true});h.find('I’m on board').props.onClick();await h.find('Confirm pickup').props.onClick();await flush();assert.match(text(h.render()),/Rejected before saving/);assert.equal(h.booking.customerPickupConfirmedAt,null);assert.equal(h.calls.length,1);
  h.find('Not yet').props.onClick();await h.find('Refresh ride').props.onClick();assert.equal(h.calls.length,2);assert.match(text(h.render()),/Ride details refreshed/);
});
test('closing the view while saving does not apply a late response to another screen',async()=>{
  const h=harness(),done=h.hold();h.find('I’m on board').props.onClick();const pending=h.find('Confirm pickup').props.onClick();h.unmount();done();await pending;await flush();assert.equal(h.updates,0);
});
