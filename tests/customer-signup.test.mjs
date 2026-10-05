import { test } from "node:test";
import assert from "node:assert/strict";
import { startCustomerSignup, customerAuthMessage } from "../src/lib/customer-signup.ts";

const input = { email: " new@example.invalid ", password: "test-password", name: " New Customer " };
const failure = code => Object.assign(new Error(code), { code });
function fixture(overrides = {}, userOverrides = {}) {
  const user = { uid: "new-user", emailVerified: false, displayName: null, ...userOverrides };
  const calls = [];
  const operations = {
    create: async (...args) => { calls.push(["create", ...args]); return user; },
    signIn: async (...args) => { calls.push(["signIn", ...args]); return user; },
    signOut: async () => { calls.push(["signOut"]); },
    sendVerification: async target => { calls.push(["send", target.uid]); },
    updateName: async (target, name) => { calls.push(["name", target.uid, name]); target.displayName = name; },
    ...overrides,
  };
  return { user, calls, operations };
}

test("a new account receives verification and its name without signing in again", async () => {
  const { operations, calls, user } = fixture();
  const result = await startCustomerSignup(operations, input);
  assert.equal(result.user, user);
  assert.equal(result.recovered, false);
  assert.equal(result.verificationError, null);
  assert.equal(result.profileError, null);
  assert.deepEqual(calls, [["create", "new@example.invalid", input.password], ["send", user.uid], ["name", user.uid, "New Customer"]]);
});

test("failed verification preserves the created account and reports the actual delivery failure", async () => {
  const networkError = failure("auth/network-request-failed");
  const { operations, user } = fixture({ sendVerification: async () => { throw networkError; } });
  const result = await startCustomerSignup(operations, input);
  assert.equal(result.user, user);
  assert.equal(result.verificationError, networkError);
  assert.equal(user.displayName, "New Customer");
  assert.match(customerAuthMessage(result.verificationError), /connect to Firebase/);
  assert.doesNotMatch(customerAuthMessage(result.verificationError), /account|registered/);
});

test("a profile failure does not prevent verification delivery", async () => {
  const profileError = failure("auth/network-request-failed");
  const { operations, calls } = fixture({ updateName: async () => { throw profileError; } });
  const result = await startCustomerSignup(operations, input);
  assert.equal(result.verificationError, null);
  assert.equal(result.profileError, profileError);
  assert.equal(calls.filter(([call]) => call === "send").length, 1);
});

test("retrying a stranded signup authenticates its password and resends verification", async () => {
  const { operations, calls, user } = fixture({ create: async () => { throw failure("auth/email-already-in-use"); } });
  const result = await startCustomerSignup(operations, input);
  assert.equal(result.user, user);
  assert.equal(result.recovered, true);
  assert.deepEqual(calls, [["signIn", "new@example.invalid", input.password], ["send", user.uid], ["name", user.uid, "New Customer"]]);
});

test("an existing unverified account keeps its saved name", async () => {
  const { operations, calls } = fixture({ create: async () => { throw failure("auth/email-already-in-use"); } }, { displayName: "Original Name" });
  await startCustomerSignup(operations, input);
  assert.equal(calls.some(([call]) => call === "name"), false);
});

for (const code of ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"]) {
  test(`a duplicate with ${code} never sends verification or changes the profile`, async () => {
    const duplicate = failure("auth/email-already-in-use");
    const { operations, calls } = fixture({ create: async () => { throw duplicate; }, signIn: async () => { throw failure(code); } });
    await assert.rejects(startCustomerSignup(operations, input), error => error === duplicate);
    assert.deepEqual(calls, []);
  });
}

test("a verified account is not resumed or changed by signup", async () => {
  const duplicate = failure("auth/email-already-in-use");
  const { operations, calls } = fixture({ create: async () => { throw duplicate; } }, { emailVerified: true });
  await assert.rejects(startCustomerSignup(operations, input), error => error === duplicate);
  assert.deepEqual(calls, [["signIn", "new@example.invalid", input.password], ["signOut"]]);
});

test("network failure during creation is not treated as a duplicate or retried as sign-in", async () => {
  const networkError = failure("auth/network-request-failed");
  const { operations, calls } = fixture({ create: async () => { throw networkError; } });
  await assert.rejects(startCustomerSignup(operations, input), error => error === networkError);
  assert.deepEqual(calls, []);
});

test("network failure during recovery is reported as connectivity failure", async () => {
  const networkError = failure("auth/network-request-failed");
  const { operations, calls } = fixture({ create: async () => { throw failure("auth/email-already-in-use"); }, signIn: async () => { throw networkError; } });
  await assert.rejects(startCustomerSignup(operations, input), error => error === networkError);
  assert.deepEqual(calls, []);
});

test("verification quota failure can be retried without another account being created", async () => {
  const { operations, user } = fixture();
  let created = false;
  let deliveries = 0;
  operations.create = async () => {
    if (created) throw failure("auth/email-already-in-use");
    created = true;
    return user;
  };
  operations.sendVerification = async () => {
    if (++deliveries === 1) throw failure("auth/too-many-requests");
  };
  const first = await startCustomerSignup(operations, input);
  assert.match(customerAuthMessage(first.verificationError), /wait/);
  const retry = await startCustomerSignup(operations, input);
  assert.equal(retry.recovered, true);
  assert.equal(retry.verificationError, null);
  assert.equal(deliveries, 2);
});

test("disabled signup and configuration errors are distinct from account collisions", () => {
  assert.match(customerAuthMessage(failure("auth/operation-not-allowed")), /signup is unavailable/);
  assert.match(customerAuthMessage(failure("auth/invalid-api-key")), /not configured/);
  assert.match(customerAuthMessage(failure("auth/invalid-email")), /valid email/);
});
