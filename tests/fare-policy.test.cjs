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
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.compileFunction(code, ['exports', 'require', 'process'], {filename:file})(exports, req, {env:{}});
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
test('all six services use their configured rates at 2, 3 and 5 km', () => {
  for (const [type, vehicle, totals] of [
    ['RIDE','MOTORCYCLE',[45,55,75]], ['RIDE','TRICYCLE',[30,30,37.5]], ['RIDE','SEDAN',[90,105,135]],
    ['DELIVERY','MOTORCYCLE',[55,65,85]], ['DELIVERY','TRICYCLE',[75,90,120]], ['DELIVERY','SEDAN',[110,130,170]],
  ]) [2,3,5].forEach((km,i) => assert.equal(quote(type,vehicle,km).totalFare,totals[i],`${type} ${vehicle} ${km} km`));
});
test('tricycle passenger fare multiplies but booking fee applies once; car is per booking', () => {
  assert.equal(quote('RIDE','TRICYCLE',3.5,2).totalFare,55);
  assert.equal(quote('RIDE','TRICYCLE',5,2).totalFare,70);
  assert.equal(quote('RIDE','TRICYCLE',5,2).bookingFee,5);
  assert.equal(quote('RIDE','SEDAN',5,4).totalFare,135);
});
test('fractional distance and weight charges are rounded to the centavo', () => {
  assert.equal(quote('RIDE','MOTORCYCLE',2.13).totalFare,46.3);
  assert.equal(quote('RIDE','MOTORCYCLE',2.3).totalFare,48);
  assert.equal(quote('RIDE','TRICYCLE',3.61).totalFare,30.55);
  assert.equal(quote('DELIVERY','SEDAN',2.13).totalFare,112.6);

  const vehicle = {...load('src/lib/constants.ts').VEHICLES.MOTORCYCLE,
    freeWeightKg:0,perKgOverFree:1.075};
  const cargoFare = api.computeFare({vehicle,distanceKm:2,cargoWeightKg:1,surgeMultiplier:1});
  assert.equal(cargoFare.weightFare,1.08);
  assert.equal(cargoFare.totalFare,51.08);
});
test('centavo components reconcile and snapshots reject corrupt amounts', () => {
  for (const type of ['RIDE','DELIVERY']) for (const vehicle of ['MOTORCYCLE','TRICYCLE','SEDAN']) {
    for (let hundredths=1;hundredths<=7000;hundredths+=37) {
      const fare=quote(type,vehicle,hundredths/100,vehicle==='TRICYCLE'?2:1);
      assert.equal(fare.roundingAdjustment,undefined);
      assert.equal(fare.pricingVersion,policy.FARE_POLICY_VERSION);
      assert.ok(policy.readFareSnapshot(fare,fare.totalFare));
      assert.equal(policy.readFareSnapshot({...fare,bookingFee:fare.bookingFee+1},fare.totalFare),null);
    }
  }
  assert.equal(policy.readFareSnapshot(null,50),null);
  const fare = quote('RIDE','TRICYCLE',3.61);
  assert.equal(policy.readFareSnapshot({...fare,distanceFare:0.551},fare.totalFare),null);
  assert.equal(policy.readFareSnapshot({...fare,roundingAdjustment:0},fare.totalFare),null);
  assert.equal(policy.readFareSnapshot(fare,30.54),null);
});
test('historical bookings preserve their original transport fare and booking fee', () => {
  const fare = {...quote('RIDE','MOTORCYCLE',2.3),pricingVersion:'2026-11-12',
    roundingAdjustment:2,transportFare:45,totalFare:50};
  assert.equal(policy.readFareSnapshot(fare,'50.00').transportFare,45);
  assert.equal(policy.readFareSnapshot(fare,48),null);
  assert.equal(policy.riderEarningsForBooking({totalFare:50,paymentMethod:'CASH',fareBreakdown:fare}),45);
});
test('fixed rates do not inherit peak-hour surge and saved breakdown remains historical', () => {
  assert.equal(quote('RIDE','MOTORCYCLE',3).surgeFare,0);
  const saved=quote('DELIVERY','MOTORCYCLE',3);
  settings.fares.MOTORCYCLE.baseFare=500;
  assert.equal(policy.readFareSnapshot(saved,saved.totalFare).totalFare,65);
  settings.fares.MOTORCYCLE.baseFare=50;
});
test('receipts show centavos and omit the rounding line for new and historical bookings', async () => {
  const pdfLib = require('pdf-lib');
  let text = [];
  const receipt = loader({'pdf-lib': {...pdfLib, PDFDocument: {async create() {
    const pdf = await pdfLib.PDFDocument.create();
    const addPage = pdf.addPage.bind(pdf);
    pdf.addPage = size => {
      const page = addPage(size);
      const drawText = page.drawText.bind(page);
      page.drawText = (value, options) => {
        text.push(value);
        drawText(value, options);
      };
      return page;
    };
    return pdf;
  }}}})('src/lib/booking-receipt.ts');
  const date = new Date('2026-11-24T08:00:00Z');
  const booking = {refCode:'RIDE-TEST',type:'RIDE',status:'DELIVERED',createdAt:date,
    deliveredAt:date,paidAt:date,pickupLabel:'Pickup',dropoffLabel:'Drop-off',
    vehicleClass:'MOTORCYCLE',distanceKm:2.13,passengers:1,cargoWeightKg:0,baseFare:40,
    currency:'PHP',surgeMultiplier:1,paymentMethod:'CASH',paymentStatus:'PAID',
    customer:{name:'Customer'},rider:{name:'Driver'}};
  const newFare = quote('RIDE','MOTORCYCLE',2.13);
  const oldFare = {...quote('RIDE','MOTORCYCLE',2.3),pricingVersion:'2026-11-12',
    roundingAdjustment:2,transportFare:45,totalFare:50};
  for (const [fare,label,amount] of [[newFare,'Distance charge','PHP 46.30'],[oldFare,'Transport fare','PHP 50']]) {
    text = [];
    const bytes = await receipt.buildBookingReceipt({...booking,totalFare:fare.totalFare,fareBreakdown:fare},date);
    assert.equal((await pdfLib.PDFDocument.load(bytes)).getPageCount(),1);
    assert.ok(text.includes(label));
    assert.ok(text.includes(amount));
    assert.ok(text.includes('Booking fee'));
    assert.ok(!text.includes('Fare rounding'));
  }
});
test('online completion keeps the transport fare and charges only the snapshotted flat fee', async () => {
  let updated;
  const engine=loader({'./payments':{PaymentError:Error},'./receipt-email':{scheduleReceiptDelivery(){}}})('src/lib/demo-payments.ts');
  const fare=quote('RIDE','TRICYCLE',3.61,2);
  const booking={id:'b',riderId:'r',paymentMethod:'DEMO_GCASH',status:'DELIVERED',paymentStatus:'PAID',demoRiderEarnings:null,demoCommissionBps:0,totalFare:'56.10',fareBreakdown:fare};
  const tx={booking:{update:async args=>{updated=args.data;}},paymentEvent:{create:async()=>{}}};
  await engine.settleDemoEarnings(tx,booking);
  assert.equal(updated.demoCommission,5);assert.equal(updated.demoRiderEarnings,51.1);
  updated=null;
  await engine.settleDemoEarnings(tx,{...booking,fareBreakdown:null,demoCommissionBps:1500,totalFare:'100'});
  assert.equal(updated.demoCommission,15);assert.equal(updated.demoRiderEarnings,85);
});
