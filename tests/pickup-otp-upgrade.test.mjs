import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import * as challenge from "../src/lib/delivery-challenge.ts";

test("refreshing an unexpired legacy code upgrades its verifier without changing digits, expiry or attempts", async () => {
  process.env.DELIVERY_CODE_SECRET = "local-legacy-customer-only";
  const id = "legacy-ride", now = new Date(), saved = challenge.createChallenge(id, now);
  const digits = challenge.readChallenge(id, saved.codeCiphertext);
  const key = crypto.createHash("sha256").update(`fetch-delivery-code:${process.env.DELIVERY_CODE_SECRET}`).digest();
  let record = { ...saved, bookingId: id, attempts: 2, codeHash: crypto.createHmac("sha256", key).update(`${id}:${digits}`).digest("hex") };
  const originalExpiry = record.expiresAt;
  const tx = { $queryRaw: async () => [], booking: { findFirst: async () => ({ type: "RIDE", status: "ACCEPTED", riderId: "rider" }) }, deliveryChallenge: {
    findUnique: async () => record,
    update: async ({ data }) => (record = { ...record, ...data }),
    upsert: async () => { throw Error("Must not replace an active code"); },
  } };
  const exports = {}, source = fs.readFileSync(new URL("../src/app/api/bookings/[id]/otp/route.ts", import.meta.url), "utf8");
  class CustomerError extends Error { constructor(message, status) { super(message); this.status = status; } }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, require(name) {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@/lib/db") return { db: { $transaction: async fn => fn(tx) } };
    if (name === "@/lib/delivery-challenge") return challenge;
    if (name === "@/lib/customer-access") return { CustomerError, requireCustomer: async () => ({ uid: "customer" }), customerErrorResponse: e => Response.json({ error: e.message }, { status: e.status }) };
    throw Error(name);
  } });
  const response = await exports.GET(new Request("https://fixture.invalid/otp"), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).otp, digits);
  assert.equal(record.expiresAt, originalExpiry);
  assert.equal(record.attempts, 2);
  const savedSecret = process.env.DELIVERY_CODE_SECRET;
  process.env.DELIVERY_CODE_SECRET = "local-rider-other-secret";
  try { assert(challenge.matchesChallenge(id, digits, record.codeHash)); }
  finally { process.env.DELIVERY_CODE_SECRET = savedSecret; }
});
