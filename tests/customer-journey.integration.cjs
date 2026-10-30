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
const databaseUrl=target.toString(),secret=crypto.randomBytes(32).toString("hex");
const env={};for(const key of ["PATH","Path","SystemRoot","SYSTEMROOT","ComSpec","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA"])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{NODE_ENV:"production",DATABASE_URL:databaseUrl,SESSION_SECRET:secret,ADMIN_SESSION_SECRET:secret,EMAIL_CODE_SECRET:secret,DELIVERY_CODE_SECRET:secret,NEXT_TELEMETRY_DISABLED:"1"});
const db=new PrismaClient({datasourceUrl:databaseUrl}),servers=[],checks=[],artifacts=[];
const customerPort=Number(process.env.JOURNEY_CUSTOMER_PORT||3230),riderPort=Number(process.env.JOURNEY_RIDER_PORT||3231);
const output=path.join(root,"output","journey");
let ownsSchema=false;
const redacted=message=>String(message).replace(/postgres(?:ql)?:\/\/\S+/g,"[database URL redacted]");
function cookie(user){const value=Buffer.from(JSON.stringify({uid:user.id,email:user.email,name:user.name,role:user.role,iat:Date.now(),exp:Date.now()+3600000})).toString("base64url");return "fetchit_session="+value+"."+crypto.createHmac("sha256",secret).update(value).digest("base64url");}
async function raw(app,route,user,method="GET",body,headers={}){
 return fetch("http://127.0.0.1:"+(app==="rider"?riderPort:customerPort)+route,{method,headers:{"Content-Type":"application/json",...(user?{cookie:cookie(user)}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
}
async function request(app,route,user,status=200,method="GET",body,headers={}){
 const res=await raw(app,route,user,method,body,headers);const text=await res.text();let data;try{data=JSON.parse(text);}catch{data={error:text};}assert.equal(res.status,status,method+" "+route+": "+res.status+" "+JSON.stringify(data).slice(0,250));return data;
}
async function start(appRoot,port){
 const child=spawn(process.execPath,[path.join(appRoot,"node_modules/next/dist/bin/next"),"start","-p",String(port),"-H","127.0.0.1"],{cwd:appRoot,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
 let log="";child.stdout.on("data",chunk=>{log=(log+redacted(chunk)).slice(-4000);});child.stderr.on("data",chunk=>{log=(log+redacted(chunk)).slice(-4000);});servers.push(child);
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
  const migrated=spawnSync(process.execPath,[path.join(root,"node_modules/prisma/build/index.js"),"migrate","deploy"],{cwd:root,env,windowsHide:true,encoding:"utf8",timeout:120000});
  assert.equal(migrated.status,0,"Isolated migrations failed: "+redacted((migrated.stdout||"")+(migrated.stderr||"")).slice(-1800));
  assert((await db.$queryRawUnsafe("SHOW search_path"))[0].search_path.includes(schema));
  const functions=await db.$queryRawUnsafe("SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1",schema);
  for(const fn of functions){assert(/^fetch_[a-z_]+$/.test(fn.name));await db.$executeRawUnsafe('ALTER FUNCTION "'+schema+'"."'+fn.name+'"() SET search_path TO "'+schema+'", pg_catalog');}
  fs.mkdirSync(output,{recursive:true});
  await Promise.all([start(root,customerPort),start(riderRoot,riderPort)]);
  const customer=await db.user.create({data:{name:"Mobile QA Customer",email:"customer@journey.example.invalid",role:"CUSTOMER"}});
  const other=await db.user.create({data:{name:"Other QA Customer",email:"other@journey.example.invalid",role:"CUSTOMER"}});
  const rider=await db.user.create({data:{name:"Mobile QA Driver",email:"driver@journey.example.invalid",role:"RIDER",riderProfile:{create:{vehicleClass:"MOTORCYCLE",vehiclePlate:"QA 123"}},riderPresence:{create:{isOnline:true}}}});
  for(const service of ["RIDE","DELIVERY"])await db.riderServiceApproval.create({data:{userId:rider.id,vehicleClass:"MOTORCYCLE",service,source:"TEST_FIXTURE"}});
  const fixtureImage=await require("sharp")(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#f6e9da"/><rect x="180" y="90" width="240" height="200" rx="6" fill="#bb7332"/><path d="M300 90v200" stroke="#f9d7a0" stroke-width="35"/><text x="300" y="350" text-anchor="middle" font-family="Arial" font-size="22">Delivery proof test fixture</text></svg>')).png().toBuffer();
  const photoUrl="data:image/png;base64,"+fixtureImage.toString("base64");
  async function journey(type,paymentMethod,number,mismatch=false){
   const label=type+"_"+paymentMethod+(mismatch?"_MISMATCH":"");
   const body={type,paymentMethod,vehicleClass:"MOTORCYCLE",passengers:1,cargoWeightKg:2,pickup:{lat:16.0206,lng:120.2321,label:"Lingayen Town Plaza, Pangasinan"},dropoff:{lat:16.0277,lng:120.2299,label:type==="DELIVERY"&&paymentMethod==="DEMO_BANK"?"Capitol Grounds, Lingayen, Pangasinan, ground-floor reception beside the main entrance; follow the covered walkway to the receiving desk":"Capitol Grounds, Lingayen, Pangasinan"}};
   await db.riderPresence.update({where:{userId:rider.id},data:{isOnline:true,updatedAt:new Date()}});
   const quote=await request("customer","/api/fare/estimate",null,200,"POST",body);assert(quote.fare.totalFare>0);
   const created=await request("customer","/api/bookings",customer,200,"POST",body,{"Idempotency-Key":crypto.randomUUID()});
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
   await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"ACCEPTED"});
   await request("rider","/api/rider/location",rider,200,"POST",{lat:16.023,lng:120.233,capturedAt:Date.now(),speedKph:20});
   if(type==="RIDE"){
    await request("rider","/api/bookings/"+booking.id+"/pickup-progress",rider,200,"POST",{stage:"HEADING"});
    let progress=await request("customer","/api/bookings/"+booking.id+"/pickup-progress",customer);assert.equal(progress.pickupProgress.stage,"HEADING");assert(progress.pickupProgress.etaMinutes>=1);
    await request("rider","/api/bookings/"+booking.id+"/pickup-progress",rider,200,"POST",{stage:"ARRIVED"});
    progress=await request("customer","/api/bookings/"+booking.id+"/pickup-progress",customer);assert.equal(progress.pickupProgress.stage,"ARRIVED");
    const code=await request("customer","/api/bookings/"+booking.id+"/otp",customer);assert.match(code.otp,/^\d{6}$/);
    await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"PICKED_UP",otp:code.otp});
   }else await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"PICKED_UP"});
   await request("rider","/api/bookings/"+booking.id,rider,200,"PATCH",{status:"IN_TRANSIT"});
   if(type==="DELIVERY"&&paymentMethod==="CASH")await request("rider","/api/bookings/"+booking.id+"/payment",rider,200,"POST",{action:"ARRIVED_AT_DROPOFF"});
   if(paymentMethod==="CASH"){
    const total=Number(booking.totalFare);
    await request("customer","/api/bookings/"+booking.id+"/payment",customer,200,"POST",{amount:mismatch?total-1:total});
    await request("customer","/api/bookings/"+booking.id+"/receipt",customer,409);
    const payment=await request("rider","/api/bookings/"+booking.id+"/payment",rider,200,"POST",{amount:total});
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
   const review=await request("customer","/api/bookings/"+booking.id+"/review",customer,201,"POST",{rating:number%2?4:5,comment:"Isolated journey check"});assert(review.review.id);
   await request("customer","/api/bookings/"+booking.id+"/review",customer,409,"POST",{rating:5});
   const forbidden=await raw("customer","/api/bookings/"+booking.id+"/receipt",other);assert.equal(forbidden.status,404);
   await receipt(booking,customer,label);
   checks.push(label);console.log("PASS "+label);
  }
  let index=0;for(const method of ["DEMO_GCASH","DEMO_MAYA","DEMO_BANK","CASH"])for(const type of ["RIDE","DELIVERY"])await journey(type,method,++index);
  await journey("DELIVERY","CASH",++index,true);
  assert.equal(await db.customerReview.count(),8);
  const average=await db.customerReview.aggregate({_avg:{rating:true}});
  assert.equal((await db.riderProfile.findUnique({where:{userId:rider.id}})).rating,average._avg.rating);
  const history=await request("customer","/api/bookings?filter=history",customer);assert.equal(history.bookings.length,8);
  const report={date:new Date().toISOString(),checks,artifacts,scope:"Real HTTP and PostgreSQL checks on isolated production servers. Browser, phone keyboard, live Blob upload and physical-device behavior are not verified."};
  fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
  console.log("PASS: "+checks.length+" complete/blocked journeys; eight PDF receipts; scoped proof images; pickup codes, arrival, ratings and history.");
 }finally{
  for(const server of servers)server.kill();
  await Promise.all(servers.map(server=>server.exitCode!==null?Promise.resolve():new Promise(resolve=>{server.once("exit",resolve);setTimeout(resolve,3000);})));
  if(ownsSchema){assert(/^fetch_journey_test_[a-f0-9]{32}$/.test(schema));await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');console.log("Disposable journey schema removed.");}
  await db.$disconnect();
 }
}
main().catch(error=>{console.error(redacted(error.stack||error.message));process.exitCode=1;});
