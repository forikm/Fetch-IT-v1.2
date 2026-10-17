// Real shared PostgreSQL transactions; push transport is captured, never sent.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const next = require("next/server"), ts = require("typescript"), webpush = require("web-push");
if (process.env.RUN_PUSH_INTEGRATION !== "1") throw Error("Set RUN_PUSH_INTEGRATION=1.");
const root = path.resolve(__dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
const schema = "fetch_push_test_" + crypto.randomUUID().replaceAll("-", "");
const target = new URL(process.env.BOOKING_TEST_DATABASE_URL || process.env.DATABASE_URL);
target.searchParams.set("schema", schema); target.searchParams.set("options", `-c search_path=${schema},pg_catalog`);
const databaseUrl = target.toString(), db = new PrismaClient({ datasourceUrl: databaseUrl });
process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
let ownsSchema = false, session = null, admin = null, transportStatus = 0;
const jar = new Map(), sent = [], callbacks = [], cached = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (cached.has(absolute)) return cached.get(absolute);
  const exports = {}; cached.set(absolute, exports);
  const owner = absolute.includes("fetch-admin") ? path.resolve(root, "../fetch-admin") : absolute.includes("fetch-rider") ? path.resolve(root, "../fetch-rider") : root;
  const compiled = ts.transpileModule(fs.readFileSync(absolute, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports, Buffer, process, URL, Date, console: { info() {}, error() {}, warn() {} }, require(name) {
    if (name === "./db" || name === "@/lib/db") return { db };
    if (name === "./session" || name === "@/lib/session") return { getSession: async () => session, clearSessionCookie: async () => { session = null; } };
    if (name === "@/lib/rider-access") return { getRiderSession: async () => session?.role === "RIDER" ? session : null };
    if (name === "@/lib/admin-access") return { currentAdmin: async () => admin };
    if (name === "next/server") return { ...next, after: callback => callbacks.push(callback) };
    if (name === "next/headers") return { cookies: async () => ({ get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set(name, value) { jar.set(name, value); } }) };
    if (name === "web-push") return { generateVAPIDKeys: webpush.generateVAPIDKeys, async sendNotification(subscription, payload, options) {
      if (transportStatus) throw Object.assign(Error("Transport test failure"), { statusCode: transportStatus });
      // Exercise the real SDK's VAPID signing and payload encryption too.
      const encrypted = webpush.generateRequestDetails(subscription, payload, options);
      assert(encrypted.body.length > payload.length); assert(encrypted.headers.Authorization);
      sent.push({ subscription, payload: JSON.parse(payload), options });
    } };
    if (name.startsWith(".")) return load(path.resolve(path.dirname(absolute), name + ".ts"));
    if (name.startsWith("@/")) return load(path.resolve(owner, name.replace("@/", "src/") + ".ts"));
    return require(name);
  } }, { filename: absolute });
  return exports;
}
const actor = user => ({ uid: user.id, name: user.name, role: user.role, email: user.email });
async function request(handler, method = "GET", body, expected = 200, id) {
  const response = await handler(new next.NextRequest("https://fixture.invalid/api/test", { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ id }) });
  const data = await response.json(); assert.equal(response.status, expected, `${method}: ${response.status} ${data.error || ""}`); return data;
}
async function main() {
  try {
    assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname=${schema}`).length, 0); ownsSchema = true;
    const migration = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, windowsHide: true, encoding: "utf8", timeout: 90000 });
    assert.equal(migration.status, 0, `${migration.stdout || ""}\n${migration.stderr || ""}`.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]"));
    for (const fn of await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${schema}`) {
      assert(/^fetch_[a-z_]+$/.test(fn.name)); await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);
    }
    const customer = await db.user.create({ data: { name: "Customer", email: "customer@push-test.invalid" } });
    const other = await db.user.create({ data: { name: "Other", email: "other@push-test.invalid" } });
    admin = await db.user.create({ data: { name: "Admin", email: "admin@push-test.invalid", role: "ADMIN" } });
    const rider = await db.user.create({ data: { name: "Rider", email: "rider@push-test.invalid", role: "RIDER", riderProfile: { create: { vehicleClass: "MOTORCYCLE" } }, riderPresence: { create: { isOnline: true } } } });
    const subscriptionApi = load("src/app/api/push/subscription/route.ts"), inboxApi = load("src/app/api/notifications/route.ts"), delivery = load("src/lib/push-delivery.ts");
    await request(inboxApi.GET, "GET", undefined, 401);
    session = actor(rider); await request(subscriptionApi.GET, "GET", undefined, 403);
    session = actor(customer);
    const config = await request(subscriptionApi.GET);
    assert(config.publicKey); assert(!("privateKey" in config)); assert.equal(config.enabled, false);
    const identities = await Promise.all([delivery.webPushIdentity(), delivery.webPushIdentity()]); assert.equal(identities[0].publicKey, identities[1].publicKey);
    assert.equal(await db.webPushIdentity.count(), 1);
    const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/push-test", keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") } };
    await request(subscriptionApi.POST, "POST", { ...subscription, endpoint: "https://localhost/private" }, 400);
    await request(subscriptionApi.POST, "POST", subscription);
    const device = jar.get("fetchit_push_device"); assert(device); assert.equal((await request(subscriptionApi.GET)).enabled, true);
    let sequence = 0;
    const booking = type => db.booking.create({ data: { refCode: `PUSH-${++sequence}`, customerId: customer.id, type, pickupLabel: "Pickup", pickupLat: 14.6, pickupLng: 121, dropoffLabel: "Destination", dropoffLat: 14.61, dropoffLng: 121.01, vehicleClass: "MOTORCYCLE", distanceKm: 2, baseFare: 60, totalFare: 60 } });
    const ride = await booking("RIDE"), parcel = await booking("DELIVERY");
    const patch = load("../fetch-rider/src/app/api/bookings/[id]/route.ts").PATCH;
    session = actor(rider);
    await request(patch, "PATCH", { status: "ACCEPTED" }, 200, ride.id);
    const rideNotice = await db.customerNotification.findFirstOrThrow({ where: { bookingId: ride.id } });
    assert.equal(rideNotice.category, "RIDE"); assert.match(rideNotice.title, /accepted your ride/); assert(callbacks.length > 0);
    await db.booking.update({ where: { id: ride.id }, data: { status: "CANCELLED" } });
    await request(patch, "PATCH", { status: "ACCEPTED" }, 200, parcel.id);
    await request(patch, "PATCH", { status: "PICKED_UP" }, 200, parcel.id);
    assert.equal(await db.customerNotification.count({ where: { bookingId: parcel.id } }), 2);
    const { recordBookingEvent } = load("src/lib/booking-events.ts");
    const before = await db.customerNotification.count();
    await assert.rejects(db.$transaction(async tx => { await recordBookingEvent(tx, parcel.id, actor(rider), { action: "STATUS_CHANGED", fromStatus: "PICKED_UP", toStatus: "IN_TRANSIT" }); throw Error("Rollback test"); }));
    assert.equal(await db.customerNotification.count(), before, "A failed booking transaction must not queue a push");
    const ticket = await db.supportTicket.create({ data: { customerId: customer.id, category: "OTHER", message: "Help with my account" } });
    await request(load("../fetch-admin/src/app/api/support/[id]/route.ts").PATCH, "PATCH", { status: "IN_PROGRESS", reply: "Private support details" }, 200, ticket.id);
    const supportNotice = await db.customerNotification.findFirstOrThrow({ where: { ticketId: ticket.id } });
    assert.equal(supportNotice.category, "SUPPORT");
    // No page is polling: sending is driven by the committed server outbox.
    await Promise.all([delivery.deliverPendingNotifications(), delivery.deliverPendingNotifications()]);
    assert.equal(sent.length, 4, "Concurrent senders must lease each notification only once");
    assert.equal(new Set(sent.map(item => item.payload.id)).size, 4);
    const supportPush = sent.find(item => item.payload.category === "SUPPORT");
    assert(!supportPush.payload.body.includes("Private")); assert.match(supportPush.payload.url, /\/help\?ticket=/);
    assert.equal(new URL(sent.find(item => item.payload.category === "RIDE").payload.url, "https://fixture.invalid").searchParams.get("booking"), ride.id);
    session = actor(other); assert.equal((await request(inboxApi.GET)).items.length, 0);
    await request(inboxApi.PATCH, "PATCH", { ids: [rideNotice.id] });
    assert.equal((await db.customerNotification.findUniqueOrThrow({ where: { id: rideNotice.id } })).readAt, null);
    session = actor(customer);
    let inbox = await request(inboxApi.GET); assert.equal(inbox.unread.RIDE, 1); assert.equal(inbox.unread.DELIVERY, 2); assert.equal(inbox.unread.SUPPORT, 1);
    assert(inbox.items.every(item => !("pushAttempts" in item) && !("customerId" in item)));
    await request(inboxApi.PATCH, "PATCH", { category: "RIDE" });
    inbox = await request(inboxApi.GET); assert.equal(inbox.unread.RIDE, 0); assert.equal(inbox.unread.DELIVERY, 2); assert.equal(inbox.unread.SUPPORT, 1);
    await request(inboxApi.PATCH, "PATCH", { ids: [supportNotice.id] });
    assert((await db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).customerReadAt);
    assert((await request(load("src/app/api/support/notifications/route.ts").GET)).items.every(item => item.read));
    await request(load("../fetch-admin/src/app/api/support/[id]/route.ts").PATCH, "PATCH", { status: "IN_PROGRESS", reply: "Newer support reply" }, 200, ticket.id);
    inbox = await request(inboxApi.GET); assert.equal(inbox.unread.SUPPORT, 1);
    const newReply = (await request(load("src/app/api/support/notifications/route.ts").GET)).items[0];
    await request(load("src/app/api/support/notifications/route.ts").PATCH, "PATCH", { ids: [newReply.id] });
    assert.equal((await request(inboxApi.GET)).unread.SUPPORT, 0, "Reading a conversation must clear the matching support badge");
    // Expired endpoints are removed. Temporary transport errors retain the inbox and schedule retry.
    transportStatus = 503; await delivery.deliverPendingNotifications();
    let retried = await db.customerNotification.findFirstOrThrow({ where: { sourceId: `support:${newReply.id}` } });
    assert.equal(retried.pushDeliveredAt, null); assert(retried.pushNextAttemptAt > new Date());
    await db.customerNotification.update({ where: { id: retried.id }, data: { pushNextAttemptAt: new Date(0) } });
    transportStatus = 410; await delivery.deliverPendingNotifications(); assert.equal(await db.customerPushSubscription.count(), 0); transportStatus = 0;
    await request(subscriptionApi.POST, "POST", subscription);
    session = actor(other); assert.equal((await request(subscriptionApi.GET)).enabled, false);
    assert.equal(await db.customerPushSubscription.count(), 0, "A different account must disconnect the previous owner of this device");
    await request(subscriptionApi.POST, "POST", subscription);
    assert.equal((await db.customerPushSubscription.findFirstOrThrow()).customerId, other.id);
    await request(subscriptionApi.DELETE, "DELETE"); assert.equal(await db.customerPushSubscription.count(), 0);
    await request(subscriptionApi.POST, "POST", subscription);
    await request(load("src/app/api/auth/logout/route.ts").POST, "POST"); assert.equal(await db.customerPushSubscription.count(), 0);
    console.log("PASS: isolated migrations, real ride/delivery/support handlers, transactional outbox rollback, real payload encryption/VAPID signing, concurrent send leases, category unread counts, ownership, support read synchronization, transient retry, expired subscriptions, account switching, disable and logout. No real pushes or application records changed.");
  } finally {
    try { if (ownsSchema) { assert(/^fetch_push_test_[a-f0-9]{32}$/.test(schema)); await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } } finally { await db.$disconnect(); }
  }
}
main().catch(error => { console.error("Push integration failed:", String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]")); console.error(String(error.stack || "").split("\n").filter(line => /^\s+at /.test(line)).slice(0, 5).join("\n")); process.exitCode = 1; });
