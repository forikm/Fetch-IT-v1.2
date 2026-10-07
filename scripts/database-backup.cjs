/* eslint-disable @typescript-eslint/no-require-imports */
// Encrypted application-data backups and a restore drill restricted to a new
// disposable schema. Never clears or restores into the configured app schema.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
const models = ['user', 'authIdentity', 'riderProfile', 'riderPresence', 'ticketCounter', 'booking', 'trackingUpdate', 'deliveryProof', 'customerReview', 'supportTicket', 'supportMessage', 'adminAudit', 'bookingEvent', 'deliveryChallenge', 'bookingLocation'];
const keyPath = path.join(root, 'local-backup-key.json');

function key(create = false) {
  if (!fs.existsSync(keyPath) && create) fs.writeFileSync(keyPath, JSON.stringify({ key: crypto.randomBytes(32).toString('base64') }), { flag: 'wx', mode: 0o600 });
  const value = Buffer.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')).key, 'base64');
  if (value.length !== 32) throw new Error('Invalid backup encryption key');
  return value;
}
function encode(data) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(true), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
}
function decode(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.version !== 1) throw new Error('Unsupported backup format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'));
  if (data.version !== 1 || models.some(m => !Array.isArray(data.tables[m]))) throw new Error('Invalid backup data');
  return data;
}
async function snapshot(db) {
  return db.$transaction(async tx => {
    const tables = {};
    for (const model of models) tables[model] = await tx[model].findMany();
    return { version: 1, createdAt: new Date().toISOString(), tables };
  }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
}
function canonical(value) {
  value = JSON.parse(JSON.stringify(value));
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(value.map(sort).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
async function restoreDrill(data, source) {
  const schema = 'fetch_restore_test_' + crypto.randomUUID().replaceAll('-', '');
  const target = new URL(process.env.DATABASE_URL);
  target.searchParams.set('schema', schema);
  target.searchParams.set('options', `${target.searchParams.get('options') || ''} -c search_path=${schema},pg_catalog`.trim());
  const databaseUrl = target.toString();
  const restored = new PrismaClient({ datasourceUrl: databaseUrl });
  let ownsSchema = false;
  try {
    if ((await source.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname = ${schema}`).length) throw new Error('Restore schema already exists');
    ownsSchema = true;
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: root, windowsHide: true,
      env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 90000 });
    if (result.status !== 0) throw new Error('Disposable restore schema migration failed');
    if (!(await restored.$queryRaw`SHOW search_path`)[0].search_path.includes(schema)) throw new Error('Restore schema isolation failed');
    const functions = await restored.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${schema}`;
    for (const fn of functions) {
      if (!/^fetch_[a-z_]+$/.test(fn.name)) throw new Error('Unexpected database function');
      await restored.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);
    }
    await restored.$transaction(async tx => {
      for (const model of models) for (let i = 0; i < data.tables[model].length; i += 500) await tx[model].createMany({ data: data.tables[model].slice(i, i + 500) });
    }, { timeout: 120000 });
    const verified = await snapshot(restored);
    for (const model of models) if (canonical(data.tables[model]) !== canonical(verified.tables[model])) throw new Error(`Restored ${model} differs from backup`);
    return Object.fromEntries(models.map(m => [m, data.tables[m].length]));
  } finally {
    await restored.$disconnect();
    if (ownsSchema) {
      if (!/^fetch_restore_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe cleanup target');
      await source.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }
}
async function main() {
  process.loadEnvFile(path.join(root, '.env'));
  const mode = process.argv[2] || 'create';
  if (!['create', 'restore-test'].includes(mode)) throw new Error('Use create or restore-test');
  const db = new PrismaClient();
  try {
    let file = process.argv[3] && path.resolve(process.argv[3]);
    if (mode === 'create') {
      file ||= path.join(root, `local-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.enc`);
      fs.writeFileSync(file, encode(await snapshot(db)), { flag: 'wx', mode: 0o600 });
      decode(file); // Verify the encrypted file can be authenticated and read.
      console.log(JSON.stringify({ backupFile: file, keyFile: keyPath, encrypted: true }));
    } else {
      if (!file) throw new Error('Specify an encrypted backup file');
      console.log(JSON.stringify({ restoredAndVerified: await restoreDrill(decode(file), db), temporarySchemaRemoved: true }));
    }
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error('Backup operation failed:', error.code || error.errorCode || 'Check file permissions, encryption key and database access.'); process.exitCode = 1; });
