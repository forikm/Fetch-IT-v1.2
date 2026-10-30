/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const root=path.resolve(__dirname,".."),rider=process.env.PICKUP_RIDER_ROOT||path.resolve(root,"../fetch-rider");
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
function nodes(node){return !node||typeof node!=="object"?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
const text=tree=>nodes(tree).flatMap(n=>[n.props?.children].flat().filter(x=>typeof x==="string")).join(" ");
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(file,component,request){
 let index=0,refIndex=0,poll;const slots=[],refs=[],requests=[];
 const react={useState:value=>{const i=index++;if(!(i in slots))slots[i]=value;return[slots[i],next=>{slots[i]=typeof next==="function"?next(slots[i]):next;}];},useRef:value=>refs[refIndex++]??={current:value}};
 const exports={};const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function("exports","require","fetch",code)(exports,name=>{
  if(name==="react")return react;if(name==="react/jsx-runtime")return jsx;
  if(name==="@/hooks/use-online-status")return{useOnlineStatus:()=>true};
  if(name==="@/hooks/use-visible-poll")return{useVisiblePoll:(_,callback)=>{poll=callback;}};
  if(name==="@/lib/customer-request")return{customerResponse:async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);return data;}};
  return{Button:"button"};
 },async(url,init)=>{requests.push({url,init});return request(url,init);});
 return {requests,render(){index=0;refIndex=0;return exports[component]({bookingId:"booking"});},poll:()=>poll(new AbortController().signal)};
}
test("rider pickup confirmation prevents duplicate submits and shows the next action",async()=>{
 let finish;const app=fixture(path.join(rider,"src/components/fetchit/rider/pickup-progress.tsx"),"PickupProgress",(_,init)=>init?.method==="POST"?new Promise(resolve=>{finish=resolve;}):Response.json({pickupProgress:{stage:"ACCEPTED",at:null}}));
 app.render();await app.poll();let tree=app.render();
 const heading=nodes(tree).find(n=>n.type==="button"&&n.props.children==="I’m heading to pickup");
 heading.props.onClick();heading.props.onClick();await flush();
 assert.equal(app.requests.filter(r=>r.init?.method==="POST").length,1);
 finish(Response.json({pickupProgress:{stage:"HEADING",at:new Date().toISOString()}}));await flush();tree=app.render();
 assert.match(text(tree),/heading to pickup/);
 assert(nodes(tree).some(n=>n.type==="button"&&n.props.children==="I’ve arrived at pickup"));
});
test("a late pickup response cannot undo a newer driver arrival report",async()=>{
 let release,count=0;
 const app=fixture(path.join(root,"src/components/fetchit/customer/pickup-progress.tsx"),"CustomerPickupProgress",()=>++count===1?new Promise(resolve=>{release=resolve;}):Response.json({pickupProgress:{stage:"ARRIVED",at:new Date().toISOString()}}));
 app.render();const old=app.poll();await app.poll();
 release(Response.json({pickupProgress:{stage:"HEADING",at:new Date().toISOString()}}));await old;
 assert.match(text(app.render()),/Driver reports arrival at pickup/);
 assert.match(text(app.render()),/Share your pickup code only when you meet/);
});
