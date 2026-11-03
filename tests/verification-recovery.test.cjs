const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function fixture({existing=null,validToken=true}={}) {
  let sends=0, issued=0;
  const target={uid:'firebase-customer',email:'person@example.invalid',disabled:false,providerData:[{providerId:'password'}]};
  const deps={
    'node:crypto':require('node:crypto'),
    'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
    './db':{db:{user:{findUnique:async()=>existing}}},
    './firebase-admin':{getCustomerAdminAuth:()=>({verifyIdToken:async()=>{if(!validToken)throw Error('expired');return{uid:target.uid,email:target.email};},getUser:async()=>target})},
    './auth-email-code':{EMAIL_CODE_TTL_MS:600000,issueEmailCode:async()=>{issued++;return{id:'challenge',expiresAt:new Date(Date.now()+600000),code:'123456'};}},
    './auth-email-sender':{requireEmailCodeSender(){},sendAuthEmailCode:async()=>{sends++;}},
    './request-guard':{clientAddress:()=> 'fixture',limitRequests:async()=>{}},
    './password-policy':{},'./password':{},
  };
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/auth-email-api.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(!deps[name])throw Error(name);return deps[name];},Date,console});
  return{request:()=>exports.handleEmailCode({headers:new Headers(),nextUrl:{origin:'https://fixture.invalid'},json:async()=>({idToken:'fixture'})},'send-verification'),get sends(){return sends;},get issued(){return issued;}};
}
test('an expired token requires sign-in and sends no code',async()=>{
  const h=fixture({validToken:false}),r=await h.request();assert.equal(r.status,401);assert.equal(h.sends,0);assert.equal(h.issued,0);
});
test('incompatible existing accounts get a conflict explanation without sending a code',async()=>{
  for(const existing of [{role:'RIDER',authIdentities:[]},{role:'CUSTOMER',isBanned:true,authIdentities:[]},{role:'CUSTOMER',authIdentities:[{provider:'FIREBASE',providerUserId:'someone-else'}]}]){
    const h=fixture({existing}),r=await h.request();assert.equal(r.status,409);assert.match((await r.json()).error,/app where you registered/);assert.equal(h.sends,0);assert.equal(h.issued,0);
  }
});
test('a verified token for a new or correctly linked customer can request verification',async()=>{
  for(const existing of [null,{role:'CUSTOMER',isBanned:false,authIdentities:[{provider:'FIREBASE',providerUserId:'firebase-customer'}]}]){
    const h=fixture({existing}),r=await h.request();assert.equal(r.status,200);assert.equal(h.sends,1);assert.equal(h.issued,1);
  }
});
