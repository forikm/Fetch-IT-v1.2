// Starts real Rider + Staff apps against one isolated development schema.
// Never rewrites .env files, production rows, Firebase users or Vercel settings.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..'), base = path.join(root, 'local-rider-lab'), stateFile = path.join(base, 'state.json');
const password = 'LocalDemo-Only-2026!';
const apps = [{ app: 'fetch-rider', port: 3011 }, { app: 'fetch-admin', port: 3022 }];
function valid(schema) { if (!/^fetch_rider_lab_[a-f0-9]{32}$/.test(schema)) throw Error('Invalid lab schema; no action taken.'); return schema; }
async function available(port) { await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => reject(Error(`Port ${port} is in use. Existing servers were left alone.`))); server.listen(port, '127.0.0.1', () => server.close(resolve)); }); }
function stop(state) {
  for (const server of state.servers || []) {
    if (!Number.isInteger(server.pid) || !apps.some(a => a.app === server.app && a.port === server.port)) throw Error('Unexpected preview process.');
    const expected = path.resolve(root, '..', server.app).replaceAll("'", "''");
    const command = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${server.pid}'; if($p -and $p.CommandLine -like '*next*dev*${server.port}*' -and $p.CommandLine.Contains('${expected}')) { $todo=@(${server.pid}); $owned=@(); while($todo.Count) { $id=$todo[0]; $todo=@($todo | Select-Object -Skip 1); $owned+= $id; $todo+= @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $id" | Select-Object -ExpandProperty ProcessId) }; [array]::Reverse($owned); foreach($id in $owned){ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'pipe' });
  }
}
async function main() {
  const mode = process.argv[2] || 'start';
  if (mode === 'status') { console.log(fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : 'Lab has not been started.'); return; }
  if (mode === 'stop') { if (fs.existsSync(stateFile)) { const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); valid(state.schema); stop(state); state.servers = []; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } console.log('Local servers stopped. Lab data and documents are preserved.'); return; }
  if (mode !== 'start') throw Error('Use start, status or stop.');
  for (const app of apps) await available(app.port);
  const portraits = path.join(root, 'output/demo-activity-20261024/photos/demo-only');
  for (const name of ['mateo', 'liza', 'renato', 'ana', 'joel']) if (!fs.existsSync(path.join(portraits, name + '.png'))) throw Error('The existing DEMO-only portrait assets are required.');
  process.loadEnvFile(path.join(root, '.env'));
  const prior = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  const schema = valid(prior?.schema || 'fetch_rider_lab_' + crypto.randomUUID().replaceAll('-', ''));
  const directory = path.join(base, schema);
  const target = new URL(process.env.DATABASE_URL); target.searchParams.set('schema', schema); target.searchParams.set('options', `-c search_path=${schema},pg_catalog`);
  const databaseUrl = target.toString(), db = new PrismaClient({ datasourceUrl: databaseUrl });
  const migrated = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, windowsHide: true, encoding: 'utf8', timeout: 90000 });
  if (migrated.status !== 0) throw Error('Lab schema migration failed. No production migration was requested.');
  try {
    const [scope] = await db.$queryRawUnsafe('SELECT current_schema() AS schema'); if (scope.schema !== schema) throw Error('Database isolation failed.');
    for (const fn of await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${schema}`) {
      if (!/^fetch_[a-z_]+$/.test(fn.name)) throw Error('Unexpected lab trigger.');
      await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);
    }
    for (const actor of ['reviewer', 'approver', 'activator', 'safety']) {
      const email = `${actor}@fetch-demo.example.invalid`;
      if (await db.user.findUnique({ where: { email } })) continue;
      const salt = crypto.randomBytes(16).toString('hex'), passwordHash = salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
      await db.user.create({ data: { email, name: `Demo ${actor}`, role: actor === 'safety' ? 'SAFETY' : 'ADMIN', authIdentities: { create: { provider: 'PASSWORD', providerUserId: email, passwordHash } } } });
    }
  } finally { await db.$disconnect(); }
  fs.mkdirSync(path.join(directory, 'portraits'), { recursive: true });
  for (const name of ['mateo', 'liza', 'renato', 'ana', 'joel']) fs.copyFileSync(path.join(portraits, name + '.png'), path.join(directory, 'portraits', name + '.png'));
  const state = { schema, directory, riderUrl: 'http://localhost:3011', adminUrl: 'http://localhost:3022/login', servers: [], startedAt: new Date().toISOString() };
  for (const app of apps) {
    const cwd = path.resolve(root, '..', app.app), logfile = path.join(directory, `${app.app}.log`), log = fs.openSync(logfile, 'a');
    const child = spawn(process.execPath, [path.join(cwd, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '-p', String(app.port)], { cwd, env: { ...process.env, NODE_ENV: 'development', VERCEL: '', DATABASE_URL: databaseUrl, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString('hex'), LOCAL_RIDER_LAB: '1', LOCAL_DEMO_SCHEMA: schema, LOCAL_DEMO_DIRECTORY: directory, LOCAL_DEMO_PASSWORD: password, LOCAL_DEMO_RIDER_URL: state.riderUrl, LOCAL_DEMO_ADMIN_URL: 'http://localhost:3022/dashboard/applications', GMAIL_SENDER: '', GMAIL_APP_PASSWORD: '', BLOB_READ_WRITE_TOKEN: '', NEXT_PUBLIC_ENABLE_DEMO_SEED: 'false' }, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    child.unref(); fs.closeSync(log); state.servers.push({ app: app.app, port: app.port, pid: child.pid });
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ rider: state.riderUrl, admin: state.adminUrl, isolatedSchema: schema, emails: 'captured locally', documents: 'local private files', productionWrites: false }, null, 2));
}
main().catch(error => { console.error('Local lab:', error.code || error.message); process.exitCode = 1; });

