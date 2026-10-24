import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { requiredDocuments, normalizeFields, validateApplication, approvalExpiry, SECTION_FIELDS } from "../src/lib/rider-application-policy.ts";
const require = createRequire(import.meta.url);
const fields = { legalName: "Sample Applicant", birthDate: "1995-01-01", address: "Lingayen, Pangasinan", mobile: "09171234567", emergencyName: "Sample Contact", emergencyRelationship: "Sibling", emergencyPhone: "+639181234567", licenceNumber: "SAMPLE-123", licenceCodes: "A, A1, B", licenceExpiry: "2030-10-31", nbiExpiry: "2030-01-31", vehicleMake: "Sample", vehicleModel: "Model", vehicleYear: "2024", plateNumber: "SAMPLE01", registrationExpiry: "2030-06-30", capacity: "2", displacement: "125", ownership: "OWNER", operatingArea: "Lingayen approved zone", permitNumber: "SAMPLE-PERMIT" };
export function load(file, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../'+file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, Buffer, Uint8Array, Response, Date, console, process, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return exports;
}
test("all six vehicle/service paths share the core checklist with conditional permits and ownership", () => {
  for (const vehicle of ["MOTORCYCLE", "TRICYCLE", "SEDAN"]) for (const service of ["DELIVERY", "RIDE"]) {
    validateApplication(vehicle, [service], fields, new Date("2026-10-24"));
    const docs = requiredDocuments(vehicle, [service], fields);
    assert(docs.includes("NBI") && docs.includes("OR") && docs.includes("CR"));
    assert.equal(docs.includes("PASSENGER_PERMIT"), vehicle !== "MOTORCYCLE" && service === "RIDE");
  }
  assert(requiredDocuments("TRICYCLE", ["RIDE"], { ...fields, ownership: "BORROWED" }).includes("OWNER_AUTH"));
  assert(requiredDocuments("SEDAN", ["DELIVERY"], { ...fields, ownership: "PURCHASED" }).includes("DEED_OF_SALE"));
});
test("server rejects wrong licence class, expired documents, underage and impossible dates", () => {
  for (const patch of [{ licenceCodes: "A" }, { nbiExpiry: "2020-01-01" }, { birthDate: "2020-01-01" }, { licenceExpiry: "2030-02-30" }, { birthDate: "2000-02-30" }, { mobile: "123" }]) assert.throws(() => validateApplication("TRICYCLE", ["RIDE"], { ...fields, ...patch }));
  assert.throws(() => validateApplication("SEDAN", [], fields));
  assert.throws(() => validateApplication("SEDAN", ["RIDE", "RIDE"], fields));
  assert.equal(approvalExpiry(fields).toISOString(), "2030-01-31T15:59:59.000Z");
  assert(!Object.hasOwn(normalizeFields({ ...fields, approved: true }), "approved"));
});
test("private document uploads validate real bytes and preserve readability", async () => {
  const writes = [];
  const { storeApplicationDocument } = load('src/lib/application-upload.ts', {
    '@vercel/blob': { put: async (path, bytes, options) => { writes.push({ path, bytes, options }); }, del: async () => {} },
    './rider-application-policy': { ApplicationError: class extends Error {} },
  });
  const image = await sharp({ create: { width: 2200, height: 1500, channels: 3, background: '#ff9933' } }).png().toBuffer();
  const saved = await storeApplicationDocument('application-one', 'OR', image);
  assert(saved.pathname.startsWith('rider-applications/application-one/'));
  assert.equal(writes[0].options.access, 'private');
  assert.equal((await sharp(writes[0].bytes).metadata()).width, 2200);
  await assert.rejects(storeApplicationDocument('application-one', 'NBI', Buffer.from('<script>bad</script>')));
  await assert.rejects(storeApplicationDocument('application-one', 'NBI', Buffer.alloc(4 * 1024 * 1024)));
  const pdf = await PDFDocument.create(); pdf.addPage();
  await storeApplicationDocument('application-one', 'NBI', Buffer.from(await pdf.save()));
  await assert.rejects(storeApplicationDocument('application-one', 'PROFILE', Buffer.from(await pdf.save())));
  assert.equal(writes.length, 2);
});
test("private document reads reject paths belonging to other applications", async () => {
  let reads = 0;
  const { readApplicationDocument } = load('src/lib/application-storage.ts', { '@vercel/blob': { get: async () => { reads++; return null; } }, './rider-application-policy': { ApplicationError: class extends Error {} } });
  await assert.rejects(readApplicationDocument('mine', { pathname: 'rider-applications/other/00000000-0000-0000-0000-000000000000.jpg', mimeType: 'image/jpeg' }));
  assert.equal(reads, 0);
});
test("orientation letters contain actual PDF pages and the email uses the applicant and vehicle", async () => {
  const { applicationMessage, orientationLetter } = load('src/lib/application-mail.ts', { './db': { db: {} }, './rider-application-policy': { ApplicationError: class extends Error {} } });
  const p = { name: 'Sample Applicant', applicationId: 'SAMPLE-APPLICATION', vehicle: 'TRICYCLE', services: 'DELIVERY / RIDE', date: '2026-12-01T01:00:00Z', venue: 'Lingayen training facility', instructions: 'Bring original documents and the declared vehicle.' };
  const message = applicationMessage('ORIENTATION', p);
  assert(message.text.includes(p.name) && message.text.includes('TRICYCLE') && message.text.includes('Philippine time'));
  const pdf = await PDFDocument.load(await orientationLetter(p)); assert.equal(pdf.getPageCount(), 1);
  assert((await applicationMessage('CORRECTIONS', { ...p, corrections: ['OR: Upload a clear receipt'] })).text.includes('only the following'));
});
test("approval readiness requires every section and document, not just an accepted application label", () => {
  const policy = load('src/lib/rider-application-policy.ts');
  const { applicationReady } = load('src/lib/rider-application.ts', { './db': { db: {} }, './rider-application-policy': policy, './rider-eligibility': {} });
  const app = { vehicleClass: 'TRICYCLE', services: ['RIDE'], fields, fieldReviews: Object.fromEntries(Object.keys(SECTION_FIELDS).map(s => [s, { status: 'ACCEPTED' }])), emailVerifiedAt: new Date(), verifiedEmail: 'sample@example.invalid', user: { email: 'sample@example.invalid' }, documents: requiredDocuments('TRICYCLE', ['RIDE'], fields).map(kind => ({ kind, current: true, status: 'ACCEPTED' })) };
  applicationReady(app);
  assert.throws(() => applicationReady({ ...app, documents: app.documents.filter(d => d.kind !== 'NBI') }));
  assert.throws(() => applicationReady({ ...app, fieldReviews: { ...app.fieldReviews, licence: { status: 'NEEDS_CORRECTION' } } }));
  assert.throws(() => applicationReady({ ...app, verifiedEmail: 'another@example.invalid' }));
});
test("tricycle passenger jobs require both endpoints inside the approved zone", () => {
  const { validOperatingZone, approvalCoversRoute } = load('src/lib/rider-eligibility.ts');
  const zone = [[120,15],[121,15],[121,17],[120,17],[120,15]];
  assert(validOperatingZone(zone)); assert(!validOperatingZone([[120,15],[121,15],[120,15]]));
  const approval = { source: 'APPLICATION', operatingZone: zone };
  const booking = { vehicleClass: 'TRICYCLE', type: 'RIDE', pickupLng: 120.5, pickupLat: 16, dropoffLng: 120.7, dropoffLat: 16.1 };
  assert(approvalCoversRoute(approval, booking));
  assert(!approvalCoversRoute(approval, { ...booking, dropoffLng: 121.2 }));
  assert(!approvalCoversRoute({ source: 'APPLICATION' }, booking));
  assert(approvalCoversRoute({ source: 'LEGACY_EXISTING' }, booking));
  assert(approvalCoversRoute(approval, { ...booking, type: 'DELIVERY', dropoffLng: 121.2 }));
});
