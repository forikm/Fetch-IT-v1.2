// Isolated PostgreSQL schema, fake Blob/SMTP adapters. Never sends mail or changes production rows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {PrismaClient} = require('@prisma/client');
const {NextRequest} = require('next/server');
const ts = require('typescript');
if(process.env.RUN_RIDER_APPLICATION_INTEGRATION !== '1') throw Error('Opt in with RUN_RIDER_APPLICATION_INTEGRATION=1.');
const root = path.resolve(__dirname,'..'); process.loadEnvFile(path.join(root,'.env'));
const schema = 'fetch_onboarding_test_' + crypto.randomUUID().replaceAll('-','');
const target = new URL(process.env.DATABASE_URL);
assert.notEqual(target.searchParams.get('schema') || 'public',schema);
target.searchParams.set('schema',schema);target.searchParams.set('options',`-c search_path=${schema},pg_catalog`);
const databaseUrl=target.toString(),db=new PrismaClient({datasourceUrl:databaseUrl});
class RateLimitError extends Error {}
const messages=[],blobs=new Map(),cache=new Map(); let failMail=false, assertions=0, ownsSchema=false;
const previousSecret=process.env.SESSION_SECRET;
process.env.SESSION_SECRET=crypto.randomBytes(32).toString('hex');process.env.GMAIL_SENDER='fixture@gmail.com';process.env.GMAIL_APP_PASSWORD='fixture-password-1234';
function load(file){
 const filename=path.resolve(root,file);if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{exports,Buffer,Uint8Array,Array,Date,Response,File,console:{info(){},warn(){},error(){}},process,require(name){
  if(name==='./db'||name==='@/lib/db')return {db};
  if(name==='nodemailer')return {createTransport:()=>({async sendMail(message){if(failMail)throw Error('Simulated SMTP disconnect');messages.push(message);return {accepted:[message.to]};},close(){}})};
  if(name==='@vercel/blob')return {put:async(p,bytes)=>{blobs.set(p,bytes);return {pathname:p};},del:async p=>blobs.delete(p),get:async p=>blobs.has(p)?{statusCode:200,stream:new Blob([blobs.get(p)]).stream()}:null};
  if(name==='./request-guard')return {limitRequests:async()=>{},RateLimitError};
  if(name==='@/lib/request-guard')return {withRequestLog:(_s,h)=>h,limitRequests:async()=>{}};
  if(name==='./booking-events')return {recordBookingEvent:async()=>{}};
  if(name==='./push-delivery')return {schedulePushDelivery(){}};
  if(name.startsWith('@/'))return load('src/'+name.slice(2)+'.ts');
  if(name.startsWith('.'))return load(path.resolve(path.dirname(filename),name+'.ts'));
  return require(name);
 }});return exports;
}
function migrate(schemaFile){const result=spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',schemaFile],{cwd:root,env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8',timeout:90000,windowsHide:true});assert.equal(result.status,0,'Isolated migration failed: '+(result.stderr||result.stdout).slice(-1200));}
async function scopeFunctions(){for(const fn of await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${schema}`){assert(/^fetch_[a-z_]+$/.test(fn.name));await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);}}
const fields={legalName:'Fixture Applicant',birthDate:'1990-01-01',address:'Lingayen, Pangasinan',mobile:'09171234567',emergencyName:'Fixture Contact',emergencyRelationship:'Sibling',emergencyPhone:'09181234567',licenceNumber:'FIXTURE123',licenceCodes:'A,A1,B',licenceExpiry:'2030-01-01',nbiExpiry:'2029-01-01',vehicleMake:'Fixture',vehicleModel:'Model',vehicleYear:'2024',plateNumber:'TEST123',registrationExpiry:'2029-06-30',capacity:'2',displacement:'125',ownership:'OWNER',operatingArea:'Lingayen authorized zone',permitNumber:'FIXTURE-PERMIT'};
(async()=>{
 try{
  assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname=${schema}`).length,0);ownsSchema=true;
  const before=path.join(root,'tmp',schema);fs.mkdirSync(path.join(before,'migrations'),{recursive:true});fs.copyFileSync(path.join(root,'prisma/schema.prisma'),path.join(before,'schema.prisma'));
  for(const entry of fs.readdirSync(path.join(root,'prisma/migrations'),{withFileTypes:true}))if(entry.name!=='202610240001_rider_applications')fs.cpSync(path.join(root,'prisma/migrations',entry.name),path.join(before,'migrations',entry.name),{recursive:true});
  migrate(path.join(before,'schema.prisma'));await scopeFunctions();
  const legacy=await db.user.create({data:{email:'legacy-'+schema+'@example.invalid',name:'Legacy Fixture',role:'RIDER',riderProfile:{create:{vehicleClass:'TRICYCLE'}},riderPresence:{create:{}}}});
  migrate(path.join(root,'prisma/schema.prisma'));await scopeFunctions();
  assert((await db.$queryRaw`SHOW search_path`)[0].search_path.includes(schema));
  const runtimeRoles=await db.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('fetch_staff_runtime','fetch_owner_runtime','fetch_customer_runtime')`;
  for(const {rolname} of runtimeRoles) {
   if(rolname==='fetch_customer_runtime') {
    const [r]=await db.$queryRaw`SELECT has_table_privilege(${rolname},${schema+'."RiderApplicationDocument"'},'INSERT') AS allowed`;
    assert.equal(r.allowed,false);assertions++;
   } else {
    const [r]=await db.$queryRaw`SELECT has_column_privilege(${rolname},${schema+'."RiderProfile"'},'vehicleClass','UPDATE') AND has_column_privilege(${rolname},${schema+'."RiderPresence"'},'isOnline','UPDATE') AS allowed`;
    assert.equal(r.allowed,true);assertions++;
   }
  }

  assert.equal(await db.riderServiceApproval.count({where:{userId:legacy.id,source:'LEGACY_EXISTING'}}),2);assertions++;
  const user=await db.user.create({data:{email:schema+'@example.invalid',name:'Fixture Applicant',role:'RIDER',riderProfile:{create:{vehicleClass:'TRICYCLE'}},riderPresence:{create:{isOnline:true}}}});
  const other=await db.user.create({data:{email:'other-'+schema+'@example.invalid',name:'Other Fixture',role:'RIDER',riderProfile:{create:{vehicleClass:'SEDAN'}}}});
  const actors={};for(const [key,role] of [['reviewer','SAFETY'],['admin','ADMIN'],['owner','SUPERADMIN'],['support','SUPPORT']]){const u=await db.user.create({data:{email:key+'-'+schema+'@example.invalid',name:'Fixture '+key,role}});actors[key]={id:u.id,name:u.name,role};}
  const {applicantRequest}=load('src/lib/application-applicant-api.ts'),{staffApplicationRequest}=load('src/lib/application-staff-api.ts');
  const {approvedServices}=load('src/lib/rider-eligibility.ts');
  async function applicant(body,expected=200,uid=user.id){const req=new NextRequest('http://fixture.invalid/api/rider/application',body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const res=await applicantRequest(req,uid);const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));assertions++;return data;}
  await applicant({action:'save',padding:'x'.repeat(17000)},413);
  let app=(await applicant()).application;
  assert.equal((await approvedServices(db,user.id)).length,0);assertions++;
  await applicant({action:'save',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields});app=(await applicant()).application;
  await applicant({action:'submit',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields},400);
  await applicant({action:'send-code'});const code=messages.at(-1).text.match(/code is (\d{6})/)[1];
  await applicant({action:'verify-code',code:'000000'===code?'000001':'000000'},400);
  await applicant({action:'verify-code',code});await applicant({action:'verify-code',code},400);app=(await applicant()).application;
  const {requiredDocuments,SECTION_FIELDS}=load('src/lib/rider-application-policy.ts');
  const sharp=require('sharp');const image=await sharp({create:{width:900,height:700,channels:3,background:'#fff'}}).png().toBuffer();
  async function upload(kind,expected=200){const form=new FormData();form.set('file',new File([image],'fixture.png',{type:'image/png'}));form.set('kind',kind);form.set('version',String(app.version));const res=await applicantRequest(new NextRequest('http://fixture.invalid/api/rider/application',{method:'POST',body:form}),user.id);const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));assertions++;if(data.application)app=data.application;return data;}
  for(const kind of requiredDocuments('TRICYCLE',['DELIVERY','RIDE'],fields))await upload(kind);
  app=(await applicant({action:'submit',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields})).application;
  async function staff(actor,body,expected=200){const res=await staffApplicationRequest(new NextRequest('http://fixture.invalid/api/rider-applications/'+app.id,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:app.version,...body})}:{}),actor,app.id);const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));assertions++;if(data.application)app=data.application;return data;}
  await staff(actors.support,null,403);await staff(actors.reviewer,{action:'claim'});
  for(const section of Object.keys(SECTION_FIELDS))await staff(actors.reviewer,{action:'review',section,status:'ACCEPTED'});
  for(const doc of app.documents.filter(d=>d.current))await staff(actors.reviewer,{action:'review',documentId:doc.id,status:doc.kind==='OR'?'NEEDS_CORRECTION':'ACCEPTED',reason:'Upload the current clear official receipt.'});
  await staff(actors.reviewer,{action:'recommend'},400);await staff(actors.reviewer,{action:'corrections'});
  assert(messages.at(-1).text.includes('official receipt'));assertions++;
  const acceptedNbi=app.documents.find(d=>d.current&&d.kind==='NBI').id;
  await upload('NBI',400);await upload('OR');
  app=(await applicant({action:'submit',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields})).application;
  assert.equal(app.documents.find(d=>d.id===acceptedNbi).status,'ACCEPTED');assertions++;
  await staff(actors.reviewer,{action:'review',documentId:app.documents.find(d=>d.current&&d.kind==='OR').id,status:'ACCEPTED'});
  await staff(actors.reviewer,{action:'recommend'});
  await staff(actors.reviewer,{action:'activate',services:['DELIVERY']},403);
  const date=new Date(Date.now()+86400000).toISOString();
  const preview=await staff(actors.admin,{action:'preview',orientationAt:date,venue:'Fixture training centre',instructions:'Bring original documents and the declared vehicle.'});assert(preview.text.includes('Fixture Applicant'));assertions++;
  await staff(actors.admin,{action:'schedule',orientationAt:date,venue:'Fixture training centre',instructions:'Bring original documents and the declared vehicle.'});
  assert.equal(messages.at(-1).attachments[0].content.subarray(0,5).toString(),'%PDF-');assertions++;
  await staff(actors.reviewer,{action:'assessment',attended:true,passed:true,notes:'Passed all vehicle and passenger checks.'},400);
  await db.riderApplication.update({where:{id:app.id},data:{orientationAt:new Date(Date.now()-60000)}});app=(await applicant()).application;
  await staff(actors.reviewer,{action:'assessment',attended:true,passed:true,notes:'Passed all vehicle and passenger checks.'});
  await staff(actors.admin,{action:'activate',services:['DELIVERY']});
  assert.deepEqual(Array.from(await approvedServices(db,user.id,'TRICYCLE')),['DELIVERY']);assertions++;
  assert.equal(app.status,'ACTIVE');assertions++;
  const {reserveAvailableRider}=load('src/lib/dispatch.ts');
  const booking={id:'not-a-booking',vehicleClass:'TRICYCLE',type:'RIDE',paymentMethod:'CASH',paymentStatus:'UNPAID'};
  await assert.rejects(db.$transaction(tx=>reserveAvailableRider(tx,user.id,booking,new Date())));assertions++;
  failMail=true;
  await staff(actors.owner,{action:'activate',services:['RIDE'],operatingZone:[[120,15],[121,15],[121,17],[120,17],[120,15]]});
  assert.equal((await approvedServices(db,user.id,'TRICYCLE')).length,2);assertions++;
  const mine=app.documents.find(d=>d.current&&d.kind==='NBI');
  const otherRead=await applicantRequest(new NextRequest('http://fixture.invalid/api/rider/application?document='+mine.id),other.id);assert.equal(otherRead.status,404);assertions++;
  await staff(actors.admin,{action:'review',documentId:mine.id,status:'NEEDS_CORRECTION',reason:'Attempt to edit active application'},409);
  // SMTP delivery ambiguity is recorded and cannot be retried without explicit confirmation.
  await staff(actors.owner,{action:'activate',services:['DELIVERY']},409);
  const uncertain=await db.riderApplicationEmail.findFirst({where:{applicationId:app.id,status:'UNCERTAIN'}});assert(uncertain);assertions++;
  await staff(actors.admin,{action:'email',emailId:uncertain.id},409);
  failMail=false;await staff(actors.admin,{action:'email',emailId:uncertain.id,confirmResend:true});
  const beforeSend=messages.length;await staff(actors.admin,{action:'email',emailId:uncertain.id},409);assert.equal(messages.length,beforeSend);assertions++;
  const staleVersion=app.version-1;await staff(actors.admin,{action:'reopen',version:staleVersion,reason:'Fixture reapplication'},409);
  await staff(actors.admin,{action:'reopen',reason:'Fixture reapplication after vehicle detail change'});
  assert.equal((await approvedServices(db,user.id)).length,0);assert.equal((await db.riderPresence.findUnique({where:{userId:user.id}})).isOnline,false);assertions+=2;
  await staff(actors.admin,{action:'email',emailId:uncertain.id,confirmResend:true},409);
  if(process.env.ONBOARDING_BROWSER==='1') {
   const password='Fixture-only-onboarding-2026!';
   const {hashPassword}=load('src/lib/password.ts');
   for(const u of [user,...Object.values(actors)]) {
    const record=await db.user.findUniqueOrThrow({where:{id:u.id}});
    if(record.role!=='SUPERADMIN')await db.authIdentity.create({data:{userId:record.id,provider:'PASSWORD',providerUserId:record.email,passwordHash:hashPassword(password)}});
   }
   const {hashOwnerPassword}=load('../fetch-superadmin/src/lib/owner-password.ts');
   const ownerUser=await db.user.findUniqueOrThrow({where:{id:actors.owner.id}});
   await db.ownerIdentity.create({data:{actorId:ownerUser.id,name:ownerUser.name,email:ownerUser.email,passwordHash:await hashOwnerPassword(password)}});
   await db.riderApplication.update({where:{id:app.id},data:{status:'NEEDS_CORRECTION',fieldReviews:Object.fromEntries(Object.keys(SECTION_FIELDS).map(key=>[key,{status:'ACCEPTED'}]))}});
   await db.riderApplicationDocument.updateMany({where:{applicationId:app.id,current:true},data:{status:'ACCEPTED'}});
   await db.riderApplicationDocument.updateMany({where:{applicationId:app.id,current:true,kind:'OR'},data:{status:'NEEDS_CORRECTION',reason:'Please upload a clear image of the current official receipt. Your other documents are accepted.'}});
   const release=path.join(root,'tmp/onboarding-browser.release');if(fs.existsSync(release))fs.unlinkSync(release);
   fs.writeFileSync(path.join(root,'tmp/onboarding-browser.json'),JSON.stringify({applicationId:app.id,password,rider:user.email,admin:(await db.user.findUniqueOrThrow({where:{id:actors.admin.id}})).email,owner:ownerUser.email}));
   const {spawn}=require('node:child_process');const children=[];
   try {
    for(const [project,port] of [['fetch-rider',3301],['fetch-admin',3302],['fetch-superadmin',3303]]) {
     const appRoot=path.resolve(root,'..',project), log=fs.openSync(path.join(root,`tmp/onboarding-${port}.log`),'w');
     const child=spawn(process.execPath,[path.join(appRoot,'node_modules/next/dist/bin/next'),'dev','--webpack','-p',String(port)],{cwd:appRoot,env:{...process.env,NODE_ENV:'development',DATABASE_URL:databaseUrl,ADMIN_SESSION_SECRET:process.env.SESSION_SECRET,SUPERADMIN_URL:'http://localhost:3303'},stdio:['ignore',log,log],windowsHide:true});children.push(child);fs.closeSync(log);
    }
    console.log('Disposable browser fixture ready: rider :3301, staff :3302, owner :3303. No live email or storage requests are authorized in this fixture.');
    const deadline=Date.now()+20*60_000;while(!fs.existsSync(release)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2000));
   } finally {for(const child of children){if(child.pid&&child.exitCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}}
  }
  console.log(JSON.stringify({result:'Passed',assertions,isolatedSchema:true,realEmailsSent:0,productionRowsChanged:0,blobObjects:blobs.size}));
 } finally {
  if(ownsSchema){assert(/^fetch_onboarding_test_[a-f0-9]{32}$/.test(schema));assert((await db.$queryRaw`SHOW search_path`)[0].search_path.includes(schema));await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);}
  await db.$disconnect();if(previousSecret)process.env.SESSION_SECRET=previousSecret;
 }
})().catch(error=>{console.error('Onboarding integration failed:',error.message);process.exitCode=1;});
