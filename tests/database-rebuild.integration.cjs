// Runs production servers on separate test ports, creates disposable fixtures,
// checks cross-app behaviour against Neon, then removes fixtures and servers.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
if (process.env.RUN_DATABASE_INTEGRATION !== "1") throw new Error("Set RUN_DATABASE_INTEGRATION=1 to test the configured shared test database.");
const root = path.resolve(__dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
const db = new PrismaClient();
const marker = "db-rebuild-" + crypto.randomUUID();
const password = "integration-only-password";
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
  assert((Array.isArray(expected) ? expected : [expected]).includes(res.status), `${app} ${method} ${route}: ${res.status} ${text.slice(0, 250)}`);
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}
async function account(role, suffix, firebase = false) {
  const email = `${marker}-${suffix}@example.invalid`;
  const user = await db.user.create({ data: { email, name: "Disposable " + suffix, role,
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
    const env = { ...process.env, ...parseEnv(fs.readFileSync(path.join(cwd, ".env"), "utf8")) };
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
    await startServers();
    const customer = await account("CUSTOMER", "customer"), other = await account("CUSTOMER", "other");
    const rider = await account("RIDER", "rider"), second = await account("RIDER", "second");
    const admin = await account("ADMIN", "admin"), firebase = await account("CUSTOMER", "firebase", true);
    const identity = await db.authIdentity.findFirst({ where: { userId: firebase.id } });
    assert.notEqual(identity.providerUserId, firebase.id); assert.equal(identity.passwordHash, null);
    const customerAuth = await login("customer", customer), otherAuth = await login("customer", other);
    const riderAuth = await login("rider", rider), secondAuth = await login("rider", second), adminAuth = await login("admin", admin);
    await request("rider", "/api/auth/login", null, "POST", { email: customer.email, password }, 403);
    await request("admin", "/api/auth/login", null, "POST", { email: rider.email, password }, 401);
    const me = await request("rider", "/api/auth/me", riderAuth); assert.equal(me.data.user.vehicleClass, "MOTORCYCLE"); assert.equal(me.data.user.isOnline, true);
    await assert.rejects(db.riderProfile.create({ data: { userId: customer.id, vehicleClass: "MOTORCYCLE" } }));
    await assert.rejects(db.user.update({ where: { id: customer.id }, data: { role: "ADMIN" } }));
    console.log("PASS: normalized password login, separate Firebase identity, role checks, safe account DTOs.");

    const booking = await createBooking(customerAuth);
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
    await advance(booking, ownerAuth, ["PICKED_UP", "IN_TRANSIT"]);
    assert.equal(await db.bookingEvent.count({ where: { bookingId: booking.id } }), 4);
    console.log("PASS: exact decimal storage, numeric API fares, concurrent rider claims, atomic booking events.");

    const ownerAccount = owner.riderId === rider.id ? rider : second;
    const native = await fetch("http://localhost:3101/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-client": "fetchit-android" }, body: JSON.stringify({ email: ownerAccount.email, password }) });
    const nativeToken = (await native.json()).token; assert(nativeToken);
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
    await request("customer", `/api/bookings/${cancelled.id}/cancel`, customerAuth, "POST");
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
    } finally { await db.$disconnect(); for (const server of servers) server.child.kill(); }
  }
}
main().then(() => console.log("PASS: shared database rebuild integration complete; fixtures and test servers cleaned up.")).catch(error => { console.error(error.message); process.exitCode = 1; });
