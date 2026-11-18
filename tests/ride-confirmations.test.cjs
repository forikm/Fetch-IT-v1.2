const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function loader(stubs={}) {
  const cache={};return function load(file) {
    file=path.resolve(file);if(cache[file])return cache[file];const exports={};cache[file]=exports;
    const requireModule=name=>Object.hasOwn(stubs,name)?stubs[name]:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:requireModule,Date,console});return exports;
  };
}
const actor={uid:'customer',name:'Customer',role:'CUSTOMER'};
const base={id:'ride',customerId:'customer',riderId:'driver',type:'RIDE',status:'PICKED_UP',pickedUpAt:new Date('2026-11-18T01:00:00Z'),customerPickupConfirmedAt:null,customerDropoffConfirmedAt:null,totalFare:55};
function fixture(initial=base,{auditFails=false}={}) {
  let booking=structuredClone(initial),events=[],locks=0,tail=Promise.resolve();
  const tx={
    $queryRaw:async(strings,...args)=>{assert.match(strings.join('?'),/FOR UPDATE/);assert.equal(args[0],'ride');locks++;},
    booking:{findUnique:async()=>booking,update:async({data})=>{assert.ok(locks);booking={...booking,...data};return booking;}},
    bookingEvent:{create:async({data})=>{if(auditFails)throw Error('Audit unavailable');const event={id:'event'+events.length,...data};events.push(event);return event;}},
    autoDispatch:{updateMany:async()=>assert.fail('Acknowledgements must not change dispatch state')},
  };
  const db={$transaction(fn){const run=tail.then(async()=>{const previous=structuredClone(booking),previousEvents=[...events];try{return await fn(tx);}catch(e){booking=previous;events=previousEvents;throw e;}});tail=run.catch(()=>{});return run;}};
  const load=loader({'./booking-transaction':{bookingTransaction:(db,work)=>db.$transaction(work)},'./rider-push-tasks':{queueRiderPushTask:()=>assert.fail('No duplicate assignment push expected')}});
  const api=load('src/lib/ride-confirmations.ts');
  return{confirm:(action,who=actor)=>api.confirmCustomerRide(db,'ride',who,action),setStatus:status=>{booking={...booking,status};},get booking(){return booking;},get events(){return events;},get locks(){return locks;}};
}
test('pickup acknowledgement records the owner and timestamp without advancing the trip or fare',async()=>{
  const f=fixture(),saved=await f.confirm('PICKUP');
  assert.ok(saved.customerPickupConfirmedAt instanceof Date);assert.equal(saved.status,'PICKED_UP');assert.equal(saved.totalFare,55);
  assert.equal(f.events.length,1);assert.equal(f.events[0].action,'CUSTOMER_PICKUP_CONFIRMED');assert.equal(f.events[0].actorId,actor.uid);assert.equal(f.events[0].actorRole,'CUSTOMER');
  assert.equal(f.events[0].fromStatus,f.events[0].toStatus);
});
test('pickup is unavailable before driver OTP verification, after cancellation, and after completion',async()=>{
  for(const status of ['PENDING','MATCHED','ACCEPTED','CANCELLED','DELIVERED']) {
    const f=fixture({...base,status});await assert.rejects(f.confirm('PICKUP'),e=>e.status===409);assert.equal(f.events.length,0);
  }
  const f=fixture({...base,pickedUpAt:null});await assert.rejects(f.confirm('PICKUP'),e=>e.status===409);
});
test('guests, riders, another customer, deliveries, and unassigned bookings cannot confirm',async()=>{
  for(const who of [{...actor,role:'RIDER'},{...actor,role:'ADMIN'}])await assert.rejects(fixture().confirm('PICKUP',who),e=>e.status===403);
  await assert.rejects(fixture().confirm('PICKUP',{...actor,uid:'another'}),e=>e.status===404);
  for(const booking of [{...base,type:'DELIVERY'},{...base,riderId:null}])await assert.rejects(fixture(booking).confirm('PICKUP'),e=>e.status===409);
  await assert.rejects(fixture(null).confirm('PICKUP'),e=>e.status===404);
});
test('invalid actions never acquire a booking lock or write data',async()=>{
  for(const action of [undefined,null,'DELIVERED','pickup',{},['PICKUP']]){const f=fixture();await assert.rejects(f.confirm(action),e=>e.status===400);assert.equal(f.locks,0);assert.equal(f.events.length,0);}
});
test('retries and concurrent duplicate taps keep the original confirmation and one audit event',async()=>{
  const f=fixture();const [first,second]=await Promise.all([f.confirm('PICKUP'),f.confirm('PICKUP')]);
  assert.equal(first.customerPickupConfirmedAt.getTime(),second.customerPickupConfirmedAt.getTime());assert.equal(f.events.length,1);
  f.setStatus('IN_TRANSIT');const reopened=await f.confirm('PICKUP');assert.equal(reopened.customerPickupConfirmedAt.getTime(),first.customerPickupConfirmedAt.getTime());assert.equal(f.events.length,1);
});
test('drop-off requires an in-progress ride with customer pickup already confirmed',async()=>{
  for(const booking of [base,{...base,status:'IN_TRANSIT'},{...base,status:'DELIVERED',customerPickupConfirmedAt:new Date()}]) {
    const f=fixture(booking);await assert.rejects(f.confirm('DROPOFF'),e=>e.status===409);assert.equal(f.events.length,0);
  }
  const f=fixture();await f.confirm('PICKUP');f.setStatus('IN_TRANSIT');const saved=await f.confirm('DROPOFF');
  assert.ok(saved.customerDropoffConfirmedAt);assert.equal(saved.status,'IN_TRANSIT');assert.equal(f.events[1].action,'CUSTOMER_DROPOFF_CONFIRMED');
  f.setStatus('DELIVERED');const retry=await f.confirm('DROPOFF');assert.equal(retry.customerDropoffConfirmedAt,saved.customerDropoffConfirmedAt);assert.equal(f.events.length,2);
});
test('an already in-progress legacy ride can acknowledge pickup before acknowledging arrival',async()=>{
  const f=fixture({...base,status:'IN_TRANSIT'});await f.confirm('PICKUP');await f.confirm('DROPOFF');assert.equal(f.events.length,2);
});
test('an audit failure rolls back the acknowledgement as well as its timestamp',async()=>{
  const f=fixture(base,{auditFails:true});await assert.rejects(f.confirm('PICKUP'),/Audit unavailable/);assert.equal(f.booking.customerPickupConfirmedAt,null);assert.equal(f.events.length,0);
});
test('rider status guards require both customer acknowledgements, without changing delivery rules',()=>{
  const {rideConfirmationError:guard}=loader()('src/lib/ride-confirmation-policy.ts');
  assert.match(guard(base,'IN_TRANSIT'),/on board/);assert.match(guard(base,'DELIVERED'),/on board/);
  const picked={...base,customerPickupConfirmedAt:new Date()};assert.equal(guard(picked,'IN_TRANSIT'),null);assert.match(guard(picked,'DELIVERED'),/drop-off/);
  assert.equal(guard({...picked,customerDropoffConfirmedAt:new Date()},'DELIVERED'),null);
  assert.equal(guard({...base,type:'DELIVERY'},'DELIVERED'),null);assert.equal(guard(base,'PICKED_UP'),null);
});
