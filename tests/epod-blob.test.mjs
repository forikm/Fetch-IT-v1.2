import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.resolve(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, Buffer, Response, Uint8Array, console: { info() {}, error() {} }, process,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), ...globals });
  return exports;
}
const helpers = load("src/lib/epod-photo.ts");
class RiderError extends Error { constructor(message, status) { super(message); this.status = status; } }
const withRequestLog = (_scope, handler) => async (...args) => {
  try { const response = await handler(...args); response.headers.set("Cache-Control", "private, no-store"); return response; }
  catch { return Response.json({ error: "Unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
};
const png = await sharp({ create: { width: 100, height: 60, channels: 3, background: "#ff6347" } }).png().toBuffer();
const photoDataUrl = `data:image/png;base64,${png.toString("base64")}`;
const proofId = "7f76f6c1-3bfd-44e1-81b2-c9cb5f74b846";

function uploader(put = async pathname => ({ pathname })) {
  return load("../fetch-rider/src/lib/epod-upload.ts", { "@vercel/blob": { put, del: async () => {} }, "./epod-photo": helpers, "./rider-access": { RiderError } });
}
test("upload stores actual JPEG bytes privately, bounded in size, with metadata removed", async () => {
  let uploaded;
  const service = uploader(async (pathname, data, options) => { uploaded = { pathname, data, options }; return { pathname }; });
  const reference = await service.uploadDeliveryPhoto("booking-a", proofId, photoDataUrl);
  assert.equal(reference, `epods/booking-a/${proofId}.jpg`);
  assert.equal(uploaded.options.access, "private");
  assert.equal(uploaded.options.allowOverwrite, false);
  assert(uploaded.data.length <= helpers.EPOD_MAX_PHOTO_BYTES);
  const metadata = await sharp(uploaded.data).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert(metadata.width <= 1200 && metadata.height <= 1200);
});
test("fake, oversized and unsupported images spend no Blob operations", async () => {
  let uploads = 0;
  const service = uploader(async () => { uploads++; });
  for (const image of ["data:image/png;base64,aGVsbG8=", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64," + "A".repeat(700_000)]) {
    await assert.rejects(service.uploadDeliveryPhoto("booking-a", proofId, image), error => error.status === 400);
  }
  assert.equal(uploads, 0);
});
test("Blob failure produces a retryable storage error", async () => {
  const service = uploader(async () => { throw Error("suspended"); });
  await assert.rejects(service.uploadDeliveryPhoto("booking-a", proofId, photoDataUrl), error => error.status === 503);
});

function submission(overrides = {}) {
  const calls = { uploads: 0, creates: [], deleted: [], statuses: [] };
  const booking = { riderId: "rider-a", type: "DELIVERY", status: "IN_TRANSIT", paymentMethod: "CASH", paymentStatus: "UNPAID", ...overrides.booking };
  const tx = {
    $queryRaw: async () => [], booking: { findUnique: async () => ({ ...booking, ...overrides.transactionBooking }), update: async ({ data }) => { calls.statuses.push(data.status); return { ...booking, ...data }; } },
    deliveryProof: { count: async () => overrides.photoCount ?? 0, create: async ({ data }) => { calls.creates.push(data); } },
    riderProfile: { update: async () => {} },
  };
  const db = {
    booking: { findUnique: async () => overrides.missing ? null : booking },
    deliveryProof: { count: async () => overrides.photoCount ?? 0, findUnique: async () => { if (overrides.unknownCommit) throw Error("DB unavailable"); return overrides.savedProof ? { id: proofId } : null; } },
    $transaction: async fn => { if (overrides.transactionError) throw Error("Transaction failed"); return fn(tx); },
  };
  const route = load("../fetch-rider/src/app/api/bookings/[id]/proof/route.ts", {
    "@/lib/request-guard": { withRequestLog, RateLimitError: class extends Error {}, limitRequests: async () => {} },
    "@/lib/db": { db }, "@/lib/session": { getSession: async () => ({ uid: "rider-a", role: "RIDER" }) },
    "@/lib/booking-events": { recordBookingEvent: async () => {} },
    "@/lib/rider-access": { requireRider: async session => session, RiderError, riderErrorResponse: error => Response.json({ error: error.message }, { status: error.status ?? 503 }) },
    "@/lib/demo-payments": { settleDemoEarnings: async () => {} }, "@/lib/payment-policy": { isDemoPayment: () => false }, "@/lib/epod-photo": helpers,
    "@/lib/epod-upload": { uploadDeliveryPhoto: async (bookingId, id) => { calls.uploads++; if (overrides.uploadError) throw new RiderError("Storage unavailable", 503); return `epods/${bookingId}/${id}.jpg`; }, removeUncommittedPhoto: async pathname => { calls.deleted.push(pathname); } },
  });
  return { calls, post: async (body = { photoDataUrl }, headers = {}) => {
    const req = new Request("https://rider.invalid/api/bookings/booking-a/proof", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
    req.nextUrl = new URL(req.url);
    return route.POST(req, { params: Promise.resolve({ id: "booking-a" }) });
  } };
}
test("photo-only submission saves a Blob path without completing the delivery", async () => {
  const app = submission();
  assert.equal((await app.post()).status, 200);
  assert.equal(app.calls.creates.length, 1);
  assert.match(app.calls.creates[0].photoUrl, /^epods\/booking-a\/[a-f0-9-]+\.jpg$/);
  assert(!app.calls.creates[0].photoUrl.startsWith("data:"));
  assert.equal(app.calls.statuses.length, 0);
});
test("signature and photo commit together; failed storage saves neither", async () => {
  const good = submission();
  assert.equal((await good.post({ photoDataUrl, signatureSvg: "<svg/>" })).status, 200);
  assert.equal(good.calls.creates.length, 2);
  assert.equal(good.calls.statuses[0], "DELIVERED");
  const failed = submission({ uploadError: true });
  assert.equal((await failed.post({ photoDataUrl, signatureSvg: "<svg/>" })).status, 503);
  assert.equal(failed.calls.creates.length, 0);
  assert.equal(failed.calls.statuses.length, 0);
});
test("unassigned, final and capped bookings reject before upload", async () => {
  for (const scenario of [{ booking: { riderId: "other" } }, { booking: { status: "CANCELLED" } }, { photoCount: 3 }, { missing: true }]) {
    const app = submission(scenario);
    assert((await app.post()).status >= 400);
    assert.equal(app.calls.uploads, 0);
  }
});
test("cancellation after upload rechecks under lock and removes the unused file", async () => {
  const app = submission({ transactionBooking: { status: "CANCELLED" } });
  assert.equal((await app.post()).status, 409);
  assert.equal(app.calls.deleted.length, 1);
  assert.equal(app.calls.creates.length, 0);
});
test("cleanup preserves a committed or uncertain proof after a transaction error", async () => {
  for (const scenario of [{ savedProof: true }, { unknownCommit: true }]) {
    const app = submission({ transactionError: true, ...scenario });
    assert.equal((await app.post()).status, 503);
    assert.equal(app.calls.deleted.length, 0);
  }
  const rolledBack = submission({ transactionError: true });
  assert.equal((await rolledBack.post()).status, 503);
  assert.equal(rolledBack.calls.deleted.length, 1);
});
test("oversized, invalid JSON and cross-site requests do not upload", async () => {
  const app = submission();
  assert.equal((await app.post("A".repeat(820_001))).status, 413);
  assert.equal((await app.post("{")).status, 400);
  assert.equal((await app.post({ photoDataUrl }, { origin: "https://other.invalid" })).status, 403);
  assert.equal(app.calls.uploads, 0);
});

test("customer and rider booking responses omit new and historical photo proofs", () => {
  for (const app of ["fetch-customer", "fetch-rider"]) {
    const dto = load(`../${app}/src/lib/db-data.ts`);
    const booking = dto.bookingView({ deliveryProofs: [{ id: "p", bookingId: "b", proofType: "PHOTO", photoUrl: "data:image/png;base64,aGVsbG8=" }, { id: "s", bookingId: "b", proofType: "SIGNATURE", photoUrl: null }] });
    assert.equal(booking.deliveryProofs.length, 1);
    assert.equal(booking.deliveryProofs[0].proofType, "SIGNATURE");
  }
});
test("customer and rider cannot request saved photos directly", async () => {
  for (const app of ["fetch-customer", "fetch-rider"]) {
    const route = load(`../${app}/src/app/api/bookings/[id]/proof/[proofId]/photo/route.ts`, { "@/lib/request-guard": { withRequestLog } });
    const response = await route.GET(new Request("https://app.invalid/photo"));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});
test("admin and superadmin viewing requires their current authorized session", async () => {
  for (const app of ["fetch-admin", "fetch-superadmin"]) {
    for (const authorized of [false, true]) {
      let reads = 0;
      const route = load(`../${app}/src/app/api/bookings/[id]/proof/[proofId]/photo/route.ts`, {
        "@/lib/request-guard": { withRequestLog }, "@/lib/admin-access": { currentAdmin: async () => authorized ? { id: "staff" } : null },
        "@/lib/epod-photo-response": { deliveryPhotoResponse: async () => { reads++; return new Response("jpeg"); } },
      });
      const res = await route.GET(new Request("https://staff.invalid/photo"), { params: Promise.resolve({ id: "b", proofId: "p" }) });
      assert.equal(res.status, authorized ? 200 : 403);
      assert.equal(reads, authorized ? 1 : 0);
    }
  }
});
test("private reads reject arbitrary URLs and paths belonging to a different booking", async () => {
  let reads = 0;
  let reference = `epods/booking-a/${proofId}.jpg`;
  let query;
  const service = load("src/lib/epod-photo-response.ts", {
    "@vercel/blob": { get: async (_path, options) => { reads++; assert.equal(options.access, "private"); return { statusCode: 200, stream: new Response("jpeg").body }; } },
    "./db": { db: { deliveryProof: { findFirst: async args => { query = args; return { photoUrl: reference }; } } } }, "./epod-photo": helpers,
  });
  const response = await service.deliveryPhotoResponse("booking-a", proofId, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(query.where.bookingId, "booking-a");
  assert.equal(query.where.id, proofId);
  for (const invalid of ["https://evil.invalid/photo", `epods/other/${proofId}.jpg`, `epods/booking-a/../${proofId}.jpg`]) {
    reference = invalid;
    assert.equal((await service.deliveryPhotoResponse("booking-a", proofId, {})).status, 404);
  }
  reference = photoDataUrl;
  const legacy = await service.deliveryPhotoResponse("booking-a", proofId, {});
  assert.equal(legacy.status, 200);
  assert.equal(legacy.headers.get("Content-Type"), "image/png");
  assert.equal(reads, 1);
});

test("photo selection compresses before transmission and releases decoded image resources", async () => {
  let closed = false;
  let attempts = 0;
  const canvas = { getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => {
    attempts++;
    return "data:image/jpeg;base64," + "A".repeat(attempts === 1 ? 500_000 : 1000);
  } };
  const client = load("../fetch-rider/src/lib/epod-photo-client.ts", { "./epod-photo": helpers }, {
    createImageBitmap: async () => ({ width: 4000, height: 3000, close() { closed = true; } }),
    document: { createElement: () => canvas },
  });
  const encoded = await client.prepareDeliveryPhoto({ type: "image/jpeg", size: 2_000_000 });
  assert(encoded.length < 700_000);
  assert.equal(attempts, 2);
  assert.equal(closed, true);
  assert.equal(canvas.width, 1200);
  assert.equal(canvas.height, 900);
  for (const file of [{ type: "image/svg+xml", size: 100 }, { type: "image/jpeg", size: 13 * 1024 * 1024 }]) {
    await assert.rejects(client.prepareDeliveryPhoto(file));
  }
});

test("real staff permission/session checks deny unrelated roles, bans, expiry and revocation", async () => {
  // The Blob release also supports the existing Admin-only portal while the
  // separate staff-portal changes remain under development.
  if (!fs.existsSync(path.resolve(root, "../fetch-admin/src/lib/staff-access.ts"))) {
    for (const scenario of [{ role: "ADMIN", allowed: true }, { role: "CUSTOMER" }, { role: "RIDER" }, { role: "ADMIN", isBanned: true }, { role: "ADMIN", authInvalidBefore: new Date(Date.now() + 1000) }]) {
      const admin = load("../fetch-admin/src/lib/admin-access.ts", {
        "./db": { db: { user: { findUnique: async () => ({ id: "staff", ...scenario }) } } },
        "./session": { getAdminSession: async () => ({ uid: "staff", iat: Date.now() }) },
        "next/navigation": { redirect() {} },
      });
      assert.equal(Boolean(await admin.currentAdmin()), scenario.allowed ?? false);
    }
    return;
  }
  const policy = load("src/lib/staff-policy.ts");
  for (const scenario of [{ role: "ADMIN", allowed: true }, { role: "SUPPORT" }, { role: "FINANCE" }, { role: "SAFETY" }, { role: "ADMIN", isBanned: true }, { role: "ADMIN", revokedAt: new Date() }, { role: "ADMIN", expiresAt: new Date(0) }, { role: "ADMIN", authInvalidBefore: new Date(Date.now() + 1000) }]) {
    const user = { id: "staff", role: scenario.role, isBanned: scenario.isBanned ?? false, authInvalidBefore: scenario.authInvalidBefore ?? null };
    const access = load("../fetch-admin/src/lib/staff-access.ts", {
      "./db": { db: { user: { findUnique: async () => user }, staffSession: { findUnique: async () => ({ userId: user.id, expiresAt: scenario.expiresAt ?? new Date(Date.now() + 60000), revokedAt: scenario.revokedAt ?? null }) } } },
      "./session": { getAdminSession: async () => ({ uid: user.id, sid: "session", iat: Date.now() }) },
      "./staff-policy": policy, "next/navigation": { redirect() {} }, "./runtime-access": { assertRuntimeAccess: async () => {} },
    });
    const admin = load("../fetch-admin/src/lib/admin-access.ts", { "./staff-access": access });
    assert.equal(Boolean(await admin.currentAdmin()), scenario.allowed ?? false);
  }
});
