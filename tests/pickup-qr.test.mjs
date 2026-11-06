import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import sharp from "sharp";
import { encodePickupQr, readPickupQr } from "../src/lib/pickup-qr.ts";

// Set FETCH_RIDER_ROOT when running from an isolated customer worktree.
const riderRoot = resolve(process.env.FETCH_RIDER_ROOT || "../fetch-rider");
const hasRider = existsSync(resolve(riderRoot, "node_modules/jsqr"));
const now = Date.now();
const expiry = new Date(now + 60_000).toISOString();

test("the real customer SVG decodes in the rider scanner, preserving leading zeroes", { skip: !hasRider }, async () => {
  const jsQR = createRequire(resolve(riderRoot, "package.json"))("jsqr");
  const value = encodePickupQr("booking-one", "001234", expiry);
  const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value, size: 224, marginSize: 4, level: "M" }));
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const scanned = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: "dontInvert" });
  assert(scanned, "The displayed QR must actually be readable");
  assert.deepEqual(readPickupQr(scanned.data, "booking-one", now), { code: "001234" });
  assert.match(readPickupQr(scanned.data, "different-booking", now).error, /different booking/);
  assert.match(readPickupQr(scanned.data, "booking-one", Date.parse(expiry)).error, /expired/);
});

test("unrelated links, raw codes and malformed or oversized payloads never fill the OTP", () => {
  const bad = ["123456", "https://example.test/?otp=123456", "fetchit:pickup:v1:{", "x".repeat(1025),
    ...[null, {}, { bookingId: "booking-one", otp: 123456, expiresAt: now + 100 },
      { bookingId: "booking-one", otp: "12345", expiresAt: now + 100 },
      { bookingId: "booking-one", otp: "001234", expiresAt: "tomorrow" }].map(x => "fetchit:pickup:v1:" + JSON.stringify(x))];
  for (const raw of bad) assert("error" in readPickupQr(raw, "booking-one", now), raw);
});

test("pickup payloads preserve leading zeroes and reject expired and wrong-booking codes", () => {
  const value = encodePickupQr("booking-one", "001234", expiry);
  assert.deepEqual(readPickupQr(value, "booking-one", now), { code: "001234" });
  assert.match(readPickupQr(value, "booking-two", now).error, /different booking/);
  assert.match(readPickupQr(value, "booking-one", Date.parse(expiry)).error, /expired/);
});

test("customer and rider use the same booking-bound QR format", { skip: !hasRider }, () => {
  assert.equal(readFileSync(new URL("../src/lib/pickup-qr.ts", import.meta.url), "utf8"),
    readFileSync(resolve(riderRoot, "src/lib/pickup-qr.ts"), "utf8"));
});
