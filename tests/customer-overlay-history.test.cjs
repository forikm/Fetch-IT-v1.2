/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
const code=ts.transpileModule(fs.readFileSync("src/hooks/use-customer-overlay-history.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function harness(){
 const listeners=new Set(),entries=[{fetchitView:"ride-dashboard"}];let cursor=0,active;
 const history={get state(){return entries[cursor];},pushState(state){entries.splice(++cursor);entries[cursor]=state;},back(){if(cursor){cursor--;for(const callback of [...listeners])callback({state:this.state});}}};
 const window={history,addEventListener:(_,callback)=>listeners.add(callback),removeEventListener:(_,callback)=>listeners.delete(callback)};
 const react={useRef(value){const i=active.ref++;return active.refs[i]??={current:value};},useEffect(effect,deps){const i=active.effect++,previous=active.effects[i];if(!previous||deps.some((d,j)=>d!==previous.deps[j]))active.pending.push(()=>{previous?.cleanup?.();active.effects[i]={deps,cleanup:effect()};});}};
 const exports={};new Function("exports","require","window",code)(exports,()=>react,window);
 function mount(onBack){const instance={refs:[],effects:[],pending:[],ref:0,effect:0};const render=open=>{active=instance;instance.ref=0;instance.effect=0;exports.useCustomerOverlayHistory(open,onBack);for(const effect of instance.pending.splice(0))effect();};render(true);return{close:()=>render(false),dispose(){for(const effect of instance.effects)effect.cleanup?.();}};}
 return{history,mount,listeners};
}
test("phone Back closes an overlay before leaving the booking screen",()=>{
 const app=harness();let closed=0;const overlay=app.mount(()=>{closed++;overlay.close();});
 assert(app.history.state.fetchitOverlay);app.history.back();assert.equal(closed,1);assert.equal(app.history.state.fetchitView,"ride-dashboard");assert.equal(app.listeners.size,0);
});
test("closing an overlay with its button consumes the same Back entry",()=>{
 const app=harness();let closed=0;const overlay=app.mount(()=>closed++);overlay.close();assert.equal(app.history.state.fetchitOverlay,undefined);assert.equal(closed,0);assert.equal(app.listeners.size,0);
});
test("Back unwinds three nested overlays one at a time",()=>{
 const app=harness(),closed=[];const a=app.mount(()=>{closed.push("trip");a.close();});const b=app.mount(()=>{closed.push("help");b.close();});const c=app.mount(()=>{closed.push("details");c.close();});
 app.history.back();assert.deepEqual(closed,["details"]);app.history.back();assert.deepEqual(closed,["details","help"]);app.history.back();assert.deepEqual(closed,["details","help","trip"]);
});
test("a pending submission can retain its overlay when Back is pressed",()=>{
 const app=harness();let pending=true,closed=0;const overlay=app.mount(()=>{if(pending)return false;closed++;overlay.close();});
 const token=app.history.state.fetchitOverlay;app.history.back();assert.equal(app.history.state.fetchitOverlay,token);assert.equal(closed,0);pending=false;app.history.back();assert.equal(closed,1);
});
