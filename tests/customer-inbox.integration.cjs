/* eslint-disable @typescript-eslint/no-require-imports */
// All writes are confined to a newly generated, disposable PostgreSQL schema.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const ts = require('typescript');
if (process.env.RUN_INBOX_INTEGRATION !== '1') throw Error('Set RUN_INBOX_INTEGRATION=1 for the isolated database check.');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(process.env.INBOX_TEST_ENV_FILE || path.join(root, '.env'));
const schema = 'fetch_inbox_test_' + crypto.randomUUID().replaceAll('-', '');
const target = new URL(process.env.INBOX_TEST_DATABASE_URL || process.env.DATABASE_URL);
assert.notEqual(schema, target.searchParams.get('schema') || 'public');
target.searchParams.set('schema', schema);
target.searchParams.set('options', `-c search_path=${schema},pg_catalog`);
const databaseUrl = target.toString();
const db = new PrismaClient({ datasourceUrl: databaseUrl });
function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Date, Response, URL, console, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error('Unexpected dependency ' + name);
  } });
  return exports;
}
async function main() {
  let owns = false;
  try {
    assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname = ${schema}`).length, 0);
    owns = true;
    const push = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
      cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, windowsHide: true, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(push.status, 0, 'Isolated schema setup must succeed.');
    // Check the additive migration against this empty isolated notification table.
    await db.$executeRawUnsafe('ALTER TABLE "CustomerNotification" DROP COLUMN "dismissedAt"');
    await db.$executeRawUnsafe(fs.readFileSync(path.join(root, 'prisma/migrations/202611020001_notification_dismissal/migration.sql'), 'utf8'));
    const customers = await Promise.all(['one', 'two'].map(name => db.user.create({ data: { name, email: name + '@inbox-test.invalid', role: 'CUSTOMER' } })));
    const [customer, other] = customers;
    const tickets = await Promise.all(customers.map(c => db.supportTicket.create({ data: { customerId: c.id, category: 'OTHER', message: 'Test request' } })));
    const helper = load('src/lib/customer-inbox-actions.ts', {});
    const before = new Date(Date.now() - 10000), oldAt = new Date(before.getTime() - 1000), laterAt = new Date(before.getTime() + 1000);
    const notify = (id, owner, ticketId, at) => db.customerNotification.create({ data: { id, sourceId: 'support:' + id, customerId: owner, category: 'SUPPORT', ticketId, title: 'Support replied', body: id, url: '/help', createdAt: at } });
    await notify('old', customer.id, tickets[0].id, oldAt);
    await notify('later', customer.id, tickets[0].id, laterAt);
    await notify('other', other.id, tickets[1].id, oldAt);
    await helper.updateCustomerInbox(db, customer.id, { ids: ['old', 'other'], before, dismiss: false });
    assert((await db.customerNotification.findUniqueOrThrow({ where: { id: 'old' } })).readAt);
    assert.equal((await db.customerNotification.findUniqueOrThrow({ where: { id: 'later' } })).readAt, null);
    assert.equal((await db.customerNotification.findUniqueOrThrow({ where: { id: 'other' } })).readAt, null);
    assert.equal((await db.supportTicket.findUniqueOrThrow({ where: { id: tickets[0].id } })).customerReadAt.getTime(), oldAt.getTime());
    await helper.updateCustomerInbox(db, customer.id, { ids: ['old'], before, dismiss: true });
    const dismissed = await db.customerNotification.findUniqueOrThrow({ where: { id: 'old' } });
    assert(dismissed.dismissedAt && dismissed.pushDeliveredAt);
    assert.equal(await db.supportTicket.count(), 2, 'Dismissal preserves conversations.');
    const reply = await db.supportMessage.create({ data: { ticketId: tickets[0].id, authorName: 'Support', authorRole: 'ADMIN', body: 'Historical reply', createdAt: oldAt } });
    const foreign = await db.supportMessage.create({ data: { ticketId: tickets[1].id, authorName: 'Support', authorRole: 'ADMIN', body: 'Private reply', createdAt: oldAt } });
    assert((await helper.legacySupportInbox(db, customer.id)).some(item => item.id === reply.id));
    await helper.updateCustomerInbox(db, customer.id, { supportIds: [reply.id, foreign.id], before, dismiss: true });
    assert(!(await helper.legacySupportInbox(db, customer.id)).some(item => item.id === reply.id), 'Dismissed legacy replies stay hidden.');
    assert.equal(await db.customerNotification.count({ where: { sourceId: 'support:' + foreign.id } }), 0, 'Another customer cannot backfill or change private replies.');
    await helper.updateCustomerInbox(db, customer.id, { category: 'SUPPORT', before, dismiss: false });
    assert.equal((await db.customerNotification.findUniqueOrThrow({ where: { id: 'later' } })).readAt, null, 'Bulk read preserves later arrivals.');
    console.log('PASS: additive migration, atomic support read, owner isolation, cutoff protection, persistent dismissal, legacy replies, and retained conversations.');
  } finally {
    if (owns) {
      assert(/^fetch_inbox_test_[a-f0-9]{32}$/.test(schema));
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      console.log('Isolated test schema removed.');
    }
    await db.$disconnect();
  }
}
main().catch(error => { console.error({ code: error.code || 'TEST_FAILED', message: String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]').slice(0, 600) }); process.exitCode = 1; });
