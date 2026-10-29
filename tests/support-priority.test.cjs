const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {NextRequest,NextResponse}=require('next/server');
const root=path.resolve(__dirname,'..');
for(const status of ['PENDING','ACCEPTED','PICKED_UP','DELIVERED','CANCELLED',null])test(`New support request for ${status??'no booking'} does not set automatic priority`,async()=>{
  let created;
  const db={$queryRaw:async()=>[],supportTicket:{findFirst:async()=>null,create:async({data})=>{created=data;return {id:'ticket',...data};}},booking:{findFirst:async()=>status?{status,type:'DELIVERY'}:null}};
  db.$transaction=async fn=>fn(db);
  class CustomerError extends Error{constructor(message,status=400){super(message);this.status=status;}}
  const cache=new Map();
  function load(file){const filename=path.resolve(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports,process,console,require(name){if(name==='@/lib/db')return {db};if(name==='@/lib/customer-access')return {CustomerError,requireCustomer:async()=>({uid:'customer'}),customerErrorResponse:error=>NextResponse.json({error:error.message},{status:error.status||503})};if(name==='@/lib/request-guard')return {withRequestLog:(_,fn)=>fn,RateLimitError:class extends Error{}};if(name.startsWith('@/'))return load(name.replace('@/','src/')+'.ts');return require(name);}});return exports;}
  const route=load('src/app/api/support/route.ts');const response=await route.POST(new NextRequest('https://test.invalid/api/support',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'Please help me with this issue.',category:status?'BOOKING':'OTHER',...(status?{bookingId:'booking'}:{}),priority:'URGENT'})}));
  assert.equal(response.status,201);assert.equal(created.customerId,'customer');assert.equal(Object.hasOwn(created,'priority'),false);
});
