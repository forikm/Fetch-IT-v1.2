// Deterministic, clearly marked presentation fixtures. No network or database writes.
const BATCH = 'demo_activity_20261024_v1';
const DAY = 86400000;
const VEHICLES = ['MOTORCYCLE', 'TRICYCLE', 'SEDAN'];
const APPLICANTS = [
  { key: 'mateo', name: 'Mateo Dizon', vehicle: 'MOTORCYCLE', services: ['DELIVERY'], status: 'SUBMITTED', make: 'Honda', model: 'Click 125i', birth: '1997-02-17' },
  { key: 'liza', name: 'Liza Soriano', vehicle: 'TRICYCLE', services: ['DELIVERY', 'RIDE'], status: 'IN_REVIEW', make: 'Bajaj', model: 'RE', birth: '1994-08-22' },
  { key: 'renato', name: 'Renato Villanueva', vehicle: 'SEDAN', services: ['RIDE'], status: 'NEEDS_CORRECTION', make: 'Toyota', model: 'Vios', birth: '1982-05-09' },
  { key: 'ana', name: 'Ana Mercado', vehicle: 'MOTORCYCLE', services: ['DELIVERY', 'RIDE'], status: 'RECOMMENDED', make: 'Yamaha', model: 'Mio Gear', birth: '2000-01-14' },
  { key: 'joel', name: 'Joel Bautista', vehicle: 'TRICYCLE', services: ['DELIVERY'], status: 'ORIENTATION_SCHEDULED', make: 'TVS', model: 'King', birth: '1990-11-03' },
];
const STOPS = [
  ['Lingayen town centre', 16.0219, 120.2310], ['Lingayen coastal area', 16.0380, 120.2290],
  ['Binmaley town centre', 16.0307, 120.2690], ['Dagupan central area', 16.0430, 120.3340],
  ['Labrador town centre', 16.0250, 120.1450], ['San Carlos central area', 15.9280, 120.3480],
  ['Lingayen university district', 16.0170, 120.2340], ['Binmaley market district', 16.0290, 120.2730],
];
const NOTES = ['Documents in a sealed envelope', 'Small household parcel', 'Boxed groceries', 'School supplies', 'Packed clothing', 'Fragile kitchen items'];
function selectCustomers(manifest) {
  if (!manifest.synthetic || !Array.isArray(manifest.users) || manifest.users.length < 50) throw Error('A verified synthetic-customer manifest is required.');
  const selected = Array.from({ length: 50 }, (_, i) => manifest.users[Math.floor(i * manifest.users.length / 50)]);
  if (new Set(selected.map(u => u.id)).size !== 50 || selected.some(u => u.role !== 'CUSTOMER')) throw Error('Choose exactly 50 distinct synthetic customers.');
  return selected;
}
function buildPlan(customers, { now, quoteFare, quoteRideFare, settings }) {
  if (customers.length !== 50 || new Set(customers.map(u => u.id)).size !== 50) throw Error('Exactly 50 customers are required.');
  if (!Number.isFinite(now.getTime())) throw Error('Invalid reference time.');
  let randomState = 20261024;
  const random = max => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState % max; };
  const date = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10), midnight = new Date(date + 'T00:00:00+08:00').getTime();
  const users = VEHICLES.map((vehicle, i) => ({ id: `${BATCH}_history_${vehicle}`, name: `Demo · ${['Marco Santos', 'Dante Ramos', 'Clara Reyes'][i]}`, email: `history-${i + 1}@fetch-demo.example.invalid`, role: 'RIDER', createdAt: new Date(midnight - 40 * DAY), updatedAt: now }));
  const bookings = [], events = [], reviews = [];
  for (let i = 0; i < customers.length; i++) for (let j = 0; j < 2 + i % 5; j++) {
    const n = bookings.length + 1, vehicleClass = VEHICLES[(i + j) % 3], type = (i + j) % 2 ? 'RIDE' : 'DELIVERY';
    const pickupIndex = random(STOPS.length), dropoffIndex = (pickupIndex + 1 + random(STOPS.length - 1)) % STOPS.length;
    const pickup = STOPS[pickupIndex], dropoff = STOPS[dropoffIndex];
    const accountCreatedAt = new Date(customers[i].createdAt || midnight - 40 * DAY);
    const oldestDay = Math.min(29, Math.max(1, Math.floor((midnight - accountCreatedAt.getTime()) / DAY)));
    const dayOffset = j === 0 && i < 15 ? 0 : 1 + random(oldestDay);
    const usualTime = midnight - dayOffset * DAY + (7 * 60 + random(14 * 60)) * 60000;
    const createdAt = new Date(Math.max(accountCreatedAt.getTime() + 3600000, Math.min(usualTime, now.getTime() - (240 + random(90)) * 60000)));
    const cancelled = random(10) < 2, status = cancelled ? 'CANCELLED' : 'DELIVERED';
    const cargoWeightKg = type === 'RIDE' ? 0 : 1 + random(vehicleClass === 'SEDAN' ? 70 : vehicleClass === 'TRICYCLE' ? 30 : 12);
    const q = (type === 'RIDE' ? quoteRideFare : quoteFare)({ pickup: { lat: pickup[1], lng: pickup[2] }, dropoff: { lat: dropoff[1], lng: dropoff[2] }, vehicleClass, cargoWeightKg, when: createdAt, settings });
    const riderId = `${BATCH}_history_${vehicleClass}`, id = `${BATCH}_booking_${String(n).padStart(4, '0')}`;
    const matchedAt = new Date(createdAt.getTime() + (2 + random(4)) * 60000), pickedUpAt = cancelled ? null : new Date(matchedAt.getTime() + (5 + random(11)) * 60000);
    const deliveredAt = cancelled ? null : new Date(pickedUpAt.getTime() + Math.max(8, q.etaMinutes) * 60000), cancelledAt = cancelled ? new Date(matchedAt.getTime() + (1 + random(5)) * 60000) : null;
    const end = deliveredAt || cancelledAt;
    if (end > now) throw Error('A historical demo trip cannot finish in the future.');
    bookings.push({ id, refCode: `DEMO-${String(n).padStart(5, '0')}`, ticketId: `DEMO-${type === 'RIDE' ? 'R' : 'D'}${String(n).padStart(5, '0')}`, type, customerId: customers[i].id, riderId,
      pickupLabel: `Demo stop · ${pickup[0]} (approximate)`, pickupLat: pickup[1], pickupLng: pickup[2], dropoffLabel: `Demo stop · ${dropoff[0]} (approximate)`, dropoffLat: dropoff[1], dropoffLng: dropoff[2],
      vehicleClass, cargoWeightKg, passengers: type === 'RIDE' ? 1 + random(vehicleClass === 'MOTORCYCLE' ? 1 : vehicleClass === 'TRICYCLE' ? 2 : 4) : 1,
      cargoNotes: `[DEMO DATA · ${BATCH}] ${type === 'RIDE' ? 'Synthetic passenger trip' : NOTES[random(NOTES.length)]}. No real journey, collection or payout.`,
      distanceKm: q.distanceKm, baseFare: q.fare.baseFare, totalFare: q.fare.totalFare, surgeMultiplier: q.surgeMultiplier, etaMinutes: q.etaMinutes,
      status, matchedAt, pickedUpAt, deliveredAt, cancelledAt, cancellationReason: cancelled ? '[DEMO] ' + ['Customer changed plans', 'Duplicate booking', 'Pickup time changed'][random(3)] : null,
      paymentMethod: 'CASH', paymentStatus: 'UNPAID', createdAt, updatedAt: end });
    const timeline = [['CREATED', null, 'PENDING', createdAt], ['ASSIGNED', 'PENDING', 'MATCHED', matchedAt], ...(cancelled ? [['CANCELLED', 'MATCHED', 'CANCELLED', cancelledAt]] : [['STATUS_CHANGED', 'MATCHED', 'ACCEPTED', new Date(matchedAt.getTime() + 60000)], ['STATUS_CHANGED', 'ACCEPTED', 'PICKED_UP', pickedUpAt], ['STATUS_CHANGED', 'PICKED_UP', 'IN_TRANSIT', new Date(pickedUpAt.getTime() + 60000)], ['STATUS_CHANGED', 'IN_TRANSIT', 'DELIVERED', deliveredAt]])];
    timeline.forEach(([action, fromStatus, toStatus, at], index) => events.push({ id: `${id}_event_${index}`, bookingId: id, actorName: 'Demo dataset generator', actorRole: 'ADMIN', action, fromStatus, toStatus, riderId, reason: `[DEMO] Simulated booking history, batch ${BATCH}`, createdAt: at }));
    if (!cancelled && n % 3 !== 0) reviews.push({ id: `${id}_review`, bookingId: id, customerId: customers[i].id, riderId, rating: [5, 5, 5, 4, 4, 3][random(6)], comment: '[DEMO] ' + (type === 'RIDE' ? ['Smooth trip and polite driver.', 'Safe ride and convenient pickup.', 'Clear communication throughout the trip.', 'Comfortable trip and easy drop-off.'] : ['Parcel arrived in good condition.', 'Careful handling of the package.', 'Clear communication and convenient pickup.', 'My documents reached the destination safely.'])[random(4)], createdAt: new Date(deliveredAt.getTime() + 60000) });
  }
  const applications = APPLICANTS.map((a, i) => {
    const userId = `${BATCH}_applicant_${a.key}`, id = `${BATCH}_application_${a.key}`, at = new Date(now.getTime() - (i * 15 + 15) * 60000);
    return { id, userId, isDemo: true, status: a.status, vehicleClass: a.vehicle, services: a.services, submittedAt: at, createdAt: new Date(at.getTime() - 3600000), updatedAt: at,
      // These are interface fixtures, not verified identities or permissions.
      fields: { legalName: `Demo · ${a.name}`, birthDate: a.birth, address: 'Demo address · Lingayen, Pangasinan', mobile: 'DEMO — no callable number', emergencyName: 'Demo emergency contact', emergencyRelationship: 'Sibling (demo)', emergencyPhone: 'DEMO — no callable number', licenceNumber: `DEMO-LIC-${i + 1}`, licenceCodes: a.vehicle === 'TRICYCLE' ? 'A1' : a.vehicle === 'SEDAN' ? 'B' : 'A', licenceExpiry: '2029-12-31', nbiExpiry: '2027-10-31', vehicleMake: a.make, vehicleModel: a.model, vehicleYear: String(2021 + i % 4), plateNumber: `DEMO0${i + 1}`, registrationExpiry: '2027-06-30', capacity: a.services.includes('RIDE') ? a.vehicle === 'MOTORCYCLE' ? '1' : a.vehicle === 'TRICYCLE' ? '2' : '4' : '12', displacement: a.vehicle === 'SEDAN' ? '' : '125', ownership: 'OWNER', operatingArea: 'Demo Lingayen zone — not a valid permit', permitNumber: `DEMO-PERMIT-${i + 1}`, demoNotice: 'Synthetic application. Demo photo and invalid test documents. Do not activate or contact.' },
      fieldReviews: Object.fromEntries(['personal', 'emergency', 'licence', 'vehicle', 'ownership', 'service'].map(section => [section, { status: ['RECOMMENDED', 'ORIENTATION_SCHEDULED'].includes(a.status) ? 'ACCEPTED' : 'PENDING', reason: 'DEMO review state only; no actual identity or document verification.' }])),
      ...(a.status === 'ORIENTATION_SCHEDULED' ? { orientationAt: new Date(midnight + 2 * DAY + 9 * 3600000), orientationVenue: 'Demo training venue — no real appointment', orientationInstructions: 'SYNTHETIC ORIENTATION FOR UI DEMONSTRATION. Do not attend. No invitation has been sent.' } : {}) };
  });
  const profiles = users.map((u, i) => { const ratings = reviews.filter(r => r.riderId === u.id); return { userId: u.id, vehicleClass: VEHICLES[i], vehiclePlate: `DEMO-H${i + 1}`, totalDeliveries: bookings.filter(b => b.riderId === u.id && b.status === 'DELIVERED').length, rating: ratings.length ? ratings.reduce((n, r) => n + r.rating, 0) / ratings.length : 5 }; });
  APPLICANTS.forEach((a, i) => { const app = applications[i]; users.push({ id: app.userId, name: `Demo · ${a.name}`, email: `${a.key}@fetch-demo.example.invalid`, role: 'RIDER', createdAt: app.createdAt, updatedAt: app.updatedAt }); profiles.push({ userId: app.userId, vehicleClass: a.vehicle, vehiclePlate: `DEMO0${i + 1}`, rating: 5, totalDeliveries: 0 }); });
  return { batch: BATCH, referenceTime: now, users, profiles, bookings, events, reviews, applications };
}
module.exports = { BATCH, APPLICANTS, selectCustomers, buildPlan };
