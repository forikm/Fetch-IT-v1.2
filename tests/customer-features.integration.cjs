// Manual integration check against local servers and the configured shared DB.
// Creates only disposable completed bookings, then removes its own fixtures.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { parseEnv } = require("node:util");
const { PrismaClient } = require("@prisma/client");
if (process.env.RUN_CUSTOMER_INTEGRATION !== "1") throw new Error("Set RUN_CUSTOMER_INTEGRATION=1 to run this check.");
process.loadEnvFile(".env");
const adminEnv = parseEnv(fs.readFileSync("../fetch-admin/.env", "utf8"));
const db = new PrismaClient();
const marker = "feature-check-" + crypto.randomUUID();
const users = [];
const bookings = [];
function cookie(user, admin = false) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, email: user.email, name: user.name, role: user.role, exp: Date.now() + 600000 })).toString("base64url");
  const secret = admin ? adminEnv.ADMIN_SESSION_SECRET || "fetch-it-admin-dev-secret-please-rotate" : process.env.SESSION_SECRET || "fetch-it-dev-secret-please-rotate";
  return `${admin ? "fetchit_admin_session" : "fetchit_session"}=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}
async function request(path, token, expected = 200, method = "GET", data, admin = false) {
  const response = await fetch(`http://localhost:${admin ? process.env.ADMIN_TEST_PORT || 3002 : process.env.CUSTOMER_TEST_PORT || 3000}${path}`, { method, headers: { ...(token ? { cookie: token } : {}), "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}
async function user(role) {
  const saved = await db.user.create({ data: { name: "Disposable feature check", email: `${marker}-${role.toLowerCase()}-${users.length}@example.invalid`, role, ...(role === "RIDER" ? { riderProfile: { create: { vehicleClass: "MOTORCYCLE" } }, riderPresence: { create: {} } } : {}) } });
  users.push(saved.id); return saved;
}
async function booking(customer, rider, number) {
  const saved = await db.booking.create({ data: { refCode: `${marker}-${number}`, customerId: customer.id, riderId: rider.id, type: number === 2 ? "RIDE" : "DELIVERY", status: "DELIVERED", pickupLabel: "Feature check pickup", pickupLat: 14.6, pickupLng: 120.9, dropoffLabel: "Feature check destination", dropoffLat: 14.7, dropoffLng: 121, vehicleClass: "MOTORCYCLE", distanceKm: 10, baseFare: 60, surgeMultiplier: 1, totalFare: 160, deliveredAt: new Date() } });
  bookings.push(saved.id); return saved;
}
(async () => {
  try {
    const customer = await user("CUSTOMER"); const other = await user("CUSTOMER"); const rider = await user("RIDER"); const admin = await user("ADMIN");
    const first = await booking(customer, rider, 1); const second = await booking(customer, rider, 2); const third = await booking(customer, rider, 3);
    const token = cookie(customer);
    await request("/api/support", null, 401);
    await request("/api/support", cookie(rider), 403);
    await request(`/api/bookings/${first.id}/review`, cookie(other), 404);
    await request(`/api/bookings/${first.id}/review`, token, 400, "POST", { rating: 6 });
    await request(`/api/bookings/${first.id}/review`, token, 201, "POST", { rating: 4, comment: "Disposable feature check" });
    await request(`/api/bookings/${first.id}/review`, token, 409, "POST", { rating: 5 });
    await Promise.all([request(`/api/bookings/${second.id}/review`, token, 201, "POST", { rating: 1 }), request(`/api/bookings/${third.id}/review`, token, 201, "POST", { rating: 5 })]);
    assert(Math.abs((await db.riderProfile.findUnique({ where: { userId: rider.id } })).rating - 10 / 3) < 1e-10);
    const profile = await request("/api/auth/me", token, 200, "PATCH", { name: "Updated check customer", phone: "+639171234567", role: "ADMIN" });
    assert.equal(profile.user.role, "CUSTOMER"); assert.equal(profile.user.name, "Updated check customer");
    await request("/api/auth/me", token, 400, "PATCH", { name: "X", phone: "bad" });
    const history = await request(`/api/bookings?filter=history&type=DELIVERY&q=${marker}&status=DELIVERED`, token);
    assert.equal(history.bookings.length, 2); assert(history.bookings.every((item) => !item.ticketId));
    assert.equal((await request("/api/bookings?filter=history&q=missing-ref", token)).bookings.length, 0);
    const additional = Array.from({ length: 103 }, (_, index) => ({ id: crypto.randomUUID(), refCode: marker + "-page-" + index, customerId: customer.id, riderId: rider.id, type: "DELIVERY", status: "DELIVERED", pickupLabel: "Feature check pickup", pickupLat: 14.6, pickupLng: 120.9, dropoffLabel: "Feature check destination", dropoffLat: 14.7, dropoffLng: 121, vehicleClass: "MOTORCYCLE", distanceKm: 10, baseFare: 60, surgeMultiplier: 1, totalFare: 160 }));
    await db.booking.createMany({ data: additional }); bookings.push(...additional.map((item) => item.id));
    const page = await request("/api/bookings?filter=history&q=" + marker, token); assert.equal(page.bookings.length, 100); assert(page.nextCursor);
    const older = await request("/api/bookings?filter=history&q=" + marker + "&cursor=" + page.nextCursor, token); assert.equal(older.bookings.length, 6); assert.equal(new Set([...page.bookings, ...older.bookings].map((item) => item.id)).size, 106);
    assert.equal((await request("/api/bookings?filter=history&from=2099-01-01T00%3A00%3A00Z", token)).bookings.length, 0);
    await request("/api/bookings?filter=history&from=invalid", token, 400);
    await request("/api/auth/me", token, 400, "PATCH", { name: "Check customer", phone: "-------" });
    const receipt = await request(`/api/bookings/${first.id}/receipt`, token); assert(receipt.includes("not proof of payment"));
    await request(`/api/bookings/${first.id}/receipt`, cookie(other), 404);
    await request("/api/support", token, 400, "POST", { bookingId: first.id, category: "INVALID", message: "Check request" });
    await request("/api/support", cookie(other), 404, "POST", { bookingId: first.id, category: "BOOKING", message: "Check request" });
    const sent = await request("/api/support", token, 201, "POST", { bookingId: first.id, category: "BOOKING", message: "Disposable support check" });
    const duplicate = await request("/api/support", token, 409, "POST", { bookingId: first.id, category: "BOOKING", message: "Disposable support check" }); assert(duplicate.error.includes("open request"));
    assert.equal((await request("/api/support", cookie(other))).tickets.length, 0);
    await request(`/api/support/${sent.ticket.id}`, cookie(admin, true), 200, "PATCH", { status: "RESOLVED", reply: "Disposable reply check" }, true);
    const replies = await request(`/api/support?bookingId=${first.id}`, token); assert.equal(replies.tickets[0].adminReply, "Disposable reply check");
    console.log("PASS: customer ownership, role checks, reviews, concurrent averages, profile validation, filtered/paginated history, receipts, help requests, and admin replies.");
  } finally {
    if (bookings.length) { await db.supportTicket.deleteMany({ where: { bookingId: { in: bookings } } }); await db.customerReview.deleteMany({ where: { bookingId: { in: bookings } } }); await db.booking.deleteMany({ where: { id: { in: bookings } } }); }
    if (users.length) await db.adminAudit.deleteMany({ where: { actorId: { in: users } } });
    if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
