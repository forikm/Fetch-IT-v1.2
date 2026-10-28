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
let demoSession=null;
const previousSecret=process.env.SESSION_SECRET;
process.env.SESSION_SECRET=crypto.randomBytes(32).toString('hex');process.env.GMAIL_SENDER='fixture@gmail.com';process.env.GMAIL_APP_PASSWORD='fixture-password-1234';
function load(file){
 const filename=path.resolve(root,file);if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const localRequire=function(name){
  if(name==='./db'||name==='@/lib/db')return {db};
  if(name==='@/lib/session')return {getSession:async()=>demoSession};
  if(name==='@/lib/rider-demo-data')return {...load('../fetch-rider/src/lib/rider-demo-data.ts'),demoPortrait:async()=>fs.readFileSync(path.resolve(root,'../fetch-rider/assets/rider-demo/portraits/mateo.png'))};
  if(name==='nodemailer')return {createTransport:()=>({async sendMail(message){if(failMail)throw Error('Simulated SMTP disconnect');messages.push(message);return {accepted:[message.to]};},close(){}})};
  if(name==='@vercel/blob')return {put:async(p,bytes)=>{blobs.set(p,bytes);return {pathname:p};},del:async p=>blobs.delete(p),get:async p=>blobs.has(p)?{statusCode:200,stream:new Blob([blobs.get(p)]).stream()}:null};
  if(name==='./request-guard')return {limitRequests:async()=>{},RateLimitError};
  if(name==='@/lib/request-guard')return {withRequestLog:(_s,h)=>h,limitRequests:async()=>{}};
  if(name==='./booking-events')return {recordBookingEvent:async()=>{}};
  if(name==='./push-delivery')return {schedulePushDelivery(){}};
  if(name.startsWith('@/'))return load('src/'+name.slice(2)+'.ts');
  if(name.startsWith('.'))return load(path.resolve(path.dirname(filename),name+'.ts'));
  return require(name);
 };
 new Function('exports','require','process','console',source)(exports,localRequire,process,{info(){},warn(){},error(){}});return exports;
}
function migrate(schemaFile){const result=spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',schemaFile],{cwd:root,env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8',timeout:90000,windowsHide:true});assert.equal(result.status,0,'Isolated migration failed: '+(result.stderr||result.stdout).slice(-1200));}
async function scopeFunctions(){for(const fn of await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${schema}`){assert(/^fetch_[a-z_]+$/.test(fn.name));await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);}}
const fields={legalName:'Fixture Applicant',birthDate:'1990-01-01',address:'Lingayen, Pangasinan',mobile:'09171234567',emergencyName:'Fixture Contact',emergencyRelationship:'Sibling',emergencyPhone:'09181234567',licenceNumber:'FIXTURE123',licenceCodes:'A,A1,B',licenceExpiry:'2030-01-01',nbiExpiry:'2029-01-01',vehicleMake:'Fixture',vehicleModel:'Model',vehicleYear:'2024',plateNumber:'TEST123',registrationExpiry:'2029-06-30',capacity:'2',displacement:'125',ownership:'OWNER',operatingArea:'Lingayen authorized zone',permitNumber:'FIXTURE-PERMIT'};
(async()=>{
 try{
  assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname=${schema}`).length,0);ownsSchema=true;
  const before=path.join(root,'tmp',schema);fs.mkdirSync(path.join(before,'migrations'),{recursive:true});fs.copyFileSync(path.join(root,'prisma/schema.prisma'),path.join(before,'schema.prisma'));
  for(const entry of fs.readdirSync(path.join(root,'prisma/migrations'),{withFileTypes:true}))if(!['202610240001_rider_applications','202610280001_rider_application_demo','202610280002_application_document_names'].includes(entry.name))fs.cpSync(path.join(root,'prisma/migrations',entry.name),path.join(before,'migrations',entry.name),{recursive:true});
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
  await applicant({action:'save',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields:{...fields,registrationStep:'documents'}});app=(await applicant()).application;
  assert.equal(app.fields.registrationStep,'documents');assertions++;
  await applicant({action:'submit',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields},400);
  await applicant({action:'send-code'});const code=messages.at(-1).text.match(/code is (\d{6})/)[1];
  await applicant({action:'verify-code',code:'000000'===code?'000001':'000000'},400);
  await applicant({action:'verify-code',code});await applicant({action:'verify-code',code},400);app=(await applicant()).application;
  const {requiredDocuments,SECTION_FIELDS}=load('src/lib/rider-application-policy.ts');
  const sharp=require('sharp');const image=await sharp({create:{width:900,height:700,channels:3,background:'#fff'}}).png().toBuffer();
  async function parallelUpload(kind,base,name){const form=new FormData();form.set('file',new File([image],name,{type:'image/png'}));form.set('kind',kind);form.set('version',String(base.version));form.set('uploadContext',base.uploadContext);form.set('documentId',base.documents.find(d=>d.current&&d.kind===kind)?.id??'');const response=await applicantRequest(new NextRequest('http://fixture.invalid/api/rider/application',{method:'POST',body:form}),user.id);return {status:response.status,data:await response.json()};}
  // Independent document slots share a context, but may commit different app versions.
  const parallelBase=app;
  const concurrent=await Promise.all([parallelUpload('PROFILE',parallelBase,'my-portrait.png'),parallelUpload('OR',parallelBase,'my-receipt.png')]);
  assert(concurrent.every(r=>r.status===200),JSON.stringify(concurrent));assertions++;
  app=(await applicant()).application;
  assert.equal(app.version,parallelBase.version+2);assertions++;
  assert.equal(app.documents.find(d=>d.current&&d.kind==='PROFILE').originalName,'my-portrait.png');assertions++;
  assert.equal(app.documents.find(d=>d.current&&d.kind==='OR').originalName,'my-receipt.png');assertions++;
  const sameSlotBase=app;
  const sameSlot=await Promise.all([parallelUpload('CR',sameSlotBase,'first.png'),parallelUpload('CR',sameSlotBase,'second.png')]);
  assert.deepEqual(sameSlot.map(r=>r.status).sort(),[200,409]);assertions++;
  app=(await applicant()).application;assert.equal(app.documents.filter(d=>d.current&&d.kind==='CR').length,1);assertions++;
  const oldContext=app;
  app=(await applicant({action:'save',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields:{...fields,legalName:'Changed fixture'}})).application;
  assert.equal((await parallelUpload('NBI',oldContext,'stale.png')).status,409);assertions++;
  app=(await applicant({action:'save',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields})).application;
  async function upload(kind,expected=200){const form=new FormData();form.set('file',new File([image],'fixture.png',{type:'image/png'}));form.set('kind',kind);form.set('version',String(app.version));const res=await applicantRequest(new NextRequest('http://fixture.invalid/api/rider/application',{method:'POST',body:form}),user.id);const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));assertions++;if(data.application)app=data.application;return data;}
  for(const kind of requiredDocuments('TRICYCLE',['DELIVERY','RIDE'],fields))await upload(kind);
  // Removing a draft upload clears its slot, keeps history and preserves ownership/version checks.
  const accidental=app.documents.find(d=>d.current&&d.kind==='NBI');
  const otherDraft=(await applicant(undefined,200,other.id)).application;
  await applicant({action:'remove-document',version:otherDraft.version,documentId:accidental.id},404,other.id);
  await applicant({action:'remove-document',version:app.version-1,documentId:accidental.id},409);
  app=(await applicant({action:'remove-document',version:app.version,documentId:accidental.id})).application;
  assert(!app.documents.some(d=>d.current&&d.kind==='NBI'));assertions++;
  assert(app.documents.some(d=>d.id===accidental.id&&!d.current));assertions++;
  assert.equal(app.events[0].action,'DOCUMENT_REMOVED');assertions++;
  await applicant({action:'remove-document',version:app.version,documentId:accidental.id},404);
  await applicant({action:'submit',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields},400);
  await upload('NBI');
  app=(await applicant({action:'submit',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields})).application;
  await applicant({action:'remove-document',version:app.version,documentId:app.documents.find(d=>d.current).id},409);
  async function staff(actor,body,expected=200){const res=await staffApplicationRequest(new NextRequest('http://fixture.invalid/api/rider-applications/'+app.id,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:app.version,...body})}:{}),actor,app.id);const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));assertions++;if(data.application)app=data.application;return data;}
  await staff(actors.support,null,403);await staff(actors.reviewer,{action:'claim'});
  for(const section of Object.keys(SECTION_FIELDS))await staff(actors.reviewer,{action:'review',section,status:'ACCEPTED'});
  for(const doc of app.documents.filter(d=>d.current))await staff(actors.reviewer,{action:'review',documentId:doc.id,status:doc.kind==='OR'?'NEEDS_CORRECTION':'ACCEPTED',reason:'Upload the current clear official receipt.'});
  await staff(actors.reviewer,{action:'recommend'},400);await staff(actors.reviewer,{action:'corrections'});
  assert(messages.at(-1).text.includes('official receipt'));assertions++;
  const acceptedNbi=app.documents.find(d=>d.current&&d.kind==='NBI').id;
  await applicant({action:'remove-document',version:app.version,documentId:acceptedNbi},409);
  const flaggedReceipt=app.documents.find(d=>d.current&&d.kind==='OR');
  await applicant({action:'remove-document',version:app.version,documentId:flaggedReceipt.id},409);
  await upload('NBI',400);await upload('OR');
  const accidentalReplacement=app.documents.find(d=>d.current&&d.kind==='OR');
  app=(await applicant({action:'remove-document',version:app.version,documentId:accidentalReplacement.id})).application;
  assert.equal(app.documents.find(d=>d.current&&d.kind==='OR').id,flaggedReceipt.id);assertions++;
  assert.equal(app.documents.find(d=>d.current&&d.kind==='OR').reason,flaggedReceipt.reason);assertions++;
  assert.equal(app.documents.find(d=>d.id===accidentalReplacement.id).current,false);assertions++;
  await applicant({action:'submit',version:app.version,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE'],fields},400);
  await upload('OR');
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
  // Live demo feature: real authentication/verification semantics, simulated SMTP and private Blob.
  const demoUser=await db.user.create({data:{email:'demo-'+schema+'@example.invalid',name:'Demo Integration Rider',role:'RIDER',riderProfile:{create:{vehicleClass:'MOTORCYCLE'}},riderPresence:{create:{}}}});
  let demo=(await applicant(null,200,demoUser.id)).application;
  await applicant({action:'demo-enable',version:demo.version},400,demoUser.id);
  await applicant({action:'send-code'},200,demoUser.id);
  await applicant({action:'verify-code',code:messages.at(-1).text.match(/code is (\d{6})/)[1]},200,demoUser.id);
  demo=(await applicant(null,200,demoUser.id)).application;
  demo=(await applicant({action:'save',version:demo.version,fields:{...fields,address:'Saved original real draft address'},vehicleClass:'TRICYCLE',services:['RIDE']},200,demoUser.id)).application;
  demo=(await applicant({action:'demo-enable',version:demo.version},200,demoUser.id)).application;
  assert.equal(demo.isDemo,true);assertions++;
  demo=(await applicant({action:'save',version:demo.version,isDemo:false,fields,vehicleClass:'TRICYCLE',services:['DELIVERY','RIDE']},200,demoUser.id)).application;
  assert.equal(demo.isDemo,true);assertions++;
  const {POST:demoStep}=load('../fetch-rider/src/app/api/rider/application/demo/route.ts');
  async function step(body,expected=200,origin='http://fixture.invalid',complete=true) {
    let data, parts=0;
    do {
      const before=demo.documents?.length||0;
      const response=await demoStep(new NextRequest('http://fixture.invalid/api/rider/application/demo',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({version:demo.version,...body})}));
      data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));assertions++;if(data.application)demo=data.application;
      if(expected===200) { assert(demo.documents.length-before<=1,'A request must upload at most one document');assertions++; }
      assert(++parts<=15,'Demo continuation must terminate');
    } while(complete && data.demoContinue);
    return data;
  }
  await step({action:'documents'},401); demoSession={uid:other.id,role:'RIDER'}; await step({action:'documents'},403);
  demoSession={uid:demoUser.id,role:'RIDER'};
  await step({action:'documents'},403,'https://other.invalid'); await step({action:'verify'},400); await step({action:'details',version:demo.version-1},409);
  await step({action:'details'});
  const firstPart=await step({action:'documents'},200,'http://fixture.invalid',false);assert(firstPart.demoContinue);assert.equal(demo.documents.length,1);assertions+=2;
  const archivedProfile=demo.documents[0].id;
  await step({action:'details'});assert(demo.documents.every(d=>!d.current));assertions++;
  await step({action:'documents'},200,'http://fixture.invalid',false);
  const savedProfile=demo.documents.find(d=>d.current&&d.kind==='PROFILE').id;
  assert.notEqual(savedProfile,archivedProfile);assert(demo.documents.some(d=>d.id===archivedProfile&&!d.current));assertions+=2;
  await step({action:'documents'});assert(demo.documents.some(d=>d.id===savedProfile&&d.current));assertions++;
  const completedCount=demo.documents.length;await step({action:'documents'});assert.equal(demo.documents.length,completedCount);assertions++;
  await step({action:'review'});
  assert(requiredDocuments(demo.vehicleClass,demo.services,demo.fields).every(kind=>demo.documents.some(d=>d.current&&d.kind===kind)));assertions++;
  const original=user.id; // Review helpers below use app; real user's previous assertions are complete.
  app=(await applicant({action:'submit',version:demo.version,fields:demo.fields,vehicleClass:demo.vehicleClass,services:demo.services},200,demoUser.id)).application;
  await staff(actors.reviewer,{action:'claim'});
  for(const section of Object.keys(SECTION_FIELDS))await staff(actors.reviewer,{action:'review',section,status:'ACCEPTED'});
  for(const document of app.documents.filter(d=>d.current))await staff(actors.reviewer,{action:'review',documentId:document.id,status:'ACCEPTED'});
  const demoNbi=app.documents.find(d=>d.current&&d.kind==='NBI').id;
  await staff(actors.reviewer,{action:'review',documentId:app.documents.find(d=>d.current&&d.kind==='OR').id,status:'NEEDS_CORRECTION',reason:'Replace only this demo official receipt.'});
  await staff(actors.reviewer,{action:'corrections'});demo=app;
  await step({action:'documents'});
  app=(await applicant({action:'submit',version:demo.version,fields:demo.fields,vehicleClass:demo.vehicleClass,services:demo.services},200,demoUser.id)).application;
  assert(app.documents.some(d=>d.id===demoNbi&&d.current&&d.status==='ACCEPTED'));assertions++;
  await staff(actors.reviewer,{action:'review',documentId:app.documents.find(d=>d.current&&d.kind==='OR').id,status:'ACCEPTED'});
  await staff(actors.reviewer,{action:'recommend'});
  await staff(actors.admin,{action:'schedule',orientationAt:new Date(Date.now()+60000).toISOString(),venue:'Demo orientation room',instructions:'Demonstration appointment only. Do not attend a real venue.'});
  assert(messages.at(-1).subject.startsWith('[DEMO]'));assert.equal(messages.at(-1).to,demoUser.email);assert.equal(messages.at(-1).attachments[0].content.subarray(0,5).toString(),'%PDF-');assertions+=3;
  await db.riderApplication.update({where:{id:app.id},data:{orientationAt:new Date(Date.now()-60000)}});app=(await applicant(null,200,demoUser.id)).application;
  await staff(actors.reviewer,{action:'assessment',attended:true,passed:true,notes:'Demo orientation and vehicle assessment completed.'});
  await staff(actors.admin,{action:'activate',services:app.services},403);
  await staff(actors.admin,{action:'complete-demo',services:app.services});
  assert.equal(app.status,'DEMO_COMPLETED');assert.equal(await db.riderServiceApproval.count({where:{userId:demoUser.id}}),0);assert(!messages.at(-1).text.includes('are activated'));assertions+=3;
  const oldDocumentCount=app.documents.length;
  app=(await applicant({action:'demo-reset',version:app.version},200,demoUser.id)).application;
  assert.equal(app.isDemo,false);assert.equal(app.status,'DRAFT');assert.equal(app.documents.filter(d=>d.current).length,0);assert.equal(app.documents.length,oldDocumentCount);assert.deepEqual(Object.keys(app.fieldReviews),[]);assert(app.emailVerifiedAt);assertions+=6;
  assert.equal(app.fields.address,'Saved original real draft address');assert.equal(app.vehicleClass,'TRICYCLE');assert.deepEqual(app.services,['RIDE']);assertions+=3;
  await applicant({action:'demo-enable',version:app.version},409,original);
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
