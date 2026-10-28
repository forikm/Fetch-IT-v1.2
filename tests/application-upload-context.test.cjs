const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(file){const name=path.resolve(root,file);if(cache.has(name))return cache.get(name);const exports={};cache.set(name,exports);const localRequire=id=>id==='./db'?{db:{}}:id.startsWith('.')?load(path.resolve(path.dirname(name),id+'.ts')):require(id);new Function('exports','require',ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,localRequire);return exports;}
const {applicationUploadContext,applicationFilename}=load('src/lib/rider-application.ts');
test('parallel document writes and navigation preserve context; changed details, status and demo mode invalidate it',()=>{
  const app={status:'DRAFT',vehicleClass:'MOTORCYCLE',services:['DELIVERY'],isDemo:false,fields:{legalName:'Fixture',registrationStep:'details'}};
  const context=applicationUploadContext(app);
  assert.equal(applicationUploadContext({...app,version:99,documents:[{id:'another-slot'}],fields:{registrationStep:'documents',legalName:'Fixture'}}),context);
  for(const changed of [{...app,status:'SUBMITTED'},{...app,isDemo:true},{...app,vehicleClass:'SEDAN'},{...app,fields:{...app.fields,legalName:'Changed'}}])assert.notEqual(applicationUploadContext(changed),context);
});
test('original filenames are bounded and stripped of fake paths and control characters',()=>{
  assert.equal(applicationFilename('C:\\fakepath\\my-photo.png'),'my-photo.png');
  assert.equal(applicationFilename('../../clearance\r\n.pdf'),'clearance.pdf');
  assert.equal(applicationFilename('  '),'Uploaded document');
  assert.equal(applicationFilename('a'.repeat(300)).length,160);
});
