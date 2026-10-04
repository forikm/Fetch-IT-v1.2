import { test } from "node:test";
import assert from "node:assert/strict";
import { createChallenge, readChallenge, matchesChallenge, CHALLENGE_TTL_MS } from "../src/lib/delivery-challenge.ts";
process.env.DELIVERY_CODE_SECRET = "unit-test-only-secret";

test("delivery codes round-trip encrypted, expire after 15 minutes, and are bound to their booking", () => {
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
