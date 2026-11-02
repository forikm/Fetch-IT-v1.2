const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript');
function fixture({linked=null,existing=null,verified=true}={}) {
  let created=0,cookies=0;
  const db={authIdentity:{findUnique:async()=>linked?{user:linked}:null},user:{findUnique:async()=>existing,create:async({data})=>{created++;return{id:'new',...data};}}};
  const exports={};
  const deps={
    '@/lib/request-guard':{withRequestLog:(_,fn)=>fn,RateLimitError:class extends Error{},limitRequests:async()=>{},clientAddress:()=> 'fixture',safeErrorCode:()=> 'fixture'},
    'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
    '@/lib/db':{db},'@/lib/firebase-admin':{getCustomerAdminAuth:()=>({verifyIdToken:async()=>({uid:'firebase',email:'person@example.invalid',email_verified:verified,auth_time:Math.floor(Date.now()/1000)})})},
    '@/lib/session':{createSessionToken:()=> 'fixture',setSessionCookie:async()=>{cookies++;}},
    '@/lib/phone':{normalizePhilippinePhone:value=>{if(value!=='+639171234567')throw Error('Phone number is required.');return value;}},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/auth/firebase-session/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!deps[name])throw Error(name);return deps[name];},console,Date});
  return {post:phone=>exports.POST({json:async()=>({idToken:'verified-fixture',phone})}),get created(){return created;},get cookies(){return cookies;}};
}
test('missing signup phone gives an actionable profile-required response without creating an account or cookie',async()=>{
  const app=fixture(), response=await app.post();assert.equal(response.status,400);assert.equal((await response.json()).code,'PROFILE_REQUIRED');assert.equal(app.created,0);assert.equal(app.cookies,0);
});
test('existing linked customer needs no new phone to sign in',async()=>{
  const app=fixture({linked:{id:'customer',email:'person@example.invalid',role:'CUSTOMER',name:'Person',phone:'+639171234567'}}), response=await app.post();assert.equal(response.status,200);assert.equal(app.cookies,1);assert.equal(app.created,0);
});
test('email-only account matches are rejected before signup phone validation',async()=>{
  const app=fixture({existing:{id:'legacy'}}), response=await app.post();assert.equal(response.status,409);assert.equal(app.created,0);assert.equal(app.cookies,0);
});
test('unverified identities cannot enter profile completion or establish a session',async()=>{
  const app=fixture({verified:false}), response=await app.post('+639171234567');assert.equal(response.status,403);assert.equal(app.created,0);assert.equal(app.cookies,0);
});
test('validated phone completes a verified new profile',async()=>{
  const app=fixture(), response=await app.post('+639171234567');assert.equal(response.status,200);assert.equal((await response.json()).isNewUser,true);assert.equal(app.created,1);assert.equal(app.cookies,1);
});
