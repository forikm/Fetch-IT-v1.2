// Runs all three production servers in a newly created disposable DB schema.
// Never changes application data; removes only the schema it owns.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { spawn, spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
if (process.env.RUN_DATABASE_INTEGRATION !== "1") throw new Error("Set RUN_DATABASE_INTEGRATION=1 to test the configured shared test database.");
const root = path.resolve(__dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
const schema = "fetch_security_test_" + crypto.randomUUID().replaceAll("-", "");
const target = new URL(process.env.DATABASE_URL);
target.searchParams.set("schema", schema);
target.searchParams.set("options", `${target.searchParams.get("options") || ""} -c search_path=${schema},pg_catalog`.trim());
process.env.DATABASE_URL = target.toString();
process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(32).toString("hex");
const db = new PrismaClient();
let ownsSchema = false;
const marker = "db-rebuild-" + crypto.randomUUID();
// A legacy password shorter than the new signup minimum must still log in.
const password = "legacy123";
const actors = [];
const servers = [];
const apps = { customer: ["fetch-customer", 3100], rider: ["fetch-rider", 3101], admin: ["fetch-admin", 3102] };
function passwordHash() {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
async function request(app, route, auth, method = "GET", body, expected = 200) {
  const res = await fetch(`http://localhost:${apps[app][1]}${route}`, {
    method, headers: { "Content-Type": "application/json", ...(auth ? { cookie: auth } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  assert((Array.isArray(expected) ? expected : [expected]).includes(res.status), `${app} ${method} ${route}${body?.status ? ` -> ${body.status}` : ""}: ${res.status} ${text.slice(0, 250)}`);
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}
async function account(role, suffix, firebase = false) {
  const email = `${marker}-${suffix}@example.invalid`;
  const user = await db.user.create({ data: { email, name: "Disposable " + suffix, phone: "+639171234567", role,
    authIdentities: { create: firebase ? { provider: "FIREBASE", providerUserId: `${marker}-firebase` } : { provider: "PASSWORD", providerUserId: email, passwordHash: passwordHash() } },
    ...(role === "RIDER" ? { riderProfile: { create: { vehicleClass: "MOTORCYCLE", vehiclePlate: "TEST" } }, riderPresence: { create: { isOnline: true } } } : {}),
  } });
  actors.push(user.id);
  return user;
}
async function login(app, user) {
  const res = await request(app, "/api/auth/login", null, "POST", { email: user.email.toUpperCase(), password, role: user.role });
  assert(res.cookie); assert(!JSON.stringify(res.data).includes("passwordHash"));
  return res.cookie;
}
async function createBooking(auth, type = "DELIVERY") {
  const res = await request("customer", "/api/bookings", auth, "POST", { type,
    pickup: { label: "Test pickup", lat: 14.6, lng: 120.98 }, dropoff: { label: "Test destination", lat: 14.61, lng: 120.99 },
    vehicleClass: "MOTORCYCLE", cargoWeightKg: 1, passengers: 1 });
  assert.equal(typeof res.data.booking.totalFare, "number");
  assert(!("ticketId" in res.data.booking));
  assert(!JSON.stringify(res.data).includes("authIdentities"));
  return db.booking.findUniqueOrThrow({ where: { id: res.data.booking.id } });
}
async function advance(booking, auth, statuses) {
  for (const status of statuses) await request("rider", `/api/bookings/${booking.id}`, auth, "PATCH", { status });
}
async function startServers() {
  for (const [app, port] of Object.values(apps)) {
    const cwd = path.resolve(root, "..", app);
    const env = { ...process.env, ...parseEnv(fs.readFileSync(path.join(cwd, ".env"), "utf8")),
      DATABASE_URL: process.env.DATABASE_URL, SESSION_SECRET: process.env.SESSION_SECRET,
      ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET };
    const child = spawn(process.execPath, [path.join(cwd, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const state = { child, logs: "" }; servers.push(state);
    child.stdout.on("data", data => { state.logs = (state.logs + data).slice(-4000); });
    child.stderr.on("data", data => { state.logs = (state.logs + data).slice(-4000); });
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (servers.some(s => s.child.exitCode !== null)) throw new Error("A test server exited before becoming ready.");
    const ready = await Promise.all(Object.values(apps).map(async ([, port]) => {
      try { await fetch(`http://localhost:${port}/api`, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
    }));
    if (ready.every(Boolean)) return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("Test servers did not become ready.");
}
async function main() {
  try {
    assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname = ${schema}`).length, 0);
    ownsSchema = true;
    const migration = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root, env: process.env, windowsHide: true, encoding: "utf8", timeout: 90000 });
    assert.equal(migration.status, 0, "Disposable schema migrations must succeed.");
    assert((await db.$queryRaw`SHOW search_path`)[0].search_path.includes(schema));
    const functions = await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${schema}`;
    for (const fn of functions) {
      assert(/^fetch_[a-z_]+$/.test(fn.name));
      await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);
    }
    await startServers();
    const customer = await account("CUSTOMER", "customer"), other = await account("CUSTOMER", "other");
    const rider = await account("RIDER", "rider"), second = await account("RIDER", "second");
    const admin = await account("ADMIN", "admin"), firebase = await account("CUSTOMER", "firebase", true);
    const identity = await db.authIdentity.findFirst({ where: { userId: firebase.id } });
    assert.notEqual(identity.providerUserId, firebase.id); assert.equal(identity.passwordHash, null);
    const customerAuth = await login("customer", customer), otherAuth = await login("customer", other);
    const riderAuth = await login("rider", rider), secondAuth = await login("rider", second), adminAuth = await login("admin", admin);
    if (process.env.RUN_ADMIN_PAGE_INTEGRATION === "1") {
      const sample = await createBooking(customerAuth);
      const completed = await createBooking(customerAuth, "RIDE");
      await db.booking.update({ where: { id: completed.id }, data: { riderId: rider.id, status: "DELIVERED", deliveredAt: new Date(), paymentStatus: "PAID", paidAt: new Date(), paymentReference: "CASH-FIXTURE" } });
      for (const route of ["/dashboard", "/dashboard/reports", "/dashboard/riders", `/dashboard/riders/${rider.id}`, "/dashboard/bookings", `/dashboard/bookings/${sample.id}`, `/dashboard/bookings/${completed.id}`, "/dashboard/audit"]) {
        const page = await request("admin", route, adminAuth);
        assert(page.data.includes("admin-workspace"), `${route} must render the authenticated admin page`);
      }
      console.log("PASS: admin overview, reports, rider pages, booking list, payment/assignment details and audit pages render against the migrated schema.");
      return;
    }
    await request("rider", "/api/auth/login", null, "POST", { email: customer.email, password }, 403);
    await request("admin", "/api/auth/login", null, "POST", { email: rider.email, password }, 401);
    const me = await request("rider", "/api/auth/me", riderAuth); assert.equal(me.data.user.vehicleClass, "MOTORCYCLE"); assert.equal(me.data.user.isOnline, true);
    await assert.rejects(db.riderProfile.create({ data: { userId: customer.id, vehicleClass: "MOTORCYCLE" } }));
    await assert.rejects(db.user.update({ where: { id: customer.id }, data: { role: "ADMIN" } }));
    console.log("PASS: normalized password login, separate Firebase identity, role checks, safe account DTOs.");

    const booking = await createBooking(customerAuth);
    const available = (await request("rider", "/api/rider/available", riderAuth)).data.jobs.find(job => job.id === booking.id);
    assert(available);
    assert.equal(available.customer.name, "Customer"); assert.equal(available.customer.phone, null);
    for (const value of [customer.email, customer.name, customer.phone, customer.id, booking.ticketId]) assert(!JSON.stringify(available).includes(value));
    assert.equal(available.ticket, null); assert.equal(available.cargoNotes, null);
    await request("customer", `/api/bookings/${booking.id}`, otherAuth, "GET", undefined, 403);
    await request("customer", `/api/bookings/${booking.id}/cancel`, otherAuth, "POST", { reason: "Ownership check" }, 403);
    await request("rider", `/api/bookings/${booking.id}`, secondAuth, "GET", undefined, 403);
    const otherStatuses = await request("customer", `/api/bookings/status?ids=${booking.id}`, otherAuth);
    assert.equal(otherStatuses.data.bookings.length, 0);
    assert.equal(await db.bookingEvent.count({ where: { bookingId: booking.id, action: "CREATED" } }), 1);
    await db.booking.update({ where: { id: booking.id }, data: { totalFare: "123.45" } });
    const detail = await request("customer", `/api/bookings/${booking.id}`, customerAuth); assert.equal(detail.data.booking.totalFare, 123.45);
    await assert.rejects(db.booking.update({ where: { id: booking.id }, data: { totalFare: -1 } }));
    await assert.rejects(db.booking.update({ where: { id: booking.id }, data: { riderId: customer.id } }));
    const claims = await Promise.all([request("rider", `/api/bookings/${booking.id}`, riderAuth, "PATCH", { status: "ACCEPTED" }, [200, 409]), request("rider", `/api/bookings/${booking.id}`, secondAuth, "PATCH", { status: "ACCEPTED" }, [200, 409])]);
    assert.deepEqual(claims.map(c => c.status).sort(), [200, 409]);
    const owner = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const ownerAuth = owner.riderId === rider.id ? riderAuth : secondAuth;
    const unrelatedAuth = owner.riderId === rider.id ? secondAuth : riderAuth;
    const acceptedDetails = (await request("rider", `/api/bookings/${booking.id}`, ownerAuth)).data.booking;
    assert.equal(acceptedDetails.customer.phone, customer.phone); assert(acceptedDetails.ticket);
    await request("rider", `/api/bookings/${booking.id}`, unrelatedAuth, "PATCH", { status: "PICKED_UP" }, 403);
    await advance(booking, ownerAuth, ["PICKED_UP", "IN_TRANSIT"]);
    assert.equal(await db.bookingEvent.count({ where: { bookingId: booking.id } }), 4);
    console.log("PASS: exact decimal storage, numeric API fares, concurrent rider claims, atomic booking events.");


    const ownerAccount = owner.riderId === rider.id ? rider : second;
    const native = await fetch("http://localhost:3101/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-client": "fetchit-android" }, body: JSON.stringify({ email: ownerAccount.email, password }) });
    const nativeToken = (await native.json()).token; assert(nativeToken);
    const unrelatedGps = await fetch(`http://localhost:3101/api/native/tickets/${booking.ticketId}/location`, {
      method: "POST", headers: { "Content-Type": "application/json", authorization: `Bearer ${unrelatedAuth.split("=")[1]}` },
      body: JSON.stringify({ lat: 14.62, lng: 121 }) });
    assert.equal(unrelatedGps.status, 403);
    async function gps(lat, expected = 200) {
      const res = await fetch(`http://localhost:3101/api/native/tickets/${booking.ticketId}/location`, { method: "POST", headers: { "Content-Type": "application/json", authorization: `Bearer ${nativeToken}` }, body: JSON.stringify({ lat, lng: 121, speedKph: 25, heading: 90 }) });
      assert.equal(res.status, expected); return res.json();
    }
    await gps(14.62); await gps(14.63); await gps(14.64); await gps(91, 400);
    assert.equal(await db.trackingUpdate.count({ where: { bookingId: booking.id } }), 1);
    assert.equal((await db.bookingLocation.findUnique({ where: { bookingId: booking.id } })).lat, 14.64);
    const scopedDetail = await request("customer", `/api/bookings/${booking.id}`, customerAuth); assert.equal(scopedDetail.data.booking.rider.lat, null);
    const live = await request("customer", `/api/bookings/status?onlyTracked=1&ids=${booking.id}`, customerAuth); assert.equal(live.data.bookings[0].trackingUpdates[0].lat, 14.64);
    console.log("PASS: every GPS update refreshes the live map while historical points are sampled.");

    await request("customer", `/api/bookings/${booking.id}/otp`, otherAuth, "GET", undefined, 404);
    const code = (await request("customer", `/api/bookings/${booking.id}/otp`, customerAuth)).data.otp;
    assert.equal((await request("customer", `/api/bookings/${booking.id}/otp`, customerAuth)).data.otp, code);
    assert.equal(await db.deliveryProof.count({ where: { bookingId: booking.id } }), 0);
    await request("rider", `/api/bookings/${booking.id}/proof`, unrelatedAuth, "POST", { otp: code }, 403);
    await request("rider", `/api/bookings/${booking.id}`, ownerAuth, "PATCH", { status: "DELIVERED" }, 409);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await request("rider", `/api/bookings/${booking.id}/proof`, ownerAuth, "POST", { otp: wrong }, 400);
    await request("rider", `/api/bookings/${booking.id}/proof`, ownerAuth, "POST", { otp: code }, 429);
    assert.equal((await db.deliveryChallenge.findUnique({ where: { bookingId: booking.id } })).attempts, 5);
    await db.deliveryChallenge.update({ where: { bookingId: booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const freshCode = (await request("customer", `/api/bookings/${booking.id}/otp`, customerAuth)).data.otp;
    const completed = await Promise.all([request("rider", `/api/bookings/${booking.id}/proof`, ownerAuth, "POST", { otp: freshCode }, [200, 409]), request("rider", `/api/bookings/${booking.id}/proof`, ownerAuth, "POST", { otp: freshCode }, [200, 409])]);
    assert.deepEqual(completed.map(c => c.status).sort(), [200, 409]);
    assert.equal((await db.riderProfile.findUnique({ where: { userId: owner.riderId } })).totalDeliveries, 1);
    assert.equal(await db.deliveryProof.count({ where: { bookingId: booking.id, proofType: "OTP" } }), 1);
    assert.equal(await db.bookingEvent.count({ where: { bookingId: booking.id, toStatus: "DELIVERED" } }), 1);
    console.log("PASS: delivery-code ownership, attempt lockout, expiry renewal, replay rejection, and exactly-once completion.");

    const matched = await createBooking(customerAuth);
    await db.booking.update({ where: { id: matched.id }, data: { riderId: rider.id, status: "MATCHED" } });
    const matchedDetails = (await request("rider", `/api/bookings/${matched.id}`, riderAuth)).data.booking;
    assert.equal(matchedDetails.customer.phone, null); assert.equal(matchedDetails.ticket, null);
    const nativeMatched = await fetch(`http://localhost:3101/api/native/tickets/${matched.ticketId}`, {
      headers: { authorization: `Bearer ${riderAuth.split("=")[1]}` } });
    assert.equal(nativeMatched.status, 409);
    await request("rider", `/api/bookings/${matched.id}`, riderAuth, "PATCH", { status: "ACCEPTED" });
    const cancellationRace = await Promise.all([
      request("customer", `/api/bookings/${matched.id}/cancel`, customerAuth, "POST", { reason: "Race check" }, [200, 400, 409]),
      request("rider", `/api/bookings/${matched.id}`, riderAuth, "PATCH", { status: "PICKED_UP" }, [200, 409]),
    ]);
    assert.equal(cancellationRace.filter(r => r.status === 200).length, 1);
    const finalRace = await db.booking.findUniqueOrThrow({ where: { id: matched.id } });
    assert(["PICKED_UP", "CANCELLED"].includes(finalRace.status));
    assert.equal(await db.bookingEvent.count({ where: { bookingId: matched.id, toStatus: { in: ["PICKED_UP", "CANCELLED"] } } }), 1);
    console.log("PASS: private pending/matched job feeds, customer ownership, assigned-rider contact details and cancellation/pickup race.");
    if (finalRace.status !== "CANCELLED") await request("admin", `/api/bookings/${matched.id}`, adminAuth, "PATCH", { action: "cancel", reason: "Free the test rider after the pickup race" });

    const photoBooking = await createBooking(customerAuth);
    await advance(photoBooking, riderAuth, ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"]);
    const photo = await request("rider", `/api/bookings/${photoBooking.id}/proof`, riderAuth, "POST", { photoDataUrl: "data:image/png;base64,aGVsbG8=" });
    assert.equal(photo.data.proofs[0].verified, false);
    assert.equal((await db.booking.findUnique({ where: { id: photoBooking.id } })).status, "IN_TRANSIT");
    await request("rider", `/api/bookings/${photoBooking.id}/proof`, riderAuth, "POST", { signatureSvg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>' });
    const signature = (await request("customer", `/api/bookings/${photoBooking.id}`, customerAuth)).data.booking.deliveryProofs.find(p => p.proofType === "SIGNATURE");
    assert(signature.verifiedAt); assert(!("otpCode" in signature));
    const ride = await createBooking(customerAuth, "RIDE");
    await advance(ride, riderAuth, ["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"]);
    const cancelled = await createBooking(customerAuth);
    await request("customer", `/api/bookings/${cancelled.id}/cancel`, customerAuth, "POST", { reason: "Plans changed" });
    assert.equal(await db.bookingEvent.count({ where: { bookingId: cancelled.id, action: "CANCELLED" } }), 1);
    const race = await createBooking(customerAuth);
    await advance(race, riderAuth, ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"]);
    const finishRace = await Promise.all([request("rider", `/api/bookings/${race.id}/proof`, riderAuth, "POST", { signatureSvg: "<svg/>" }, [200, 409]), request("admin", `/api/bookings/${race.id}`, adminAuth, "PATCH", { action: "cancel", reason: "Disposable race check" }, [200, 409])]);
    assert.deepEqual(finishRace.map(c => c.status).sort(), [200, 409]);
    assert.equal(await db.bookingEvent.count({ where: { bookingId: race.id, toStatus: { in: ["DELIVERED", "CANCELLED"] } } }), 1);
    console.log("PASS: photo/signature separation, ride completion, cancellation reasons, and completion/cancellation races.");

    for (const route of ["/dashboard", "/dashboard/reports", "/dashboard/riders", `/dashboard/riders/${rider.id}`, `/dashboard/bookings/${booking.id}`]) await request("admin", route, adminAuth);
    const adminDetail = await request("admin", `/dashboard/bookings/${booking.id}`, adminAuth); assert(adminDetail.data.includes("Booking history"));
    const old = await createBooking(customerAuth), recent = await createBooking(customerAuth), active = await createBooking(customerAuth);
    const oldDate = new Date(Date.now() - 35 * 86400000);
    for (const [b, finishedAt] of [[old, oldDate], [recent, new Date()], [active, null]]) {
      await db.booking.update({ where: { id: b.id }, data: { riderId: rider.id, status: finishedAt ? "DELIVERED" : "IN_TRANSIT", deliveredAt: finishedAt } });
      await db.trackingUpdate.create({ data: { bookingId: b.id, riderId: rider.id, lat: 14, lng: 121, source: "NATIVE", createdAt: oldDate } });
      await db.bookingLocation.create({ data: { bookingId: b.id, riderId: rider.id, lat: 14, lng: 121, createdAt: oldDate } });
    }
    await request("rider", "/api/maintenance/tracking", null, "GET", undefined, 401);
    const env = parseEnv(fs.readFileSync(path.resolve(root, "../fetch-rider/.env"), "utf8"));
    const cleanup = await fetch("http://localhost:3101/api/maintenance/tracking", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }); assert.equal(cleanup.status, 200);
    assert.equal(await db.trackingUpdate.count({ where: { bookingId: old.id } }), 0);
    assert.equal(await db.bookingLocation.count({ where: { bookingId: old.id } }), 0);
    assert.equal(await db.trackingUpdate.count({ where: { bookingId: { in: [recent.id, active.id] } } }), 2);
    console.log("PASS: admin pages render, protected cleanup removes only locations from bookings finished over 30 days ago.");

    await db.user.update({ where: { id: rider.id }, data: { isBanned: true } });
    await request("rider", "/api/rider/stats", riderAuth, "GET", undefined, 401);
    console.log("PASS: existing rider sessions stop working after an account restriction.");

    const features = spawn(process.execPath, [path.join(root, "tests/customer-features.integration.cjs")], { cwd: root,
      env: { ...process.env, RUN_CUSTOMER_INTEGRATION: "1", CUSTOMER_TEST_PORT: "3100", ADMIN_TEST_PORT: "3102" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; features.stdout.on("data", data => { output += data; }); features.stderr.on("data", data => { output += data; });
    const featureCode = await new Promise(resolve => features.on("exit", resolve));
    assert.equal(featureCode, 0, output.slice(-2000)); console.log(output.trim());

    // Concurrent requests use the same database quota across server instances.
    for (const app of ["customer", "rider", "admin"]) {
      const limitedEmail = `${marker}-rate-${app}@example.invalid`;
      const failed = await Promise.all(Array.from({ length: 20 }, () => request(app, "/api/auth/login", null, "POST", {
        email: limitedEmail, password: "incorrect-password" }, [401, 429])));
      assert.equal(failed.filter(r => r.status === 401).length, 15);
      assert.equal(failed.filter(r => r.status === 429).length, 5);
      for (const result of failed) {
        assert(result.headers.get("x-request-id"));
        assert.equal(result.headers.get("cache-control"), "private, no-store");
        if (result.status === 429) assert(Number(result.headers.get("retry-after")) > 0);
      }
      const key = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(JSON.stringify([`${app}:login-account`, limitedEmail])).digest("hex");
      await db.rateLimitBucket.update({ where: { key }, data: { expiresAt: new Date(0) } });
      await request(app, "/api/auth/login", null, "POST", { email: limitedEmail, password: "incorrect-password" }, 401);
      assert.equal((await db.rateLimitBucket.findUniqueOrThrow({ where: { key } })).hits, 1);
    }
    await request("rider", "/api/auth/signup", null, "POST", { name: "Short password check", email: `${marker}-short@example.invalid`, role: "RIDER", vehicleClass: "MOTORCYCLE", password: "1234" }, 400);
    const expiredKey = "expired-test-bucket";
    await db.rateLimitBucket.create({ data: { key: expiredKey, hits: 1, expiresAt: new Date(0) } });
    const cleanupEnv = parseEnv(fs.readFileSync(path.resolve(root, "../fetch-rider/.env"), "utf8"));
    const cleanupRate = await fetch("http://localhost:3101/api/maintenance/tracking", { headers: { authorization: `Bearer ${cleanupEnv.CRON_SECRET}` } });
    assert.equal(cleanupRate.status, 200);
    assert.equal(await db.rateLimitBucket.count({ where: { key: expiredKey } }), 0);
    for (const state of servers) {
      assert(!state.logs.includes(password)); assert(!state.logs.includes(customer.email));
      assert(!state.logs.includes(process.env.DATABASE_URL));
    }
    console.log("PASS: atomic persistent login limits in all apps, Retry-After/request IDs, weak-password rejection, expired quota cleanup and safe logs.");
  } finally {
    try {
      if (actors.length) {
        await db.adminAudit.deleteMany({ where: { actorId: { in: actors } } });
        const ids = (await db.booking.findMany({ where: { customerId: { in: actors } }, select: { id: true } })).map(b => b.id);
        await db.supportTicket.deleteMany({ where: { bookingId: { in: ids } } });
        await db.customerReview.deleteMany({ where: { bookingId: { in: ids } } });
        await db.booking.deleteMany({ where: { id: { in: ids } } });
        await db.user.deleteMany({ where: { id: { in: actors } } });
      }
    } finally {
      for (const server of servers) server.child.kill();
      if (ownsSchema) {
        assert(/^fetch_security_test_[a-f0-9]{32}$/.test(schema));
        await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
      await db.$disconnect();
    }
  }
}
main().then(() => console.log("PASS: shared database rebuild integration complete; fixtures and test servers cleaned up.")).catch(error => {
  console.error(error.message);
  for (const server of servers) {
    const codes = [...new Set((server.logs || '').match(/\b(?:P\d{4}|INTERNAL|ECONNRESET|ETIMEDOUT)\b/g) || [])];
    if (codes.length) console.error('Test server diagnostic codes:', codes.join(', '));
    const errors = (server.logs || '').split(/\r?\n/).filter(line => /(?:Error:|TypeError:|ReferenceError:|SyntaxError:|Digest:)/.test(line));
    for (const line of errors) console.error(line.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL redacted]').slice(0, 800));
  }
  process.exitCode = 1;
});
