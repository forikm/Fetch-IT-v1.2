import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeHash, createChallenge, isPortableChallenge, readChallenge, matchesChallenge, CHALLENGE_TTL_MS } from "../src/lib/delivery-challenge.ts";
import { createHash, createHmac } from "node:crypto";
process.env.DELIVERY_CODE_SECRET = "unit-test-only-secret";

test("ride pickup codes round-trip encrypted, expire after 15 minutes, and are bound to their booking", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  const challenge = createChallenge("booking-a", now);
  const code = readChallenge("booking-a", challenge.codeCiphertext);
  assert.match(code, /^\d{6}$/);
  assert.equal(challenge.expiresAt.getTime() - now.getTime(), CHALLENGE_TTL_MS);
  assert.equal(challenge.maxAttempts, 5);
  assert(matchesChallenge("booking-a", code, challenge.codeHash));
  assert(!matchesChallenge("booking-b", code, challenge.codeHash));
  assert(!matchesChallenge("booking-a", code === "000000" ? "000001" : "000000", challenge.codeHash));
  assert.throws(() => readChallenge("booking-b", challenge.codeCiphertext));
});

test("Rider verifies Customer codes even when the apps have different session secrets", () => {
  const old = process.env.DELIVERY_CODE_SECRET;
  try {
    process.env.DELIVERY_CODE_SECRET = "customer-secret-only";
    const challenge = createChallenge("shared-booking");
    const code = readChallenge("shared-booking", challenge.codeCiphertext);
    assert(isPortableChallenge(challenge.codeHash));
    process.env.DELIVERY_CODE_SECRET = "different-rider-secret";
    assert(matchesChallenge("shared-booking", code, challenge.codeHash));
    assert(!matchesChallenge("another-booking", code, challenge.codeHash));
    assert(!matchesChallenge("shared-booking", "12345", challenge.codeHash));
  } finally { process.env.DELIVERY_CODE_SECRET = old; }
});

test("legacy verifiers remain readable and the same displayed digits can be upgraded", () => {
  const code = "001234", id = "legacy-booking";
  const key = createHash("sha256").update(`fetch-delivery-code:${process.env.DELIVERY_CODE_SECRET}`).digest();
  const legacy = createHmac("sha256", key).update(`${id}:${code}`).digest("hex");
  assert(matchesChallenge(id, code, legacy));
  const upgraded = challengeHash(id, code);
  assert(matchesChallenge(id, code, upgraded));
  assert.notEqual(upgraded, challengeHash(id, code), "Every verifier must have a fresh salt");
  for (const corrupt of ["", "scrypt-v2:bad:bad", "not-a-hash"]) assert.equal(matchesChallenge(id, code, corrupt), false);
});

test("tampered ciphertext and a changed secret cannot decrypt existing codes", () => {
  const challenge = createChallenge("booking-a");
  const bytes = Buffer.from(challenge.codeCiphertext, "base64url");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => readChallenge("booking-a", bytes.toString("base64url")));
  const secret = process.env.DELIVERY_CODE_SECRET;
  try {
    process.env.DELIVERY_CODE_SECRET = "a-different-test-secret";
    assert.throws(() => readChallenge("booking-a", challenge.codeCiphertext));
  } finally { process.env.DELIVERY_CODE_SECRET = secret; }
});
