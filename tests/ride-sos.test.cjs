const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
class CustomerError extends Error { constructor(message,status){super(message);this.status=status;} }
const exportsForSos={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ride-sos.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsForSos,Date,require:()=>({CustomerError})});
const {sosLocation,sendRideSos}=exportsForSos;
const fix=()=>({lat:16.02,lng:120.23,accuracy:12,capturedAt:Date.now()});
function harness({owner='customer',type='RIDE',status='IN_TRANSIT',existing=null,rider={id:'assigned-rider',name:'Assigned Driver',phone:'09171234567',riderProfile:{vehiclePlate:'ABC-123'}}}={}){
 const records=[];const tx={$queryRaw:async()=>[],booking:{findFirst:async({where})=>where.customerId===owner?{type,status,refCode:'RIDE-123',vehicleClass:'TRICYCLE',rider}:null},supportTicket:{findFirst:async()=>existing,create:async({data})=>{records.push(data);return{id:'sos-ticket',createdAt:new Date()};}}};
 return {records,db:{$transaction:async fn=>fn(tx)}};
}
test('SOS rejects missing, stale, future, malformed and nonfinite GPS',()=>{
 for(const value of [null,{}, {...fix(),lat:91},{...fix(),lng:Infinity},{...fix(),accuracy:-1},{...fix(),capturedAt:Date.now()-61000},{...fix(),capturedAt:Date.now()+6000}])assert.throws(()=>sosLocation(value));
 assert.equal(sosLocation(fix()).lat,16.02);
});
test('only the owner of an active passenger booking can send SOS',async()=>{
 for(const options of [{owner:'another-customer'},{type:'DELIVERY'},{status:'PENDING'},{status:'DELIVERED'},{status:'CANCELLED'}]){
  const h=harness(options);await assert.rejects(sendRideSos(h.db,'ride','customer',fix()),e=>[403,404,409].includes(e.status));assert.equal(h.records.length,0);
 }
});
test('SOS saves an urgent linked ticket with GPS, capture time and accuracy',async()=>{
 const h=harness();await sendRideSos(h.db,'ride','customer',fix());const ticket=h.records[0];assert.equal(ticket.priority,'URGENT');assert.equal(ticket.bookingId,'ride');assert.equal(ticket.customerId,'customer');assert.match(ticket.message,/URGENT SAFETY ALERT\n/);assert.match(ticket.message,/GPS: 16.02, 120.23/);assert.match(ticket.message,/Accuracy: 12 m/);assert.match(ticket.message,/Captured: /);
});
test('retry returns the unresolved SOS without duplicate tickets',async()=>{
 const h=harness({existing:{id:'existing',createdAt:new Date()}});assert.equal((await sendRideSos(h.db,'ride','customer',fix())).id,'existing');assert.equal(h.records.length,0);
});

test('staff receives the assigned rider snapshot without trusting client rider fields',async()=>{
 const h=harness();await sendRideSos(h.db,'ride','customer',{...fix(),rider:{name:'Spoofed driver'}});
 for(const text of ['Booking: RIDE-123','Rider: Assigned Driver','Rider ID: assigned-rider','Rider phone: 09171234567','Vehicle: TRICYCLE','Plate: ABC-123']) assert.ok(h.records[0].message.includes(text));
 assert.ok(!h.records[0].message.includes('Spoofed'));
 const missing=harness({rider:null});await sendRideSos(missing.db,'ride','customer',fix());assert.match(missing.records[0].message,/No assigned rider/);
});
