// Explicitly gated demo data. No SMTP, push notifications, real payments or live jobs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const { BATCH, APPLICANTS, selectCustomers, buildPlan } = require('./demo-activity-plan.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/demo-activity-20261024');
const manifestPath = path.join(root, 'local-demo-activity-20261024.json');
const cache = new Map();
function load(file) {
  const filename = path.resolve(root, file); if (cache.has(filename)) return cache.get(filename);
  const exports = {}; cache.set(filename, exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, Buffer, Uint8Array, Array, Date, Response, console, process, require(name) {
    if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
    return require(name);
  } }); return exports;
}
async function demoPdf(name, kind, label) {
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 748, width: 596, height: 94, color: rgb(.72, .28, .1) });
  page.drawText('DEMO DOCUMENT', { x: 42, y: 790, font: bold, size: 24, color: rgb(1, 1, 1) });
  page.drawText('NOT VALID - SOFTWARE DEMONSTRATION ONLY', { x: 42, y: 766, font: bold, size: 11, color: rgb(1, 1, 1) });
  page.drawText('DEMO', { x: 90, y: 280, size: 100, font: bold, color: rgb(.94, .89, .84), rotate: degrees(32) });
  const lines = [`Applicant: ${name}`, `Document slot: ${label}`, `Reference: DEMO-${kind}`, '',
    'This is a test placeholder, not a government document.', 'No licence, clearance, registration or insurance is represented.',
    'No agency issued this file. It cannot establish identity or eligibility.', '', 'The personal details and review state belong to a synthetic fixture.',
    'Do not activate this applicant or contact the displayed sample details.', '', `Batch: ${BATCH}`];
  lines.forEach((line, i) => page.drawText(line.replace(/[^\x20-\x7e]/g, '-'), { x: 42, y: 700 - i * 27, font, size: 10.5, color: rgb(.1, .23, .19) }));
  return Buffer.from(await pdf.save());
}
async function encryptedSnapshot(db) {
  const data = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [ctx] = await tx.$queryRawUnsafe('SELECT current_schema() AS schema');
    if (ctx.schema !== 'public') throw Error('Unexpected application schema.');
    const tables = await tx.$queryRawUnsafe('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename');
    const rows = {};
    for (const { tablename } of tables) rows[tablename] = (await tx.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM public."' + tablename.replaceAll('"', '""') + '" t')).map(r => r.row);
    return { version: 2, batch: BATCH, createdAt: new Date().toISOString(), rows };
  }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
  const key = Buffer.from(JSON.parse(fs.readFileSync(path.join(root, 'local-backup-key.json'), 'utf8')).key, 'base64');
  if (key.length !== 32) throw Error('Invalid local backup key.');
  const plain = Buffer.from(JSON.stringify(data)), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const file = path.join(root, 'local-before-demo-activity-' + Date.now() + '.enc');
  fs.writeFileSync(file, JSON.stringify({ version: 2, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }), { flag: 'wx', mode: 0o600 });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')), decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(saved.iv, 'base64')); decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
  if (!Buffer.concat([decipher.update(Buffer.from(saved.data, 'base64')), decipher.final()]).equals(plain)) throw Error('Backup validation failed.');
  return file;
}
async function main() {
  process.loadEnvFile(path.join(root, '.env'));
  const apply = process.argv.includes('--apply');
  if (apply && process.env.ALLOW_DEMO_ACTIVITY_SEED !== '1') throw Error('Set ALLOW_DEMO_ACTIVITY_SEED=1 to apply this explicitly synthetic batch.');
  const db = new PrismaClient(), uploaded = [];
  try {
    const source = JSON.parse(fs.readFileSync(path.join(root, 'local-defense-users.json'), 'utf8'));
    const selected = selectCustomers(source), actual = await db.user.findMany({ where: { id: { in: selected.map(u => u.id) } }, select: { id: true, name: true, email: true, role: true, createdAt: true } });
    const byId = new Map(actual.map(u => [u.id, u]));
    if (actual.length !== 50 || selected.some(u => { const v = byId.get(u.id); return !v || v.role !== 'CUSTOMER' || v.name !== u.name || v.email !== u.email; })) throw Error('The selected customers do not match the synthetic manifest.');
    fs.mkdirSync(output, { recursive: true });
    const local = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { synthetic: true, batch: BATCH, referenceTime: new Date().toISOString() };
    if (local.batch !== BATCH || !local.synthetic) throw Error('Invalid batch manifest.');
    const { quoteFare, quoteRideFare } = load('src/lib/fare.ts');
    const { validatePlatformSettings, defaultPlatformSettings } = load('src/lib/platform-policy.ts');
    const config = await db.platformConfig.findUnique({ where: { id: 'platform' } });
    const plan = buildPlan(selected.map(u => byId.get(u.id)), { now: new Date(local.referenceTime), quoteFare, quoteRideFare, settings: config ? validatePlatformSettings(config.settings) : defaultPlatformSettings() });
    const existing = await db.booking.count({ where: { id: { startsWith: BATCH + '_booking_' } } });
    if (existing) {
      if (existing !== plan.bookings.length || await db.riderApplication.count({ where: { id: { startsWith: BATCH + '_application_' } } }) !== 5) throw Error('An incomplete batch exists. Inspect it; do not overwrite records.');
      console.log(JSON.stringify({ alreadySeeded: true, batch: BATCH, customers: 50, bookings: existing, applications: 5 })); return;
    }
    const summary = { batch: BATCH, synthetic: true, customers: 50, bookings: plan.bookings.length, delivered: plan.bookings.filter(b => b.status === 'DELIVERED').length, cancelled: plan.bookings.filter(b => b.status === 'CANCELLED').length, rides: plan.bookings.filter(b => b.type === 'RIDE').length, deliveries: plan.bookings.filter(b => b.type === 'DELIVERY').length, applications: 5, historicalDemoRiders: 3, photos: 5, noLiveJobs: true, noRealPayments: true, noOutboundMessages: true };
    const { requiredDocuments, DOCUMENT_LABELS } = load('src/lib/rider-application-policy.ts');
    for (const a of APPLICANTS) { const file = path.join(output, 'photos/demo-only', a.key + '.png'); if (!fs.existsSync(file) || fs.statSync(file).size > 3 * 1024 * 1024) throw Error('Missing or oversized DEMO-only profile photo.'); }
    if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, JSON.stringify({ ...local, customerIds: selected.map(u => u.id) }, null, 2), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify({ ...summary, bookingsByDay: plan.bookings.reduce((counts, b) => { const k = new Date(b.createdAt.getTime() + 8 * 3600000).toISOString().slice(0, 10); counts[k] = (counts[k] || 0) + 1; return counts; }, {}), applicationStages: plan.applications.map(a => ({ name: a.fields.legalName, vehicle: a.vehicleClass, services: a.services, status: a.status })) }, null, 2));
    if (process.argv.includes('--prepare-documents')) {
      fs.mkdirSync(path.join(output, 'documents'), { recursive: true });
      for (const [i, app] of plan.applications.entries()) for (const kind of requiredDocuments(app.vehicleClass, app.services, app.fields).filter(k => k !== 'PROFILE')) fs.writeFileSync(path.join(output, 'documents', `${APPLICANTS[i].key}-${kind}.pdf`), await demoPdf(APPLICANTS[i].name, kind, DOCUMENT_LABELS[kind]));
    }
    if (!apply) { console.log(JSON.stringify({ dryRun: true, ...summary })); return; }
    if (!process.env.BLOB_READ_WRITE_TOKEN) process.loadEnvFile(path.join(root, '.env.blob.local'));
    const backupFile = await encryptedSnapshot(db);
    const { storeApplicationDocument, removeUnusedApplicationDocument } = load('src/lib/application-upload.ts');
    const documents = [];
    try {
      for (const [i, app] of plan.applications.entries()) for (const kind of requiredDocuments(app.vehicleClass, app.services, app.fields)) {
      const sourceFile = kind === 'PROFILE' ? path.join(output, 'photos/demo-only', APPLICANTS[i].key + '.png') : path.join(output, 'documents', `${APPLICANTS[i].key}-${kind}.pdf`);
      if (!fs.existsSync(sourceFile)) throw Error('Prepare and inspect the demo PDFs before applying.');
      const stored = await storeApplicationDocument(app.id, kind, fs.readFileSync(sourceFile)); uploaded.push(stored.pathname);
      const correction = app.status === 'NEEDS_CORRECTION' && kind === 'OR';
      const accepted = ['NEEDS_CORRECTION', 'RECOMMENDED', 'ORIENTATION_SCHEDULED'].includes(app.status) || app.status === 'IN_REVIEW' && ['PROFILE', 'NBI'].includes(kind);
      documents.push({ id: `${app.id}_${kind}`, applicationId: app.id, kind, version: 1, current: true, ...stored, status: correction ? 'NEEDS_CORRECTION' : accepted ? 'ACCEPTED' : 'PENDING', reason: correction ? 'DEMO review example: replace this OR placeholder with a clearer sample. Other accepted examples remain unchanged.' : 'DEMO placeholder; not a valid government or insurance document.', createdAt: app.createdAt });
      }
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${BATCH}))::text`;
        if (await tx.booking.count({ where: { id: { startsWith: BATCH + '_booking_' } } })) throw Error('Batch already exists; refusing duplicate insertion.');
        const noticesBefore = await tx.customerNotification.count(), mailBefore = await tx.riderApplicationEmail.count(), accessBefore = await tx.riderServiceApproval.count();
        await tx.user.createMany({ data: plan.users });
        await tx.riderProfile.createMany({ data: plan.profiles });
        await tx.riderPresence.createMany({ data: plan.users.map(u => ({ userId: u.id, isOnline: false })) });
        await tx.booking.createMany({ data: plan.bookings });
        // Direct inserts intentionally avoid the live notification-enqueuing helper.
        await tx.bookingEvent.createMany({ data: plan.events });
        await tx.customerReview.createMany({ data: plan.reviews });
        await tx.riderApplication.createMany({ data: plan.applications });
        await tx.riderApplicationDocument.createMany({ data: documents });
        await tx.riderApplicationEvent.createMany({ data: plan.applications.map(a => ({ id: a.id + '_seeded', applicationId: a.id, actorId: BATCH, actorName: 'Demo dataset generator', action: 'DEMO_SEEDED', details: { synthetic: true, batch: BATCH, notice: 'No actual document verification, invitation, permission or orientation.' }, createdAt: a.updatedAt })) });
        await tx.adminAudit.create({ data: { actorName: 'Demo dataset generator', action: 'DEMO_ACTIVITY_SEEDED', entityType: 'DEMO_DATASET', entityId: BATCH, details: summary } });
        if (await tx.customerNotification.count() !== noticesBefore || await tx.riderApplicationEmail.count() !== mailBefore || await tx.riderServiceApproval.count() !== accessBefore) throw Error('Demo data must not create notifications, emails or service approvals.');
      }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
    } catch (error) {
      // Preserve possible committed files if database connectivity is uncertain.
      for (const pathname of uploaded) try { if (!await db.riderApplicationDocument.findFirst({ where: { pathname } })) await removeUnusedApplicationDocument(pathname); } catch { /* Reconcile conservatively. */ }
      throw error;
    }
    fs.writeFileSync(manifestPath, JSON.stringify({ ...local, ...summary, backupFile, customerIds: selected.map(u => u.id), userIds: plan.users.map(u => u.id), bookingIds: plan.bookings.map(b => b.id), applicationIds: plan.applications.map(a => a.id), privateDocumentPaths: documents.map(d => d.pathname), appliedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ applied: true, ...summary, reviews: plan.reviews.length, documents: documents.length, backupVerified: true }));
  } finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(e => { console.error('Demo activity seed failed:', e.code || e.message); process.exitCode = 1; });
