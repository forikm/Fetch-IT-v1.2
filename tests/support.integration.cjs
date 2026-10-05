// Exercises real PostgreSQL migrations and both production apps in a fresh,
// disposable schema. Never changes the configured application's schema or data.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { spawn, spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
if (process.env.RUN_SUPPORT_INTEGRATION !== "1") throw new Error("Set RUN_SUPPORT_INTEGRATION=1 to run the isolated support check.");
const root = path.resolve(__dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
const schema = "fetch_support_test_" + crypto.randomUUID().replaceAll("-", "");
const target = new URL(process.env.SUPPORT_TEST_DATABASE_URL || process.env.DATABASE_URL);
const originalSchema = target.searchParams.get("schema") || "public";
target.searchParams.set("schema", schema);
target.searchParams.set("options", `${target.searchParams.get("options") ?? ""} -c search_path=${schema},pg_catalog`.trim());
assert.notEqual(schema, originalSchema);
const databaseUrl = target.toString();
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const adminRoot = path.resolve(root, "../fetch-admin");
const adminEnv = parseEnv(fs.readFileSync(path.join(adminRoot, ".env"), "utf8"));
const servers = [];
const ports = { customer: 3210, admin: 3212 };
const previewPassword = "support-test-only";
function cookie(user, admin = false) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, email: user.email, name: user.name, role: user.role, exp: Date.now() + 600000 })).toString("base64url");
  const secret = admin ? adminEnv.ADMIN_SESSION_SECRET || "fetch-it-admin-dev-secret-please-rotate" : process.env.SESSION_SECRET || "fetch-it-dev-secret-please-rotate";
  return `${admin ? "fetchit_admin_session" : "fetchit_session"}=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}
async function request(route, auth, expected = 200, method = "GET", body, admin = false) {
  const res = await fetch(`http://localhost:${admin ? ports.admin : ports.customer}${route}`, { method, headers: { "Content-Type": "application/json", ...(auth ? { cookie: auth } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  assert((Array.isArray(expected) ? expected : [expected]).includes(res.status), `${method} ${route}: ${res.status} ${text.slice(0, 250)}`);
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { data, status: res.status };
}
async function startServers() {
  for (const [appRoot, port, extra] of [[root, ports.customer, {}], [adminRoot, ports.admin, adminEnv]]) {
    const child = spawn(process.execPath, [path.join(appRoot, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
      cwd: appRoot, env: { ...process.env, ...extra, DATABASE_URL: databaseUrl }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    servers.push(child);
    // Consume logs without printing credentials or unrelated database query data.
    child.stdout.resume(); child.stderr.resume();
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    if (servers.some(s => s.exitCode !== null)) throw new Error("A support test server exited before becoming ready.");
    const ready = await Promise.all(Object.values(ports).map(async port => {
      try { await fetch(`http://localhost:${port}/api`, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; }
    }));
    if (ready.every(Boolean)) return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("Support test servers did not become ready.");
}
async function main() {
  let ownsSchema = false;
  try {
    assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname = ${schema}`).length, 0);
    ownsSchema = true;
    const migration = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, windowsHide: true, encoding: "utf8", timeout: 90000 });
    if (migration.status !== 0) throw new Error("Isolated migration failed: " + `${migration.stdout ?? ""}\n${migration.stderr ?? ""}`.replace(/postgres(?:ql)?:\/\/\S+/g, "[database URL redacted]"));
    const searchPath = await db.$queryRaw`SHOW search_path`;
    assert(searchPath[0].search_path.includes(schema), "Test connections must use only the isolated schema.");
    // Prisma qualifies tables but PostgreSQL trigger bodies use search_path.
    // Pin only the temporary schema's functions so they cannot read public data.
    const functions = await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${schema}`;
    for (const fn of functions) {
      assert(/^fetch_[a-z_]+$/.test(fn.name));
      await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);
    }
    await startServers();
    const actors = {};
    for (const [label, role] of [["customer", "CUSTOMER"], ["other", "CUSTOMER"], ["rider", "RIDER"], ["admin", "ADMIN"], ["banned", "CUSTOMER"]]) {
      const email = `${label}@support-test.invalid`;
      const salt = crypto.randomBytes(16).toString("hex");
      actors[label] = await db.user.create({ data: { name: `Support test ${label}`, email, role, isBanned: label === "banned",
        authIdentities: { create: { provider: "PASSWORD", providerUserId: email, passwordHash: `${salt}:${crypto.scryptSync(previewPassword, salt, 64).toString("hex")}` } } } });
    }
    const token = cookie(actors.customer), otherToken = cookie(actors.other), adminToken = cookie(actors.admin, true);
    await request("/api/support", null, 401);
    await request("/api/support/notifications", cookie(actors.rider), 403);
    await request("/api/support", cookie(actors.banned), 403);
    const booking = await db.booking.create({ data: { refCode: "SUPPORT-TEST", customerId: actors.customer.id, type: "RIDE", pickupLabel: "Test pickup", pickupLat: 14.6, pickupLng: 121,
      dropoffLabel: "Test dropoff", dropoffLat: 14.7, dropoffLng: 121.1, vehicleClass: "MOTORCYCLE", distanceKm: 2, baseFare: 50, totalFare: 50 } });
    await request("/api/support", otherToken, 404, "POST", { bookingId: booking.id, category: "BOOKING", message: "Please check my booking" });
    await request("/api/support", token, 400, "POST", { category: "RIDER", message: "Please check my booking" });
    const race = await Promise.all([1, 2].map(() => request("/api/support", token, [201, 409], "POST", { category: "OTHER", message: "Help with my account please" })));
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
    const ticket = race.find(r => r.status === 201).data.ticket;
    assert.equal(ticket.bookingId, null);
    const active = (await request("/api/support", token, 201, "POST", { bookingId: booking.id, category: "BOOKING", message: "My rider has not arrived" })).data.ticket;
    assert.equal(active.priority, "HIGH");
    await assert.rejects(db.supportTicket.create({ data: { customerId: actors.rider.id, category: "OTHER", message: "Invalid account" } }));
    await assert.rejects(db.supportTicket.create({ data: { customerId: actors.other.id, bookingId: booking.id, category: "BOOKING", message: "Invalid ownership" } }));
    for (const method of ["GET", "POST"]) await request(`/api/support/${ticket.id}`, otherToken, 404, method, method === "POST" ? { message: "Forged reply" } : undefined);
    await request(`/api/support/${ticket.id}`, null, 401);
    await request(`/api/support/${ticket.id}`, adminToken, 400, "PATCH", { status: "RESOLVED", reply: "" }, true);
    await request(`/api/support/${ticket.id}`, adminToken, 200, "PATCH", { status: "RESOLVED", priority: "NORMAL", reply: "We have checked your account.", assignedAdminId: actors.admin.id, updatedAt: ticket.updatedAt }, true);
    const firstReply = (await request(`/api/support/${ticket.id}`, token)).data;
    assert.equal(firstReply.messages.length, 1); assert.equal(firstReply.messages[0].authorRole, "ADMIN");
    const firstReplyId = firstReply.messages[0].id;
    assert.equal((await request("/api/support/notifications", token)).data.items[0].read, false);
    await request("/api/support/notifications", otherToken, 200, "PATCH", { ids: [firstReplyId] });
    assert.equal((await request("/api/support/notifications", token)).data.items[0].read, false);
    const beforeRead = await db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    await request("/api/support/notifications", token, 200, "PATCH", { ids: [firstReplyId] });
    assert.equal((await request("/api/support/notifications", token)).data.items[0].read, true);
    assert.equal((await db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).updatedAt.getTime(), beforeRead.updatedAt.getTime());
    const reply = (await request(`/api/support/${ticket.id}`, token, 201, "POST", { message: "It is still not working.", authorRole: "ADMIN" })).data;
    assert.equal(reply.reopened, true); assert.equal(reply.message.authorRole, "CUSTOMER");
    const reopened = await db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(reopened.status, "OPEN"); assert(reopened.lastCustomerMessageAt > reopened.lastAdminReplyAt);
    const adminNotifications = (await request("/api/notifications", adminToken, 200, "GET", undefined, true)).data.items;
    assert(adminNotifications.some(m => m.title === "Customer replied" && m.href.endsWith(ticket.id)));
    const queue = (await request("/dashboard/support?unanswered=1", adminToken, 200, "GET", undefined, true)).data;
    assert(queue.includes(`ticket-${ticket.id}`)); assert(queue.includes("Account help"));
    await request(`/api/support/${ticket.id}`, adminToken, 409, "PATCH", { status: "IN_PROGRESS", reply: "Old draft", updatedAt: beforeRead.updatedAt.toISOString() }, true);
    await request(`/api/support/${ticket.id}`, adminToken, 400, "PATCH", { status: "RESOLVED", reply: "" }, true);
    await request(`/api/support/${ticket.id}`, adminToken, 200, "PATCH", { status: "RESOLVED", reply: "Please try these next steps.", updatedAt: reopened.updatedAt.toISOString() }, true);
    const alerts = (await request("/api/support/notifications", token)).data.items;
    assert.equal(alerts.filter(m => !m.read).length, 1);
    await request("/api/support/notifications", token, 200, "PATCH", { ids: [firstReplyId] });
    assert.equal((await request("/api/support/notifications", token)).data.items.filter(m => !m.read).length, 1);
    const fresh = alerts.find(m => !m.read);
    await request("/api/support/notifications", token, 200, "PATCH", { ids: [fresh.id] });
    assert.equal((await request("/api/support/notifications", token)).data.items.filter(m => !m.read).length, 0);
    const newest = await db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    await request(`/api/support/${ticket.id}`, token, 201, "POST", { message: "One more question" });
    await request(`/api/support/${ticket.id}`, adminToken, 409, "PATCH", { status: "RESOLVED", reply: "A stale answer", updatedAt: newest.updatedAt.toISOString() }, true);
    const base = Date.now() - 86400000;
    await db.supportMessage.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ ticketId: ticket.id, authorId: actors.customer.id, authorName: "Test customer", authorRole: "CUSTOMER", body: `Earlier message ${i}`, createdAt: new Date(base + i) })) });
    const page = (await request(`/api/support/${ticket.id}`, token)).data;
    assert.equal(page.messages.length, 50); assert(page.nextCursor);
    const older = (await request(`/api/support/${ticket.id}?cursor=${page.nextCursor}`, token)).data;
    assert.equal(new Set([...page.messages, ...older.messages].map(m => m.id)).size, 59);
    const foreignMessage = await db.supportMessage.create({ data: { ticketId: active.id, authorId: actors.admin.id, authorName: "Admin", body: "Legacy-compatible reply" } });
    assert.equal(foreignMessage.authorRole, "ADMIN");
    await request(`/api/support/${ticket.id}?cursor=${foreignMessage.id}`, token, 404);
    await db.supportTicket.createMany({ data: Array.from({ length: 22 }, (_, i) => ({ customerId: actors.customer.id, category: "OTHER", status: "RESOLVED", message: `Older request ${i}` })) });
    const tickets = (await request("/api/support", token)).data;
    assert.equal(tickets.tickets.length, 20); assert(tickets.nextCursor);
    const olderTickets = (await request(`/api/support?cursor=${tickets.nextCursor}`, token)).data;
    assert.equal(new Set([...tickets.tickets, ...olderTickets.tickets].map(t => t.id)).size, 24);
    assert.equal((await request("/api/support", otherToken)).data.tickets.length, 0);
    await request(`/api/support?cursor=${ticket.id}`, otherToken, 404);
    await request("/api/support/notifications", token, 400, "PATCH", { ids: Array(101).fill(firstReplyId) });
    await request("/help", null);
    console.log("PASS: isolated migrations, ownership, role checks, duplicate submissions, account help, active priority, two-way replies, reopening, stale admin forms, unanswered queue, alerts, persistent read state, and pagination.");
    if (process.env.SUPPORT_PREVIEW === "1") {
      console.log(`Isolated preview: http://localhost:${ports.customer}/help and http://localhost:${ports.admin}/dashboard/support`);
      console.log(`Test-only logins: customer@support-test.invalid / admin@support-test.invalid, password: ${previewPassword}. Use the customer's older account sign-in. Send a newline to end the preview and clean up.`);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 10 * 60 * 1000);
        process.stdin.once("data", () => { clearTimeout(timer); resolve(); });
        process.stdin.once("end", () => { clearTimeout(timer); resolve(); });
      });
    }
  } finally {
    for (const child of servers) child.kill();
    // Only this run's random, validated schema can be removed.
    if (ownsSchema) {
      assert(/^fetch_support_test_[a-f0-9]{32}$/.test(schema));
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
