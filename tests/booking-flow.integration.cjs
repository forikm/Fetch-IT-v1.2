// Production-server check in a new disposable schema; never changes app data.
/* eslint-disable @typescript-eslint/no-require-imports -- This harness runs directly as CommonJS. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
if (process.env.RUN_BOOKING_INTEGRATION !== "1") throw new Error("Set RUN_BOOKING_INTEGRATION=1 to run the isolated booking check.");
const root = path.resolve(__dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
const schema = "fetch_booking_test_" + crypto.randomUUID().replaceAll("-", "");
const target = new URL(process.env.BOOKING_TEST_DATABASE_URL || process.env.DATABASE_URL);
assert.notEqual(schema, target.searchParams.get("schema") || "public");
target.searchParams.set("schema", schema);
target.searchParams.set("options", `${target.searchParams.get("options") ?? ""} -c search_path=${schema},pg_catalog`.trim());
const databaseUrl = target.toString();
const db = new PrismaClient({ datasourceUrl: databaseUrl });
const port = 3210;
const password = "booking-test-only";
let server;
function startServer() {
  const child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.resume(); child.stderr.resume();
  return child;
}
function cookie(user) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, email: user.email, name: user.name, role: user.role, exp: Date.now() + 600000 })).toString("base64url");
  const secret = process.env.SESSION_SECRET || "fetch-it-dev-secret-please-rotate";
  return `fetchit_session=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}
async function request(route, token, expected = 200, method = "POST", body) {
  const res = await fetch(`http://localhost:${port}${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { cookie: token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  assert.equal(res.status, expected, `${method} ${route}: ${res.status} ${JSON.stringify(data).slice(0, 250)}`);
  return data;
}
async function main() {
  let ownsSchema = false;
  try {
    assert.equal((await db.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname = ${schema}`).length, 0);
    ownsSchema = true;
    const migration = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, windowsHide: true, encoding: "utf8", timeout: 90000 });
    assert.equal(migration.status, 0, "Isolated migrations must succeed.");
    assert((await db.$queryRaw`SHOW search_path`)[0].search_path.includes(schema));
    const functions = await db.$queryRaw`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${schema}`;
    for (const fn of functions) {
      assert(/^fetch_[a-z_]+$/.test(fn.name));
      await db.$executeRawUnsafe(`ALTER FUNCTION "${schema}"."${fn.name}"() SET search_path TO "${schema}", pg_catalog`);
    }
    server = startServer();
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      assert.equal(server.exitCode, null, "Booking server must stay running.");
      try { await fetch(`http://localhost:${port}/api`, { signal: AbortSignal.timeout(1000) }); ready = true; break; } catch { /* Starting. */ }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert(ready, "Booking server must become ready.");
    const email = "customer@booking-test.invalid";
    const salt = crypto.randomBytes(16).toString("hex");
    const customer = await db.user.create({ data: { name: "Booking test customer", email, role: "CUSTOMER",
      authIdentities: { create: { provider: "PASSWORD", providerUserId: email, passwordHash: `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}` } } } });
    const token = cookie(customer);
    const route = { pickup: { lat: 14.6, lng: 120.98, label: "Test pickup" }, dropoff: { lat: 14.62, lng: 121.01, label: "Test destination" } };
    const capacities = { MOTORCYCLE: 1, TRICYCLE: 2, SEDAN: 4 };
    for (const type of ["RIDE", "DELIVERY"]) {
      for (const vehicleClass of Object.keys(capacities)) {
        const payload = { ...route, type, vehicleClass, ...(type === "RIDE" ? { passengers: capacities[vehicleClass] } : { cargoWeightKg: 2, cargoNotes: "Keep upright" }) };
        const quote = await request("/api/fare/estimate", token, 200, "POST", payload);
        const { booking } = await request("/api/bookings", token, 200, "POST", payload);
        assert.equal(booking.type, type); assert.equal(booking.vehicleClass, vehicleClass);
        assert.equal(booking.totalFare, quote.fare.totalFare);
        assert.equal(booking.passengers, type === "RIDE" ? capacities[vehicleClass] : 1);
        assert.equal(booking.cargoWeightKg, type === "RIDE" ? 0 : 2);
        assert.equal(booking.cargoNotes, type === "RIDE" ? null : "Keep upright");
        if (type === "RIDE") {
          for (const passengers of [0, 1.5, capacities[vehicleClass] + 1]) {
            await request("/api/fare/estimate", token, 400, "POST", { ...payload, passengers });
            await request("/api/bookings", token, 400, "POST", { ...payload, passengers });
          }
        }
      }
      for (const vehicleClass of ["CLOSED_VAN", "FLATBED", "REFRIGERATED", "__proto__", "UNKNOWN"]) {
        const payload = { ...route, type, vehicleClass, passengers: 1, cargoWeightKg: 2 };
        assert.match((await request("/api/fare/estimate", token, 400, "POST", payload)).error, /Motor, Tricycle or Car/);
        assert.match((await request("/api/bookings", token, 400, "POST", payload)).error, /Motor, Tricycle or Car/);
      }
      const list = await request(`/api/bookings?filter=active&type=${type}`, token, 200, "GET");
      assert.equal(list.bookings.length, 3); assert(list.bookings.every(b => b.type === type));
    }
    for (const cargoWeightKg of [0, -1, 21]) {
      const payload = { ...route, type: "DELIVERY", vehicleClass: "MOTORCYCLE", cargoWeightKg };
      await request("/api/fare/estimate", token, 400, "POST", payload);
      await request("/api/bookings", token, 400, "POST", payload);
    }
    const invalidType = { ...route, type: "INVALID", vehicleClass: "MOTORCYCLE", cargoWeightKg: 2 };
    await request("/api/fare/estimate", token, 400, "POST", invalidType);
    await request("/api/bookings", token, 400, "POST", invalidType);
    // Existing deliveries in retired classes still appear in history.
    await db.booking.create({ data: { customerId: customer.id, refCode: "OLD-VAN-TEST", type: "DELIVERY", status: "DELIVERED", pickupLabel: "Historical pickup", pickupLat: 14.6, pickupLng: 120.98, dropoffLabel: "Historical destination", dropoffLat: 14.62, dropoffLng: 121.01, vehicleClass: "CLOSED_VAN", cargoWeightKg: 100, distanceKm: 5, baseFare: 600, totalFare: 650 } });
    const history = await request("/api/bookings?filter=history&type=DELIVERY", token, 200, "GET");
    assert(history.bookings.some(b => b.vehicleClass === "CLOSED_VAN"));
    console.log("PASS: ride/delivery booking creation and quotes for all three vehicles, passenger/cargo validation, retired vehicle rejection, separate service lists, and historical booking compatibility.");
    if (process.env.BOOKING_PREVIEW === "1") {
      console.log(`Isolated preview: http://localhost:${port}. Older account login: ${email}, password: ${password}. Commands: offline stops the server, online restarts it, done cleans up.`);
      await new Promise(resolve => {
        const finish = () => {
          clearTimeout(timer); process.stdin.removeListener("data", onData); process.stdin.removeListener("end", finish); process.stdin.pause(); resolve();
        };
        const onData = input => {
          const command = input.toString().trim();
          if (command === "offline") { server.kill(); console.log("Preview server stopped. Reopen the app to verify cached offline access."); }
          else if (command === "online") { server = startServer(); console.log("Preview server restarted."); }
          else finish();
        };
        const timer = setTimeout(finish, 20 * 60 * 1000);
        process.stdin.on("data", onData);
        process.stdin.once("end", finish);
      });
    }
  } finally {
    if (server) server.kill();
    if (ownsSchema) {
      assert(/^fetch_booking_test_[a-f0-9]{32}$/.test(schema));
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
