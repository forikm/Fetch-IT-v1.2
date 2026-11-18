const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function route({guest=false}={}) {
 const calls=[];class RideConfirmationError extends Error{constructor(message,status=409){super(message);this.status=status;}}
 const deps={
  'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/db':{db:{fixture:true}},
  '@/lib/customer-access':{requireCustomer:async()=>{if(guest)throw Object.assign(Error('Please sign in again.'),{status:401});return{uid:'owner',name:'Owner',role:'CUSTOMER'};},customerErrorResponse:error=>Response.json({error:error.message},{status:error.status??503})},
  '@/lib/request-guard':{limitRequests:async()=>{},RateLimitError:class extends Error{},withRequestLog:(_,fn)=>fn},
  '@/lib/booking-telemetry':{timeBooking:(_,fn)=>fn(),withBookingTelemetry:(_,fn)=>fn},
  '@/lib/ride-confirmations':{RideConfirmationError,confirmCustomerRide:async(db,id,actor,action)=>{
    calls.push({db,id,actor,action});if(action!=='PICKUP'&&action!=='DROPOFF')throw new RideConfirmationError('Choose pickup or drop-off confirmation.',400);
    return{id,status:'PICKED_UP',updatedAt:'saved',customerPickupConfirmedAt:'saved',customerDropoffConfirmedAt:null,customerId:actor.uid,totalFare:999};}},
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/bookings/[id]/ride-confirmation/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name];}});
 return{calls,module:exports,post:body=>exports.POST({json:async()=>body},{params:Promise.resolve({id:'ride'})})};
}
test('the endpoint authenticates before handing any request to the confirmation service',async()=>{
 const h=route({guest:true}),response=await h.post({action:'PICKUP'});assert.equal(response.status,401);assert.equal(h.calls.length,0);
});
test('the endpoint uses the authenticated customer and URL booking, ignoring forged identity or state',async()=>{
 const h=route(),response=await h.post({action:'PICKUP',uid:'another',customerId:'another',status:'DELIVERED',customerPickupConfirmedAt:'forged'});
 assert.equal(response.status,200);assert.equal(h.calls[0].id,'ride');assert.equal(h.calls[0].actor.uid,'owner');assert.equal(h.calls[0].action,'PICKUP');
 const data=await response.json();assert.equal(data.booking.customerPickupConfirmedAt,'saved');assert.equal(data.booking.status,'PICKED_UP');assert.equal(data.booking.totalFare,undefined);assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('malformed or unsupported confirmation actions return a clear 400 response',async()=>{
 for(const body of [null,{}, {action:'DELIVERED'}])assert.equal((await route().post(body)).status,400);
 assert.equal(route().module.GET,undefined);
});
