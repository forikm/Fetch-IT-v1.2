// Run against built local apps with a fixture ORS provider and a disposable
// schema. This test never connects to the real routing provider or sends mail.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const config=JSON.parse(fs.readFileSync(process.env.ROUTING_TEST_ENV_FILE,'utf8'));
const riderConfig=JSON.parse(fs.readFileSync(process.env.ROUTING_TEST_RIDER_ENV_FILE,'utf8'));
const actors=JSON.parse(fs.readFileSync(process.env.ROUTING_TEST_ACTORS_FILE,'utf8'));
const url=new URL(config.DATABASE_URL),schema=url.searchParams.get('schema');
assert(/^fetch_rider_lab_[a-f0-9]{32}$/.test(schema));assert.equal(schema,actors.schema);
assert.equal(new URL(riderConfig.DATABASE_URL).searchParams.get('schema'),schema);
for(const actor of [actors.customer,actors.rider])assert(actor.email.endsWith('@routing.fetchit.invalid'));
const db=new PrismaClient({datasourceUrl:url.toString()}),checks=[];
function cookie(user,app='customer'){const value=Buffer.from(JSON.stringify({uid:user.id,name:user.name,email:user.email,role:user.role,iat:Date.now(),exp:Date.now()+3600000})).toString('base64url');return 'fetchit_session='+value+'.'+crypto.createHmac('sha256',(app==='rider'?riderConfig:config).SESSION_SECRET).update(value).digest('base64url');}
async function request(app,route,actor,body,status=200,headers={}){const origin=app==='rider'?'http://127.0.0.1:3077':'http://127.0.0.1:3076';const res=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(actor?{cookie:cookie(actor,app)}:{}),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await res.json();assert.equal(res.status,status,route+': '+JSON.stringify(data).slice(0,200));return data;}
const quoteBody={type:'RIDE',pickup:{lat:16.0206,lng:120.2321,label:'Lingayen Public Market'},dropoff:{lat:16.0434,lng:120.334,label:'Dagupan City Plaza'},vehicleClass:'MOTORCYCLE',passengers:1,paymentMethod:'CASH'};
async function patch(id,status,actor){const res=await fetch('http://127.0.0.1:3077/api/bookings/'+id,{method:'PATCH',headers:{cookie:cookie(actor,'rider'),'Content-Type':'application/json'},body:JSON.stringify({status})});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data.booking;}
async function usage(){return(await db.$queryRaw`SELECT COUNT(*)::integer AS count FROM "RoadRouteRequest" WHERE "account"=${crypto.createHash('sha256').update('LOCAL-TEST-FIXTURE-ONLY').digest('hex')}`)[0].count;}
(async()=>{try{
 assert.equal((await db.$queryRaw`SELECT current_schema() AS name`)[0].name,schema);
 await db.riderPresence.update({where:{userId:actors.rider.id},data:{isOnline:true}});
 await request('customer','/api/fare/estimate',null,quoteBody,401);checks.push('Unauthenticated quotes rejected');
 const quote=await request('customer','/api/fare/estimate',actors.customer,quoteBody);assert.equal(quote.routingSource,'openrouteservice');assert.equal(quote.distanceKm,13.5);assert.equal(quote.etaMinutes,25);assert(quote.routeQuote);checks.push('Road metrics drive the fare quote');
 const before=await usage();await request('customer','/api/road-route',actors.customer,quoteBody);assert.equal(await usage(),before);checks.push('Customer quote/map share a cached provider request');
 await request('customer','/api/bookings',actors.customer,{...quoteBody,routeQuote:quote.routeQuote+'x'},409,{'Idempotency-Key':crypto.randomUUID()});
 await request('customer','/api/bookings',actors.customer,{...quoteBody,dropoff:{...quoteBody.dropoff,lng:120.33},routeQuote:quote.routeQuote},409,{'Idempotency-Key':crypto.randomUUID()});checks.push('Forged and changed-route quotes rejected');
 const key=crypto.randomUUID(),body={...quoteBody,routeQuote:quote.routeQuote};const created=await request('customer','/api/bookings',actors.customer,body,200,{'Idempotency-Key':key});const retry=await request('customer','/api/bookings',actors.customer,body,200,{'Idempotency-Key':key});assert.equal(created.booking.id,retry.booking.id);assert.equal(created.booking.totalFare,quote.fare.totalFare);assert.equal(await usage(),before);checks.push('Confirmation preserves reviewed fare, retry key and quota');
 const id=created.booking.id;
 await request('rider',`/api/bookings/${id}/route`,actors.customer,{},403);
 const preview=await request('rider',`/api/bookings/${id}/route`,actors.rider,{});assert.equal(preview.destination,'preview');assert.equal(await usage(),before);checks.push('Eligible rider preview shares the same route cache; wrong role rejected');
 const accepted=await patch(id,'ACCEPTED',actors.rider);assert.equal(accepted.etaMinutes,25);
 await request('rider',`/api/bookings/${id}/route`,actors.rider,{},422);checks.push('Navigation requires fresh shared GPS');
 await request('rider','/api/rider/location',actors.rider,{lat:16.021,lng:120.231,capturedAt:Date.now(),accuracy:10});
 const navigation=await request('rider',`/api/bookings/${id}/route`,actors.rider,{});assert.equal(navigation.destination,'pickup');assert.equal(navigation.route.source,'openrouteservice');checks.push('Accepted rider gets road instructions to pickup');
 await db.booking.update({where:{id,customerId:actors.customer.id},data:{status:'IN_TRANSIT',pickedUpAt:new Date()}});
 const destination=await request('rider',`/api/bookings/${id}/route`,actors.rider,{});assert.equal(destination.destination,'dropoff');checks.push('After pickup the destination switches to drop-off');
 await db.booking.update({where:{id,customerId:actors.customer.id},data:{status:'CANCELLED',cancelledAt:new Date(),cancellationReason:'Isolated routing verification complete'}});
 await request('rider',`/api/bookings/${id}/route`,actors.rider,{},409);checks.push('Cancelled bookings cannot start navigation');
 await request('customer','/api/road-route',actors.customer,{...quoteBody,dropoff:{lat:14.6,lng:120.98}},422);checks.push('Coverage validation remains enforced');
 console.log(JSON.stringify({passed:checks.length,checks,environment:'isolated schema + local provider fixture',realProviderCalls:0,realEmailsSent:0},null,2));
 }finally{await db.$disconnect();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
