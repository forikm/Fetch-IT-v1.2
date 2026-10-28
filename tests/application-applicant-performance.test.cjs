const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const root = path.resolve(__dirname, '..');

function fixture() {
  const fields = { legalName:'Fixture Applicant',birthDate:'1990-01-01',address:'Lingayen, Pangasinan',mobile:'09171234567',emergencyName:'Fixture Contact',emergencyRelationship:'Sibling',emergencyPhone:'09181234567',licenceNumber:'FIXTURE123',licenceCodes:'A,A1,B',licenceExpiry:'2030-01-01',nbiExpiry:'2029-01-01',vehicleMake:'Fixture',vehicleModel:'Model',vehicleYear:'2024',plateNumber:'TEST123',registrationExpiry:'2029-06-30',capacity:'30',displacement:'125',ownership:'OWNER',operatingArea:'Lingayen',registrationStep:'documents' };
  const app = { id:'application',userId:'rider',version:3,status:'DRAFT',vehicleClass:'MOTORCYCLE',services:['DELIVERY'],fields,fieldReviews:{},emailVerifiedAt:new Date(),verifiedEmail:'fixture@example.invalid',documents:['PROFILE','LICENCE_FRONT','LICENCE_BACK','NBI','OR','CR'].map(kind=>({id:kind,kind,version:1,current:true,status:'PENDING'})),events:[],emails:[],user:{id:'rider',role:'RIDER',isBanned:false,name:'Fixture Applicant',email:'fixture@example.invalid'} };
  const counts = { snapshots:0, uploads:0, writes:0 };
  const copy = () => structuredClone(app);
  const db = {
    $queryRaw:async()=>[], $transaction:async cb=>cb(db),
    user:{findUnique:async()=>{throw Error('Unnecessary user/profile reload');}},
    riderApplication:{
      findUnique:async()=>{counts.snapshots++;return copy();},
      findUniqueOrThrow:async()=>{counts.snapshots++;return copy();},
      upsert:async()=>{throw Error('Existing applications must not use upsert');},
      update:async({data,include})=>{assert.equal(include,undefined);counts.writes++;for(const [key,value] of Object.entries(data)) app[key]=key==='version'?app.version+value.increment:value;return copy();},
    },
    riderApplicationDocument:{
      updateMany:async({where,data})=>{app.documents.filter(d=>d.kind===where.kind&&d.current).forEach(d=>Object.assign(d,data));},
      create:async({data})=>{app.documents.unshift({id:'new-document',status:'PENDING',current:true,...data});},
    },
    riderApplicationEvent:{create:async({data})=>{app.events.unshift({id:'event',...data});}},
    riderServiceApproval:{findMany:async()=>[]},booking:{count:async()=>0},
  };
  const mocks = {
    './db':{db}, './request-guard':{limitRequests:async()=>{},RateLimitError:class extends Error{}},
    './application-upload':{storeApplicationDocument:async()=>{counts.uploads++;return {pathname:'private/file.jpg',mimeType:'image/jpeg'};}},
    './application-storage':{},'./application-mail':{},'./application-demo-mode':{},
  };
  const cache = new Map();
  function load(file) {
    const filename=path.resolve(root,file);if(cache.has(filename))return cache.get(filename);
    const exports={};cache.set(filename,exports);
    const localRequire=name=>Object.hasOwn(mocks,name)?mocks[name]:name.startsWith('.')?load(path.resolve(path.dirname(filename),name+'.ts')):require(name);
    new Function('exports','require',ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(exports,localRequire);
    return exports;
  }
  const api=load('src/lib/application-applicant-api.ts').applicantRequest;
  return {app,counts,api};
}

test('draft saves and submission use one existing lookup, one locked snapshot and one committed snapshot', async()=>{
  for(const action of ['save','submit']){
    const f=fixture();
    const response=await f.api(new NextRequest('https://rider.example.invalid/api/rider/application',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,version:3,fields:f.app.fields,vehicleClass:'MOTORCYCLE',services:['DELIVERY']})}),'rider');
    assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.application.version,4);
    assert.equal(result.application.events[0].action,action==='submit'?'SUBMITTED':'DRAFT_SAVED');
    assert.deepEqual(f.counts,{snapshots:3,uploads:0,writes:1});
  }
});

test('an upload returns its committed document without a trailing reload or preliminary save', async()=>{
  const f=fixture(),form=new FormData();form.set('file',new File(['fixture'],'fixture.jpg',{type:'image/jpeg'}));form.set('kind','OR');form.set('version','3');
  const response=await f.api(new NextRequest('https://rider.example.invalid/api/rider/application',{method:'POST',body:form}),'rider');
  assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.application.documents.find(d=>d.current&&d.kind==='OR').id,'new-document');
  assert.equal(result.application.events[0].action,'DOCUMENT_UPLOADED');
  assert.deepEqual(f.counts,{snapshots:3,uploads:1,writes:1});
});
