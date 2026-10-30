/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const root=path.resolve(__dirname,".."),rider=process.env.PICKUP_RIDER_ROOT||path.resolve(root,"../fetch-rider");
function load(file,mocks={}){
 const exports={};const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function("exports","require",code)(exports,name=>Object.hasOwn(mocks,name)?mocks[name]:require(name));return exports;
}
const progress=load(path.join(root,"src/lib/pickup-progress.ts"));
class AccessError extends Error{constructor(message,status){super(message);this.status=status;}}
const errors=error=>Response.json({error:error.message},{status:error.status??503});
const at=new Date("2026-10-30T01:00:00Z");
function fixture(){
 let actor={uid:"driver",name:"Driver",role:"RIDER"},owner="customer",writes=0;
 const notifications=[];
 const booking={id:"booking",refCode:"FIT-1",customerId:"customer",riderId:"driver",type:"RIDE",status:"ACCEPTED",matchedAt:at,createdAt:at,events:[]};
 const db={
  async $transaction(fn){return fn(db);},
  async $queryRawUnsafe(sql,id){assert.match(sql,/WHERE "id" = \$1 FOR UPDATE/);assert.equal(id,"booking");},
  booking:{
   async findUnique(){return booking;},
   async findFirst({where}){return (where.riderId&&where.riderId!==booking.riderId)||(where.customerId&&where.customerId!==booking.customerId)?null:booking;},
   async update(){writes++;return booking;},
  },
  bookingEvent:{async create({data}){const event={id:"event-"+writes,...data,createdAt:new Date(at.getTime()+1000+writes)};booking.events.unshift(event);return event;}},
  customerNotification:{async create({data}){notifications.push(data);return data;}},
 };
 const riderApi=load(path.join(rider,"src/app/api/bookings/[id]/pickup-progress/route.ts"),{
  "next/server":{NextResponse:Response},"@/lib/db":{db},"@/lib/pickup-progress":progress,
  "@/lib/rider-access":{RiderError:AccessError,riderErrorResponse:errors,getRiderSession:async()=>actor,requireRider:async session=>{if(!session)throw new AccessError("Sign in",401);if(session.role!=="RIDER")throw new AccessError("Rider required",403);return session;}},
  "@/lib/request-guard":{limitRequests:async()=>{},RateLimitError:class extends Error{},withRequestLog:(_,handler)=>handler},
 });
 const customerApi=load(path.join(root,"src/app/api/bookings/[id]/pickup-progress/route.ts"),{
  "next/server":{NextResponse:Response},"@/lib/db":{db},"@/lib/pickup-progress":progress,
  "@/lib/pickup-eta":{pickupEstimate:(_,fix)=>fix?{minutes:5,locationAt:fix.createdAt.toISOString()}:null},
  "@/lib/customer-access":{CustomerError:AccessError,customerErrorResponse:errors,requireCustomer:async()=>{if(!owner)throw new AccessError("Sign in",401);return{uid:owner};}},
 });
 const params={params:Promise.resolve({id:"booking"})};
 return {booking,notifications,setActor:value=>{actor=value;},setOwner:value=>{owner=value;},get writes(){return writes;},
  post:stage=>riderApi.POST(new Request("https://fixture.invalid/api",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({stage})}),params),
  getRider:()=>riderApi.GET(new Request("https://fixture.invalid/api"),params),
  getCustomer:()=>customerApi.GET(new Request("https://fixture.invalid/api"),params)};
}
test("driver confirmations advance pickup progress and produce one customer notification per change",async()=>{
 const app=fixture();
 assert.equal((await(await app.getCustomer()).json()).pickupProgress.stage,"ACCEPTED");
 assert.equal((await app.post("HEADING")).status,200);
 assert.equal((await(await app.getCustomer()).json()).pickupProgress.stage,"HEADING");
 assert.equal((await app.post("ARRIVED")).status,200);
 const response=await app.getCustomer(),data=await response.json();
 assert.equal(data.pickupProgress.stage,"ARRIVED");assert(data.pickupProgress.at);
 assert.equal(response.headers.get("cache-control"),"private, no-store");
 assert.deepEqual(Object.keys(data),["pickupProgress"]);
 assert.equal(app.notifications.length,2);
 assert.match(app.notifications[1].title,/arrival/);
 assert.equal((await app.post("ARRIVED")).status,200);assert.equal(app.notifications.length,2);
 assert.equal((await app.post("HEADING")).status,409);assert.equal(app.writes,2);
});
test("pickup progress rejects invalid, non-rider and unassigned callers without writes",async()=>{
 const app=fixture();
 assert.equal((await app.post("DELIVERED")).status,400);
 app.setActor(null);assert.equal((await app.post("ARRIVED")).status,401);
 app.setActor({uid:"customer",role:"CUSTOMER"});assert.equal((await app.post("ARRIVED")).status,403);
 app.setActor({uid:"other",name:"Other",role:"RIDER"});assert.equal((await app.post("ARRIVED")).status,403);
 assert.equal((await app.getRider()).status,404);assert.equal(app.writes,0);assert.equal(app.notifications.length,0);
});
test("only an accepted ride can receive pickup progress",async()=>{
 for(const status of ["PENDING","MATCHED","PICKED_UP","IN_TRANSIT","DELIVERED","CANCELLED"]){
  const app=fixture();app.booking.status=status;assert.equal((await app.post("ARRIVED")).status,409);assert.equal(app.writes,0);
 }
 const app=fixture();app.booking.type="DELIVERY";assert.equal((await app.post("HEADING")).status,409);
});
test("customers can only read their own pickup progress",async()=>{
 const app=fixture();app.setOwner("other");assert.equal((await app.getCustomer()).status,404);
 app.setOwner(null);assert.equal((await app.getCustomer()).status,401);
});
test("arrival reports from an earlier assignment never appear after reassignment",async()=>{
 const app=fixture();await app.post("ARRIVED");
 app.booking.riderId="new-driver";
 assert.equal((await(await app.getCustomer()).json()).pickupProgress.stage,"ACCEPTED");
 app.booking.riderId="driver";app.booking.matchedAt=new Date(at.getTime()+10000);
 assert.equal((await(await app.getCustomer()).json()).pickupProgress.stage,"ACCEPTED");
});
test("legacy accepted rides can report arrival using their creation timestamp",async()=>{
 const app=fixture();app.booking.matchedAt=null;
 assert.equal((await app.post("ARRIVED")).status,200);
 assert.equal((await(await app.getCustomer()).json()).pickupProgress.stage,"ARRIVED");
 assert.equal(fs.readFileSync(path.join(root,"src/lib/pickup-progress.ts"),"utf8"),fs.readFileSync(path.join(rider,"src/lib/pickup-progress.ts"),"utf8"));
});

