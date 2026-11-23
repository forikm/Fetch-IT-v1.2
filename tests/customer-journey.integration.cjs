/* eslint-disable @typescript-eslint/no-require-imports */
// Real HTTP checks against two production builds in one disposable DB schema.
const assert=require("node:assert/strict"),crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const {parseEnv}=require("node:util"),{spawn,spawnSync}=require("node:child_process"),{PrismaClient}=require("@prisma/client");
if(process.env.RUN_JOURNEY_INTEGRATION!=="1")throw Error("Set RUN_JOURNEY_INTEGRATION=1.");
const root=path.resolve(__dirname,".."),riderRoot=path.resolve(process.env.JOURNEY_RIDER_ROOT||path.join(root,"../fetch-rider"));
const config=parseEnv(fs.readFileSync(process.env.JOURNEY_ENV_FILE||path.join(root,".env"),"utf8"));
const target=new URL(process.env.BOOKING_TEST_DATABASE_URL||config.BOOKING_TEST_DATABASE_URL||config.DATABASE_URL);
const schema="fetch_journey_test_"+crypto.randomUUID().replaceAll("-","");
assert.notEqual(schema,target.searchParams.get("schema")||"public");
target.searchParams.set("schema",schema);target.searchParams.set("options","-c search_path="+schema+",pg_catalog");
if(!target.searchParams.has("connect_timeout"))target.searchParams.set("connect_timeout","15");
const databaseUrl=target.toString(),secret=crypto.randomBytes(32).toString("hex");
const riderDevice=crypto.randomUUID();
const cashOnly=process.env.JOURNEY_CASH_ONLY==="1";
const deliveryOnly=process.env.JOURNEY_DELIVERY_ONLY==="1";
const env={};for(const key of ["PATH","Path","SystemRoot","SYSTEMROOT","ComSpec","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA"])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{NODE_ENV:"production",DATABASE_URL:databaseUrl,SESSION_SECRET:secret,ADMIN_SESSION_SECRET:secret,EMAIL_CODE_SECRET:secret,DELIVERY_CODE_SECRET:secret,NEXT_TELEMETRY_DISABLED:"1"});
const db=new PrismaClient({datasourceUrl:databaseUrl}),servers=[],checks=[],artifacts=[];
const customerPort=Number(process.env.JOURNEY_CUSTOMER_PORT||3230),riderPort=Number(process.env.JOURNEY_RIDER_PORT||3231);
const output=path.join(root,"output","journey");
// Older staff SQL explicitly names public. Rewrite only a disposable copy so
// the integration run never creates functions or grants on the live schema.
const isolatedPrisma=path.join(root,"tmp","journey-migrations",schema);
fs.mkdirSync(path.join(isolatedPrisma,"migrations"),{recursive:true});
fs.copyFileSync(path.join(root,"prisma","schema.prisma"),path.join(isolatedPrisma,"schema.prisma"));
for(const entry of fs.readdirSync(path.join(root,"prisma","migrations"),{withFileTypes:true})){
 const from=path.join(root,"prisma","migrations",entry.name),to=path.join(isolatedPrisma,"migrations",entry.name);
 if(entry.isDirectory()){
  fs.mkdirSync(to);
  const sql=fs.readFileSync(path.join(from,"migration.sql"),"utf8").replace(/\bpublic\b/g,schema);
  assert(!/\bpublic\s*\./i.test(sql));
  fs.writeFileSync(path.join(to,"migration.sql"),sql);
 }else fs.copyFileSync(from,to);
}
let ownsSchema=false;
const redacted=message=>String(message).replace(/postgres(?:ql)?:\/\/\S+/g,"[database URL redacted]");
function cookie(user){const value=Buffer.from(JSON.stringify({uid:user.id,email:user.email,name:user.name,role:user.role,iat:Date.now(),exp:Date.now()+3600000})).toString("base64url");return "fetchit_session="+value+"."+crypto.createHmac("sha256",secret).update(value).digest("base64url")+(user.role==="RIDER"?"; fetchit_rider_push_device="+riderDevice:"");}
async function raw(app,route,user,method="GET",body,headers={}){
 return fetch("http://127.0.0.1:"+(app==="rider"?riderPort:customerPort)+route,{method,headers:{"Content-Type":"application/json",...(user?{cookie:cookie(user)}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
}
async function request(app,route,user,status=200,method="GET",body,headers={}){
 const res=await raw(app,route,user,method,body,headers);
 return readResponse(res,status,method,route);
}
async function readResponse(res,status,method,route){
 const text=await res.text();let data;try{data=JSON.parse(text);}catch{data={error:text};}assert.equal(res.status,status,method+" "+route+": "+res.status+" "+JSON.stringify(data).slice(0,250));return data;
}
async function start(appRoot,port){
 const child=spawn(process.execPath,[path.join(appRoot,"node_modules/next/dist/bin/next"),"start","-p",String(port),"-H","127.0.0.1"],{cwd:appRoot,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
 let log="";child.stdout.on("data",chunk=>{log=(log+redacted(chunk)).slice(-4000);});child.stderr.on("data",chunk=>{log=(log+redacted(chunk)).slice(-4000);});servers.push({child,log:()=>log});
 for(let i=0;i<70;i++){assert.equal(child.exitCode,null,"Production server exited: "+log);try{const res=await fetch("http://127.0.0.1:"+port+"/api",{signal:AbortSignal.timeout(700)});if(res.status<500)return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 throw Error("Production server did not start: "+log);
}
async function receipt(booking,user,label){
 const res=await raw("customer","/api/bookings/"+booking.id+"/receipt",user);
 assert.equal(res.status,200);assert.equal(res.headers.get("content-type"),"application/pdf");
 const bytes=Buffer.from(await res.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),"%PDF-");
 const filename=label.toLowerCase().replaceAll("_","-")+".pdf";fs.writeFileSync(path.join(output,filename),bytes);artifacts.push(filename);
}
async function main(){
 try{
  assert.equal((await db.$queryRawUnsafe("SELECT nspname FROM pg_namespace WHERE nspname=$1",schema)).length,0);ownsSchema=true;
  const migrated=spawnSync(process.execPath,[path.join(root,"node_modules/prisma/build/index.js"),"migrate","deploy","--schema",path.join(isolatedPrisma,"schema.prisma")],{cwd:root,env,windowsHide:true,encoding:"utf8",timeout:120000});
  assert.equal(migrated.status,0,"Isolated migrations failed: "+redacted((migrated.stdout||"")+(migrated.stderr||"")).slice(-1800));
  assert((await db.$queryRawUnsafe("SHOW search_path"))[0].search_path.includes(schema));
  const functions=await db.$queryRawUnsafe("SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1",schema);
  for(const fn of functions){assert(/^fetch_[a-z_]+$/.test(fn.name));assert(/^[a-zA-Z0-9_.,\s"\[\]]*$/.test(fn.args));await db.$executeRawUnsafe('ALTER FUNCTION "'+schema+'"."'+fn.name+'"('+fn.args+') SET search_path TO "'+schema+'", pg_catalog');}
  fs.mkdirSync(output,{recursive:true});
  await Promise.all([start(root,customerPort),start(riderRoot,riderPort)]);
  const customer=await db.user.create({data:{name:"Mobile QA Customer",email:"customer@journey.example.invalid",role:"CUSTOMER"}});
  const other=await db.user.create({data:{name:"Other QA Customer",email:"other@journey.example.invalid",role:"CUSTOMER"}});
  const rider=await db.user.create({data:{name:"Mobile QA Driver",email:"driver@journey.example.invalid",role:"RIDER",riderProfile:{create:{vehicleClass:"MOTORCYCLE",vehiclePlate:"QA 123"}},riderPresence:{create:{isOnline:true}}}});
  for(const service of ["RIDE","DELIVERY"])await db.riderServiceApproval.create({data:{userId:rider.id,vehicleClass:"MOTORCYCLE",service,source:"TEST_FIXTURE"}});
  await db.customerPushSubscription.create({data:{customerId:rider.id,deviceId:riderDevice,endpoint:"https://fcm.googleapis.com/fcm/send/isolated-"+riderDevice,p256dh:"isolated-fixture",auth:"isolated-fixture"}});
  // No WebPushIdentity is provisioned: eligibility is exercised without sending notifications.
  assert.equal(await db.webPushIdentity.count(),0);
  const fixtureImage=await require("sharp")(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#f6e9da"/><rect x="180" y="90" width="240" height="200" rx="6" fill="#bb7332"/><path d="M300 90v200" stroke="#f9d7a0" stroke-width="35"/><text x="300" y="350" text-anchor="middle" font-family="Arial" font-size="22">Delivery proof test fixture</text></svg>')).png().toBuffer();
  const photoUrl="data:image/png;base64,"+fixtureImage.toString("base64");
  async function journey(type,paymentMethod,number,mismatch=false){
   const label=type+"_"+paymentMethod+(mismatch?"_MISMATCH":"");
   const body={type,paymentMethod,vehicleClass:"MOTORCYCLE",passengers:1,cargoWeightKg:2,pickup:{lat:16.0206,lng:120.2321,label:"Lingayen Town Plaza, Pangasinan"},dropoff:{lat:16.0277,lng:120.2299,label:type==="DELIVERY"&&paymentMethod==="DEMO_BANK"?"Capitol Grounds, Lingayen, Pangasinan, ground-floor reception beside the main entrance; follow the covered walkway to the receiving desk":"Capitol Grounds, Lingayen, Pangasinan"}};
   await db.riderPresence.update({where:{userId:rider.id},data:{isOnline:true,lat:body.pickup.lat,lng:body.pickup.lng,locationAccuracy:10,locationAt:new Date(),updatedAt:new Date()}});
   await request("customer","/api/fare/estimate",null,401,"POST",body);
   const quote=await request("customer","/api/fare/estimate",customer,200,"POST",body);assert(quote.fare.totalFare>0);
   body.routeQuote=quote.routeQuote;
   const bookingHeaders={"Idempotency-Key":crypto.randomUUID()};
   let bookingResponse=await raw("customer","/api/bookings",customer,"POST",body,bookingHeaders);
   if([500,503].includes(bookingResponse.status)){
    console.log(`RETRY ${label}: booking returned ${bookingResponse.status}; retrying with the original request key.`);
    await bookingResponse.text();
    bookingResponse=await raw("customer","/api/bookings",customer,"POST",body,bookingHeaders);
   }
   const created=await readResponse(bookingResponse,200,"POST","/api/bookings");
   let booking=created.booking;
   if(paymentMethod!=="CASH"){
    assert.match(created.checkoutUrl,/^\/checkout\//);
    const checkoutId=created.checkoutUrl.split("/").at(-1);
    const checkout=await raw("customer",created.checkoutUrl,customer);assert.equal(checkout.status,200);assert.match(await checkout.text(),/Simulated payment/);
    await request("customer","/api/checkouts/"+checkoutId,other,404,"POST",{outcome:"SUCCEEDED"});
    const paid=await request("customer","/api/checkouts/"+checkoutId,customer,200,"POST",{outcome:"SUCCEEDED"});
    booking=(await request("customer","/api/bookings/"+paid.bookingId,customer)).booking;
    assert.equal(booking.paymentStatus,"PAID");
   }else{assert.equal(booking.paymentStatus,"UNPAID");await request("customer","/api/bookings/"+booking.id+"/receipt",customer,409);}
   assert.equal(Object.hasOwn(booking,"ticketId"),false);
   await request("customer","/api/bookings/"+booking.id+"/review",customer,400,"POST",{rating:5});
   // Matching runs after the create response. Wait for the real offer/open-list
   // transition instead of racing acceptance while the matching lease is held.
   let available=false;
   for(let attempt=0;attempt<30;attempt++){
    const current=await db.booking.findUnique({where:{id:booking.id},include:{dispatch:true}});
    if((current.status==="MATCHED"&&current.riderId===rider.id)||(current.status==="PENDING"&&(!current.dispatch||current.dispatch.phase==="OPEN"))){available=true;break;}
    await request("rider","/api/rider/updates",rider);
    await new Promise(resolve=>setTimeout(resolve,250));
   }
   assert(available,"Matching must expose an eligible offer before acceptance");
   await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"ACCEPTED",location:{lat:16.0206,lng:120.2321,accuracy:10,capturedAt:Date.now()}});
   await request("rider","/api/rider/location",rider,200,"POST",{lat:16.023,lng:120.233,accuracy:10,capturedAt:Date.now(),speedKph:20});
   if(type==="RIDE"){
    await request("rider","/api/bookings/"+booking.id+"/pickup-progress",rider,200,"POST",{stage:"HEADING"});
    let progress=await request("customer","/api/bookings/"+booking.id+"/pickup-progress",customer);assert.equal(progress.pickupProgress.stage,"HEADING");assert(progress.pickupProgress.etaMinutes>=1);
    await request("rider","/api/bookings/"+booking.id+"/pickup-progress",rider,200,"POST",{stage:"ARRIVED"});
    progress=await request("customer","/api/bookings/"+booking.id+"/pickup-progress",customer);assert.equal(progress.pickupProgress.stage,"ARRIVED");
    const code=await request("customer","/api/bookings/"+booking.id+"/otp",customer);assert.match(code.otp,/^\d{6}$/);
    await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"PICKED_UP",otp:code.otp});
   }else await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"PICKED_UP"});
   if(type==="RIDE"){
    await request("rider","/api/bookings/"+booking.id,rider,409,"PATCH",{status:"IN_TRANSIT"});
    await request("customer","/api/bookings/"+booking.id+"/ride-confirmation",other,404,"POST",{action:"PICKUP"});
    await request("customer","/api/bookings/"+booking.id+"/ride-confirmation",customer,200,"POST",{action:"PICKUP"});
    const reopened=(await request("customer","/api/bookings/"+booking.id,customer)).booking;
    assert(reopened.customerPickupConfirmedAt,"Customer pickup confirmation survives a fresh read");
   }
   await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"IN_TRANSIT"});
   if(type==="RIDE"){
    await request("rider","/api/bookings/"+booking.id,rider,409,"PATCH",{status:"DELIVERED"});
    if(paymentMethod==="CASH")await request("customer","/api/bookings/"+booking.id+"/payment",customer,409,"POST",{});
    await request("customer","/api/bookings/"+booking.id+"/ride-confirmation",customer,200,"POST",{action:"DROPOFF"});
    const reopened=(await request("customer","/api/bookings/"+booking.id,customer)).booking;
    assert(reopened.customerDropoffConfirmedAt,"Customer arrival confirmation survives a fresh read");
   }
   if(type==="DELIVERY"&&paymentMethod==="CASH")await request("rider","/api/bookings/"+booking.id+"/payment",rider,200,"POST",{action:"ARRIVED_AT_DROPOFF"});
   if(paymentMethod==="CASH"){
    const total=Number(booking.totalFare);
    if(mismatch)await request("customer","/api/bookings/"+booking.id+"/payment",customer,409,"POST",{amount:total-1});
    await request("customer","/api/bookings/"+booking.id+"/payment",customer,200,"POST",{});
    await request("customer","/api/bookings/"+booking.id+"/receipt",customer,409);
    const payment=await request("rider","/api/bookings/"+booking.id+"/payment",rider,200,"POST",{amount:mismatch?total-1:total});
    assert.equal(payment.booking.paymentStatus,mismatch?"PENDING":"PAID");
    if(mismatch){await request("rider","/api/bookings/"+booking.id+"/proof",rider,409,"POST",{signatureSvg:'<path d="M20 40L60 70L100 30" />',recipientName:"QA Recipient"});await request("customer","/api/bookings/"+booking.id+"/receipt",customer,409);checks.push(label);console.log("PASS "+label);return;}
   }
   if(type==="DELIVERY"){
    const proof=await db.deliveryProof.create({data:{bookingId:booking.id,riderId:rider.id,proofType:"PHOTO",photoUrl}});
    await request("customer","/api/bookings/"+booking.id+"/proof/"+proof.id+"/photo",other,404);
    await request("rider","/api/bookings/"+booking.id+"/proof",rider,200,"POST",{signatureSvg:'<path d="M20 40L60 70L100 30" stroke="#153c34" fill="none" />',recipientName:"QA Recipient"});
    const detail=(await request("customer","/api/bookings/"+booking.id,customer)).booking;
    const photo=detail.deliveryProofs.find(p=>p.proofType==="PHOTO");assert(photo.photoUrl.startsWith("/api/bookings/"));
    const response=await raw("customer",photo.photoUrl,customer);assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"image/png");assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixtureImage);
   }else await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"DELIVERED"});
   const finished=(await request("customer","/api/bookings/"+booking.id,customer)).booking;assert.equal(finished.status,"DELIVERED");
   const required=await request("customer","/api/bookings/rating-required",customer);
   assert.equal(required.booking.id,booking.id,"Completed bookings require a rating after reopening");
   const reviewRoute="/api/bookings/"+booking.id+"/review";
   const reviewInput={rating:number%2?4:5,comment:"Isolated journey check"};
   const reviewResponse=await raw("customer",reviewRoute,customer,"POST",reviewInput);
   let review;
   if(reviewResponse.status===503){
    await reviewResponse.text();
    console.log(`RETRY ${label}: rating returned 503; checking whether it saved before retrying.`);
    review=await request("customer",reviewRoute,customer);
    if(!review.review)review=await request("customer",reviewRoute,customer,201,"POST",reviewInput);
   }else review=await readResponse(reviewResponse,201,"POST",reviewRoute);
   assert(review.review.id);
   assert.equal((await request("customer","/api/bookings/rating-required",customer)).booking,null);
   await request("customer","/api/bookings/"+booking.id+"/review",customer,409,"POST",{rating:5});
   const forbidden=await raw("customer","/api/bookings/"+booking.id+"/receipt",other);assert.equal(forbidden.status,404);
   await receipt(booking,customer,label);
   checks.push(label);console.log("PASS "+label);
  }
  const methods=cashOnly?["CASH"]:["DEMO_GCASH","DEMO_MAYA","DEMO_BANK","CASH"];
  const types=deliveryOnly?["DELIVERY"]:["RIDE","DELIVERY"];
  let index=0;for(const method of methods)for(const type of types)await journey(type,method,++index);
  await journey("DELIVERY","CASH",index+1,true);
  assert.equal(await db.customerReview.count(),index);
  const average=await db.customerReview.aggregate({_avg:{rating:true}});
  assert.equal((await db.riderProfile.findUnique({where:{userId:rider.id}})).rating,average._avg.rating);
  const history=await request("customer","/api/bookings?filter=history",customer);assert.equal(history.bookings.length,index);
  const report={date:new Date().toISOString(),checks,artifacts,scope:"Real HTTP and PostgreSQL checks on isolated production servers. Browser, phone keyboard, live Blob upload and physical-device behavior are not verified."};
  const reportName=deliveryOnly?(cashOnly?"cash-delivery-report.json":"delivery-report.json"):(cashOnly?"cash-report.json":"report.json");
  fs.writeFileSync(path.join(output,reportName),JSON.stringify(report,null,2));
  console.log(`PASS: ${checks.length} complete/blocked journeys and ${artifacts.length} PDF receipts.`);
 }catch(error){
  console.error(redacted(error.stack||error.message));
  for(const server of servers)console.error(server.log());
  process.exitCode=1;
 }finally{
  for(const {child} of servers)child.kill();
  await Promise.all(servers.map(({child})=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>{child.once("exit",resolve);setTimeout(resolve,3000);})));
  try {
   if(ownsSchema){
    assert(/^fetch_journey_test_[a-f0-9]{32}$/.test(schema));
    await db.$transaction(async tx=>{
     await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
     await tx.$executeRawUnsafe('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');
    },{timeout:15000});
    console.log("Disposable journey schema removed.");
   }
  }finally{await db.$disconnect();}
 }
}
main().catch(error=>{console.error(redacted(error.stack||error.message));process.exitCode=1;});
