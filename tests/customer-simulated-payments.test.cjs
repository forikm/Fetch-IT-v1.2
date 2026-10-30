/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"), ts=require("typescript");
const ui=new Proxy({}, {get:(_,name)=>String(name)});
function load(file,mocks={},globals={},extra=""){
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(file,"utf8")+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function("exports","require",...Object.keys(globals),source)(exports,name=>{
  if(name==="react/jsx-runtime")return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  return Object.hasOwn(mocks,name)?mocks[name]:ui;
 },...Object.values(globals));
 return exports;
}
const constants=load("src/lib/constants.ts");
function nodes(node){return !node||typeof node!=="object"?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
const text=tree=>nodes(tree).flatMap(n=>[n.props?.children].flat().filter(v=>typeof v==="string"||typeof v==="number")).join(" ");
test("production ride and delivery forms offer every simulated method and retain the saved selection",()=>{
 for(const bookingType of ["RIDE","DELIVERY"])for(const method of ["DEMO_GCASH","DEMO_MAYA","DEMO_BANK"]){
  let selected=method;
  const {BookingForm}=load("src/components/fetchit/customer/customer-dashboard.tsx",{
   react:{useState:initial=>[initial===0?3:initial,()=>{}],useRef:value=>({current:value}),useEffect(){},useMemo:fn=>fn()},
   "@/lib/constants":constants,
   "@/lib/store":{useAppStore:selector=>selector({user:{id:"customer"},offlineAccess:false})},
   "@/hooks/use-toast":{useToast:()=>({toast(){}})},
   "@/hooks/use-online-status":{useOnlineStatus:()=>true},
   "@/hooks/use-service-area":{useServiceArea:()=>({area:{serviceAreaMessage:()=>null}})},
   "@/hooks/use-customer-data":{useCustomerData:(_,key,initial)=>key.endsWith("payment-method")?[selected,value=>{selected=value;}]:[initial,()=>{}]},
   "@/lib/customer-booking-ui":{routeTimeLabel:()=>"Trip duration"},
  },{process:{env:{NODE_ENV:"production"}}},"\nexports.BookingForm=BookingForm;");
  const tree=BookingForm({bookingType,initialBooking:null,onCreate(){},onCancel(){}});
  const selector=nodes(tree).find(n=>n.props?.id==="payment-method");
  assert.equal(selector.props.value,method);
  assert.deepEqual(nodes(selector).filter(n=>n.type==="option").map(n=>n.props.value),["CASH","DEMO_GCASH","DEMO_MAYA","DEMO_BANK"]);
  assert.match(text(tree),/No money is charged/);
  assert.equal(nodes(selector).filter(n=>n.type==="option"&&text(n).includes("simulated")).length,3);
  selector.props.onChange({target:{value:"DEMO_BANK"}});
  assert.equal(selected,"DEMO_BANK");
 }
});
test("receipt download enforces owner scope and confirmed payment for cash and simulated methods",async()=>{
 class CustomerError extends Error{constructor(message,status){super(message);this.status=status;}}
 let session={uid:"customer"}, record, query, built=0;
 const {GET}=load("src/app/api/bookings/[id]/receipt/route.ts",{
  "next/server":{NextResponse:Response},
  "@/lib/db":{db:{booking:{findFirst:async input=>{query=input;return record;}}}},
  "@/lib/customer-access":{CustomerError,requireCustomer:async()=>{if(!session)throw new CustomerError("Sign in",401);return session;},customerErrorResponse:error=>Response.json({error:error.message},{status:error.status??503})},
  "@/lib/booking-receipt":{buildBookingReceipt:async()=>{built++;return Buffer.from("%PDF-1.7\nfixture");}},
 },{Buffer});
 const get=()=>GET(new Request("https://fixture.invalid/receipt"),{params:Promise.resolve({id:"booking"})});
 for(const paymentMethod of ["CASH","DEMO_GCASH","DEMO_MAYA","DEMO_BANK"]){
  record={refCode:"FIT-123",paymentMethod,paymentStatus:"PAID",paidAt:new Date()};
  const result=await get();
  assert.equal(result.status,200);assert.equal(result.headers.get("content-type"),"application/pdf");
  assert.match(result.headers.get("content-disposition"),/fetchit-FIT-123.pdf/);
  assert.equal(query.where.customerId,"customer");
  assert.equal(query.where.id,"booking");
 }
 const before=built;
 for(const paymentStatus of ["UNPAID","PENDING","FAILED","REFUNDED"]){
  record={paymentStatus}; assert.equal((await get()).status,409);
 }
 record=null; assert.equal((await get()).status,404);
 session=null; assert.equal((await get()).status,401);
 assert.equal(built,before);
});