test("pickup estimates use fresh assignment-scoped GPS and never reuse full trip duration",()=>{
 const constants=load(path.join(root,"src/lib/constants.ts"));
 const fare=load(path.join(root,"src/lib/fare.ts"),{"@/lib/constants":constants,"./platform-policy":{configuredSurge:()=>1}});
 const {pickupEstimate}=load(path.join(root,"src/lib/pickup-eta.ts"),{"./constants":constants,"./fare":fare});
 const now=Date.parse("2026-10-30T02:00:00Z");
 const booking={lat:16.0206,lng:120.2321,vehicleClass:"SEDAN",riderId:"driver",matchedAt:new Date(now-60000),createdAt:new Date(now-120000),etaMinutes:999};
 const fix={riderId:"driver",lat:16.025,lng:120.2321,createdAt:new Date(now-1000)};
 const close=pickupEstimate(booking,fix,now);
 const far=pickupEstimate(booking,{...fix,lat:16.08},now);
 assert(close.minutes>=1);assert(far.minutes>close.minutes);assert.notEqual(close.minutes,999);
 assert.equal(close.locationAt,fix.createdAt.toISOString());
 for(const invalid of [
  {...fix,riderId:"previous-driver"}, {...fix,createdAt:new Date(now-91000)},
  {...fix,createdAt:new Date(now+31000)}, {...fix,createdAt:new Date(now-61000)},
  {...fix,lat:NaN}, {...fix,lng:200},
 ]) assert.equal(pickupEstimate(booking,invalid,now),null);
 assert.equal(pickupEstimate(booking,null,now),null);
});
test("customer pickup estimates appear only while the driver reports heading to pickup",async()=>{
 const app=fixture();app.booking.liveLocation={createdAt:new Date()};
 let data=await(await app.getCustomer()).json();assert.equal(data.pickupProgress.etaMinutes,null);
 await app.post("HEADING");data=await(await app.getCustomer()).json();assert.equal(data.pickupProgress.etaMinutes,5);
 assert.equal(Object.hasOwn(data.pickupProgress,"lat"),false);
 await app.post("ARRIVED");data=await(await app.getCustomer()).json();assert.equal(data.pickupProgress.etaMinutes,null);
});
