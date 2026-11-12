const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function loader(stubs = {}) {
  const cache = {};
  function load(file) {
    file = path.resolve(file);
    if (cache[file]) return cache[file];
    const exports = {}; cache[file] = exports;
    const req = name => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      return require(name);
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports, require:req, process:{env:{}}, Buffer, console, setTimeout, clearTimeout}, {filename:file});
    return exports;
  }
  return load;
}
const load = loader(), api = load('src/lib/fare.ts'), policy = load('src/lib/fare-policy.ts');
const settings = load('src/lib/platform-policy.ts').defaultPlatformSettings();
function quote(type, vehicleClass, distanceKm, passengers = 1) {
  const params = {pickup:{lat:16.02,lng:120.23},dropoff:{lat:16.03,lng:120.24},vehicleClass,
    passengers,cargoWeightKg:1,settings,route:{distanceKm,durationSeconds:600},when:new Date('2026-11-13T10:00:00Z')};
  return (type === 'RIDE' ? api.quoteRideFare(params) : api.quoteFare(params)).fare;
}
test('all six services match the proposed 2, 3 and 5 km totals', () => {
  for (const [type, vehicle, totals] of [
    ['RIDE','MOTORCYCLE',[45,55,75]], ['RIDE','TRICYCLE',[30,30,40]], ['RIDE','SEDAN',[90,105,135]],
    ['DELIVERY','MOTORCYCLE',[55,65,85]], ['DELIVERY','TRICYCLE',[75,90,120]], ['DELIVERY','SEDAN',[110,130,170]],
  ]) [2,3,5].forEach((km,i) => assert.equal(quote(type,vehicle,km).totalFare,totals[i],`${type} ${vehicle} ${km} km`));
});
test('tricycle passenger fare multiplies but booking fee applies once; car is per booking', () => {
  assert.equal(quote('RIDE','TRICYCLE',3.5,2).totalFare,55);
  assert.equal(quote('RIDE','TRICYCLE',5,2).totalFare,70);
  assert.equal(quote('RIDE','TRICYCLE',5,2).bookingFee,5);
  assert.equal(quote('RIDE','SEDAN',5,4).totalFare,135);
});
test('short distance overages do not trigger a full extra kilometre charge', () => {
  assert.equal(quote('RIDE','MOTORCYCLE',2.1).totalFare,45);
  assert.equal(quote('RIDE','MOTORCYCLE',2.3).totalFare,50);
  assert.equal(quote('RIDE','TRICYCLE',3.6).totalFare,30);
});
test('whole-peso components reconcile, snapshots reject corrupt fees and totals', () => {
  for (const type of ['RIDE','DELIVERY']) for (const vehicle of ['MOTORCYCLE','TRICYCLE','SEDAN']) {
    for (let hundredths=1;hundredths<=7000;hundredths+=37) {
      const fare=quote(type,vehicle,hundredths/100,vehicle==='TRICYCLE'?2:1);
      assert.equal(fare.totalFare%5,0);
      assert.ok(policy.readFareSnapshot(fare,fare.totalFare));
      assert.equal(policy.readFareSnapshot({...fare,bookingFee:fare.bookingFee+1},fare.totalFare),null);
    }
  }
  assert.equal(policy.readFareSnapshot(null,50),null);
});
test('fixed rates do not inherit peak-hour surge and saved breakdown remains historical', () => {
  assert.equal(quote('RIDE','MOTORCYCLE',3).surgeFare,0);
  const saved=quote('DELIVERY','MOTORCYCLE',3);
  settings.fares.MOTORCYCLE.baseFare=500;
  assert.equal(policy.readFareSnapshot(saved,saved.totalFare).totalFare,65);
  settings.fares.MOTORCYCLE.baseFare=50;
});
test('online completion keeps the transport fare and charges only the snapshotted flat fee', async () => {
  let updated;
  const engine=loader({'./payments':{PaymentError:Error},'./receipt-email':{scheduleReceiptDelivery(){}}})('src/lib/demo-payments.ts');
  const fare=quote('RIDE','TRICYCLE',3.5,2);
  const booking={id:'b',riderId:'r',paymentMethod:'DEMO_GCASH',status:'DELIVERED',paymentStatus:'PAID',demoRiderEarnings:null,demoCommissionBps:0,totalFare:'55',fareBreakdown:fare};
  const tx={booking:{update:async args=>{updated=args.data;}},paymentEvent:{create:async()=>{}}};
  await engine.settleDemoEarnings(tx,booking);
  assert.equal(updated.demoCommission,5);assert.equal(updated.demoRiderEarnings,50);
  updated=null;
  await engine.settleDemoEarnings(tx,{...booking,fareBreakdown:null,demoCommissionBps:1500,totalFare:'100'});
  assert.equal(updated.demoCommission,15);assert.equal(updated.demoRiderEarnings,85);
});
