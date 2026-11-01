// Requires an explicitly isolated schema and localhost apps. External email,
// browser maps and push transport must be disabled by the lab launcher.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const stateFile=process.argv[2],envFile=process.argv[3];
if(!stateFile||!envFile)throw Error('Pass isolated lab state and environment paths.');
const state=JSON.parse(fs.readFileSync(stateFile,'utf8')),env=JSON.parse(fs.readFileSync(envFile,'utf8'));
const url=new URL(env.DATABASE_URL);
assert(/^fetch_rider_lab_[a-f0-9]{32}$/.test(state.schema));assert.equal(url.searchParams.get('schema'),state.schema);assert.equal(env.LOCAL_DISABLE_PUSH_TRANSPORT,'1');assert.equal(env.GMAIL_APP_PASSWORD,'');
for(const base of [state.customerUrl,state.riderUrl])assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const db=new PrismaClient({datasourceUrl:url.toString()}),passes=[];
const pass=title=>{passes.push(title);console.log('PASS '+title);};
function actor(base){const jar=new Map();return async(route,body,method=body?'POST':'GET')=>{const response=await fetch(base+route,{method,headers:{cookie:Array.from(jar,([k,v])=>k+'='+v).join('; '),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});for(const line of response.headers.getSetCookie()){const [key,...value]=line.split(';')[0].split('=');jar.set(key,value.join('='));}const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw Error(`${route}: non-JSON ${response.status}`);}return{status:response.status,data};};}
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
const customer=actor(state.customerUrl),riders=[];
const fix=(index=0)=>({lat:16.0206+.002*index,lng:120.2321+.003*index,accuracy:10,capturedAt:Date.now()});
async function waitFor(fn,message,timeout=35000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,500));}throw Error(message);}
async function create(){const body={type:'RIDE',vehicleClass:'SEDAN',paymentMethod:'CASH',passengers:1,pickup:{label:'Local test · Lingayen Public Market',lat:16.0206,lng:120.2321},dropoff:{label:'Local test · Dagupan City Plaza',lat:16.0434,lng:120.334}};const {booking}=ok(await customer('/api/bookings',body));return booking;}
async function cancel(booking){ok(await customer(`/api/bookings/${booking.id}/cancel`,{reason:'Isolated automated matching verification complete.'}));}
async function main(){
 assert.equal((await db.$queryRaw`SELECT current_schema() AS name`)[0].name,state.schema);
 const salt=crypto.randomBytes(16).toString('hex'),passwordHash=salt+':'+crypto.scryptSync(state.password,salt,64).toString('hex');
 async function seed(email,name,role,index){const user=await db.user.create({data:{email,name,role,authIdentities:{create:{provider:'PASSWORD',providerUserId:email,passwordHash}},...(role==='RIDER'?{riderProfile:{create:{vehicleClass:'SEDAN',vehiclePlate:'LOCAL-'+index}},riderPresence:{create:{isOnline:false}},riderApprovals:{create:[{vehicleClass:'SEDAN',service:'RIDE',source:'OWNER_PERSONA'},{vehicleClass:'SEDAN',service:'DELIVERY',source:'OWNER_PERSONA'}]}}:{})}});return user;}
 const tag=crypto.randomBytes(3).toString('hex');state.customer=await seed(`customer-${tag}@matching.fetchit.invalid`,'Local Matching Customer','CUSTOMER');
 for(let i=0;i<3;i++){const user=await seed(`rider-${i}-${tag}@matching.fetchit.invalid`,'Local Rider '+(i+1),'RIDER',i);riders.push({user,http:actor(state.riderUrl)});}
 state.riders=riders.map(r=>({id:r.user.id,email:r.user.email}));fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
 ok(await customer('/api/auth/login',{email:state.customer.email,password:state.password,role:'CUSTOMER'}));
 for(const rider of riders)ok(await rider.http('/api/auth/login',{email:rider.user.email,password:state.password,role:'RIDER'}));
 assert.equal((await riders[0].http('/api/rider/status',{online:true,notificationPermission:'granted',location:fix()})).status,409);
 assert.equal((await db.riderPresence.findUnique({where:{userId:riders[0].user.id}})).isOnline,false);pass('server rejects going online without an enabled device subscription');
 for(const [i,rider]of riders.entries()){
  const p256dh=crypto.createECDH('prime256v1').generateKeys().toString('base64url'),auth=crypto.randomBytes(16).toString('base64url');
  ok(await rider.http('/api/push/subscription',{endpoint:'https://fcm.googleapis.com/fcm/send/local-matching-'+crypto.randomUUID(),keys:{p256dh,auth}}));
  assert.equal((await rider.http('/api/rider/status',{online:true,notificationPermission:'denied',location:fix(i)})).status,409);
  ok(await rider.http('/api/rider/status',{online:true,notificationPermission:'granted',location:fix(i)}));
 }
 pass('permission refusal leaves riders offline; a subscribed device plus fresh GPS enables online');
 const first=await create();
 // Only database reads here: matching must continue without foreground polls.
 const matched=await waitFor(async()=>{const b=await db.booking.findUnique({where:{id:first.id}});return b.status==='MATCHED'?b:null;},'Background matching did not offer the booking');
 assert.equal(matched.riderId,riders[0].user.id);assert(matched.assignmentExpiresAt>Date.now());
 assert.equal((await db.bookingEvent.count({where:{bookingId:first.id,toStatus:'MATCHED'}})),1);pass('server offers the nearest eligible rider once without either app polling');
 assert(ok(await riders[0].http('/api/rider/available?includeMatched=true')).jobs.some(b=>b.id===first.id));
 assert(!ok(await riders[1].http('/api/rider/available?includeMatched=true')).jobs.some(b=>b.id===first.id));
 assert.equal((await riders[1].http(`/api/bookings/${first.id}`,{status:'ACCEPTED'},'PATCH')).status,409);pass('exclusive offers are hidden from other riders and cannot be stolen');
 await db.riderPresence.update({where:{userId:riders[0].user.id},data:{locationAt:new Date(Date.now()-45000)}});
 assert.equal((await riders[0].http(`/api/bookings/${first.id}`,{status:'ACCEPTED'},'PATCH')).status,409);
 ok(await riders[0].http('/api/rider/location',fix()));
 const accepted=await Promise.all([riders[0].http(`/api/bookings/${first.id}`,{status:'ACCEPTED'},'PATCH'),riders[0].http(`/api/bookings/${first.id}`,{status:'ACCEPTED'},'PATCH')]);accepted.forEach(ok);
 assert.equal(await db.bookingEvent.count({where:{bookingId:first.id,toStatus:'ACCEPTED'}}),1);
 assert.equal(ok(await customer('/api/bookings/status?onlyTracked=1&ids='+first.id)).bookings[0].status,'ACCEPTED');pass('fresh location is required at acceptance; double taps create one event and Customer synchronizes');
 await cancel(first);
 for(const [i,rider]of riders.entries())ok(await rider.http('/api/rider/location',fix(i)));
 const second=await create();await waitFor(async()=>{const b=await db.booking.findUnique({where:{id:second.id}});return b.riderId===riders[0].user.id&&b.status==='MATCHED';},'No first offer');
 ok(await riders[0].http(`/api/bookings/${second.id}/release`,{reason:'Local test decline'}));
 await waitFor(async()=>{const b=await db.booking.findUnique({where:{id:second.id}});return b.riderId===riders[1].user.id&&b.status==='MATCHED';},'Decline did not advance to next rider');pass('declining advances to the next eligible rider');
 await db.$transaction([db.booking.update({where:{id:second.id},data:{assignmentExpiresAt:new Date(Date.now()-1000)}}),db.autoDispatch.update({where:{bookingId:second.id},data:{nextAt:new Date(Date.now()-1000)}})]);
 await waitFor(async()=>{const b=await db.booking.findUnique({where:{id:second.id}});return b.riderId===riders[2].user.id&&b.status==='MATCHED';},'Expired offer did not advance');pass('expired offer advances on the server without foreground requests');
 await db.$transaction([db.booking.update({where:{id:second.id},data:{assignmentExpiresAt:new Date(Date.now()-1000)}}),db.autoDispatch.update({where:{bookingId:second.id},data:{nextAt:new Date(Date.now()-1000)}})]);
 await waitFor(async()=>{const row=await db.autoDispatch.findUnique({where:{bookingId:second.id},include:{booking:true}});return row.phase==='OPEN'&&row.booking.status==='PENDING'&&!row.booking.riderId;},'Offer retry limit did not release to open requests');
 assert.equal((await db.autoDispatch.findUnique({where:{bookingId:second.id}})).attempts,3);
 for(const [i,rider]of riders.entries())ok(await rider.http('/api/rider/location',fix(i)));
 assert(ok(await riders[0].http('/api/rider/available?includeMatched=true')).jobs.some(booking=>booking.id===second.id));
 pass('three unanswered offers release the job to the open list, where riders can choose it themselves');await cancel(second);
 await db.riderPresence.updateMany({where:{userId:{in:riders.map(r=>r.user.id)}},data:{locationAt:new Date(Date.now()-180000)}});
 const third=await create();await waitFor(async()=>((await db.autoDispatch.findUnique({where:{bookingId:third.id}})).phase==='OPEN'),'Stale riders should fall back');
 assert.equal((await db.booking.findUnique({where:{id:third.id}})).riderId,null);assert.equal(ok(await riders[0].http('/api/rider/stats')).matchingReady,false);pass('stale saved GPS pauses matching and is never presented as a current location');await cancel(third);
 for(const [i,rider]of riders.entries())ok(await rider.http('/api/rider/location',fix(i)));
 const simultaneous=await Promise.all([create(),create()]);
 const two=await waitFor(async()=>{const bookings=await db.booking.findMany({where:{id:{in:simultaneous.map(b=>b.id)}}});return bookings.length===2&&bookings.every(b=>b.status==='MATCHED')?bookings:null;},'Concurrent requests did not receive separate available riders');
 assert.notEqual(two[0].riderId,two[1].riderId);pass('concurrent customer requests cannot reserve the same rider twice');
 await Promise.all(simultaneous.map(cancel));
 await new Promise(resolve=>setTimeout(resolve,6000));
 assert.equal(await db.booking.count({where:{id:{in:simultaneous.map(b=>b.id)},status:'CANCELLED'}}),2);
 assert.equal(await db.autoDispatch.count({where:{bookingId:{in:simultaneous.map(b=>b.id)},phase:'DONE'}}),2);pass('cancellation stops both background workers and cannot be overwritten by later assignment');
 ok(await riders[0].http('/api/push/subscription',undefined,'DELETE'));
 assert.equal((await db.riderPresence.findUnique({where:{userId:riders[0].user.id}})).isOnline,false);pass('turning off this device’s notifications also turns its availability off');
 state.integration={passed:passes.length,passes};fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
 fs.writeFileSync(path.join(path.dirname(stateFile),'automatching-results.json'),JSON.stringify({schema:state.schema,passed:passes.length,passes,externalPush:'disabled',externalEmail:'disabled'},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
