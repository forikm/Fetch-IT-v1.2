/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
const compile=file=>ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helperSource=compile("src/lib/road-route.ts"),hookSource=compile("src/hooks/use-road-route.ts");
const pickup={lat:16.0206,lng:120.2321},dropoff={lat:16.0277,lng:120.2299};
const bend={lat:16.023,lng:120.2303},path=[pickup,bend,dropoff];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function service(compute){
 const exports={},calls=[],timers=new Map();let next=0;
 new Function("exports","window","setTimeout","clearTimeout",helperSource)(exports,{google:{maps:{importLibrary:async name=>{assert.equal(name,"routes");return{Route:{computeRoutes:async request=>{calls.push(request);return compute(request);}}};}}}},
 callback=>{timers.set(++next,callback);return next;},id=>timers.delete(id));
 return{...exports,calls,timers};
}
test("requests a driving road path and shares simultaneous preview/tracking calls",async()=>{
 let release;const app=service(()=>new Promise(resolve=>{release=resolve;}));
 const first=app.requestRoadRoute(pickup,dropoff),second=app.requestRoadRoute({...pickup},{...dropoff});
 assert.equal(first,second);await flush();assert.equal(app.calls.length,1);
 assert.deepEqual(app.calls[0],{origin:pickup,destination:dropoff,travelMode:"DRIVING",fields:["path","warnings"]});
 release({routes:[{path,warnings:["Check local road restrictions."]}]});
 assert.deepEqual(await first,{path,warnings:["Check local road restrictions."]});assert.equal(app.timers.size,0);
});
test("routing failure can retry and never fabricates a straight-line route",async()=>{
 let fails=true;const app=service(()=>fails?{routes:[]}:{routes:[{path}]});
 await assert.rejects(app.requestRoadRoute(pickup,dropoff),/No road route/);
 fails=false;assert.deepEqual((await app.requestRoadRoute(pickup,dropoff)).path,path);assert.equal(app.calls.length,2);
});
test("invalid points and malformed returned geometry do not render a route",async()=>{
 const app=service(()=>({routes:[{path:[pickup,{lat:NaN,lng:0}]}]}));
 await assert.rejects(app.requestRoadRoute({lat:91,lng:0},dropoff),/Invalid/);assert.equal(app.calls.length,0);
 await assert.rejects(app.requestRoadRoute(pickup,dropoff),/No road route/);
});
test("a timed-out request is cleared and its late response cannot replace a retry",async()=>{
 let release,first=true;const app=service(()=>first?(first=false,new Promise(resolve=>{release=resolve;})):{routes:[{path}]});
 const slow=app.requestRoadRoute(pickup,dropoff);await flush();
 const rejected=assert.rejects(slow,/timed out/);[...app.timers.values()][0]();await rejected;
 assert.deepEqual((await app.requestRoadRoute(pickup,dropoff)).path,path);
 release({routes:[{path:[pickup,dropoff]}]});await flush();assert.equal(app.timers.size,0);
});
function hook(request){
 let index=0,queue=[],tree,props={pickup,dropoff,extraPoints:[],ready:true,mapVersion:1};
 const slots=[],effects=new Map(),lines=[],fits=[];let requests=0;
 const react={
  useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return[slots[i],next=>{slots[i]=typeof next==="function"?next(slots[i]):next;}];},
  useRef(initial){const i=index++;return slots[i]??={current:initial};},
  useEffect(fn,deps){const i=index++,old=effects.get(i);if(!old||deps.some((dep,j)=>!Object.is(dep,old.deps[j])))queue.push(()=>{old?.cleanup?.();effects.set(i,{deps,cleanup:fn()});});},
 };
 class Polyline{constructor(options){this.options=options;this.map=options.map;lines.push(this);}setMap(map){this.map=map;}}
 class Bounds{points=[];extend(point){this.points.push(point);}}
 const mapRef={current:{fitBounds(bounds){fits.push(bounds.points);}}},exports={};
 new Function("exports","require","window",hookSource)(exports,name=>name==="react"?react:{roadRouteKey:(a,b)=>[a.lat,a.lng,b.lat,b.lng].join(","),requestRoadRoute:(...args)=>{requests++;return request(...args);}},
 {google:{maps:{Polyline,LatLngBounds:Bounds}}});
 function render(update={}){props={...props,...update};index=0;tree=exports.useRoadRoute(mapRef,props.ready,props.pickup,props.dropoff,props.extraPoints,props.mapVersion);for(const effect of queue.splice(0))effect();return tree;}
 return{render,lines,fits,mapRef,requests:()=>requests,close(){for(const effect of effects.values())effect.cleanup?.();}};
}
test("the rendered line uses every road bend, frames the route, and does not reroute for GPS movement",async()=>{
 const app=hook(async()=>({path,warnings:[]}));let state=app.render();assert.equal(state.loading,true);await flush();state=app.render();
 assert.equal(state.loading,false);assert.deepEqual(app.lines[0].options.path,path);assert(app.fits[0].includes(bend));
 app.render({extraPoints:[{lat:16.025,lng:120.231}]});await flush();assert.equal(app.requests(),1);
 app.close();assert.equal(app.lines[0].map,null);
});
test("a changed booking ignores its old response and attaches only the new path",async()=>{
 let release,calls=0;const app=hook(()=>++calls===1?new Promise(resolve=>{release=resolve;}):Promise.resolve({path:[dropoff,bend,pickup],warnings:[]}));
 app.render();app.render({pickup:dropoff,dropoff:pickup});await flush();
 release({path,warnings:[]});await flush();
 assert.equal(app.lines.length,1);assert.deepEqual(app.lines[0].options.path,[dropoff,bend,pickup]);app.close();
});
test("route errors preserve the map and retry succeeds",async()=>{
 let fail=true;const app=hook(async()=>{if(fail)throw Error("Not enabled");return{path,warnings:[]};});
 app.render();await flush();let state=app.render();assert.match(state.error,/pins are still shown/);assert.equal(app.lines.length,0);
 fail=false;state.retry();app.render();await flush();state=app.render();assert.equal(state.error,null);assert.equal(app.lines.length,1);app.close();
});
test("closing a map before its route loads attaches no late line",async()=>{
 let release;const app=hook(()=>new Promise(resolve=>{release=resolve;}));app.render();app.close();release({path,warnings:[]});await flush();assert.equal(app.lines.length,0);
});

test("recreating a map attaches the route to the new map and detaches the old line",async()=>{
 const app=hook(async()=>({path,warnings:[]}));
 app.render();await flush();app.render();
 const original=app.lines[0],nextMap={fitBounds(){}};
 app.mapRef.current=nextMap;app.render({mapVersion:2});await flush();app.render();
 assert.equal(original.map,null);assert.equal(app.lines.length,2);assert.equal(app.lines[1].map,nextMap);
 app.close();assert.equal(app.lines[1].map,null);
});
