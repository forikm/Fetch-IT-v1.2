import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

function load(file, env = {}, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, Buffer, Date, process: { env },
    require(name) { if (name === "crypto" || name === "node:crypto") return crypto; if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected dependency ${name}`); } });
  return exports;
}

test("production refuses missing, short and known development session secrets", () => {
  for (const SESSION_SECRET of [undefined, "short", "fetch-it-dev-secret-please-rotate", "change-me-to-a-long-random-string-placeholder"]) {
    const module = load("../src/lib/session-secret.ts", { NODE_ENV: "production", SESSION_SECRET });
    assert.throws(() => module.sessionSecret(), /must be configured/);
  }
  const secret = crypto.randomBytes(32).toString("hex");
  assert.equal(load("../src/lib/session-secret.ts", { NODE_ENV: "production", SESSION_SECRET: secret }).sessionSecret(), secret);
});

test("customer, rider and admin sessions reject forged, malformed and expired cookies", () => {
  const secret = crypto.randomBytes(32).toString("hex");
  const env = { NODE_ENV: "production", SESSION_SECRET: secret, ADMIN_SESSION_SECRET: secret };
  const dependencies = { "next/headers": {}, "./session-secret": load("../src/lib/session-secret.ts", env) };
  const signed = data => {
    const value = Buffer.from(JSON.stringify(data)).toString("base64url");
    return value + "." + crypto.createHmac("sha256", secret).update(value).digest("base64url");
  };
  for (const [file, method] of [["../src/lib/session.ts", "verifySessionToken"], ["../../fetch-rider/src/lib/session.ts", "verifySessionToken"], ["../../fetch-admin/src/lib/session.ts", "verifyAdminSessionToken"]]) {
    const verify = load(file, env, { ...dependencies, "./db": { db: {} } })[method];
    const payload = { uid: "account-id", email: "private@example.invalid", name: "Private Name", role: "CUSTOMER", exp: Date.now() + 60000 };
    assert(verify(signed(payload)));
    for (const token of [signed(payload) + ".extra", signed(payload).slice(0, -2), "invalid", signed({ ...payload, exp: 0 }), signed({ ...payload, exp: undefined }), signed({ ...payload, uid: null })]) assert.equal(verify(token), null);
    if (method === "verifySessionToken") assert.equal(verify(signed({ ...payload, role: "STAFF" })), null);
  }
});

test("new password policy keeps existing login passwords separate from signup", () => {
  const policy = load("../src/lib/password-policy.ts");
  assert.equal(policy.validNewPassword("1234"), false);
  assert.equal(policy.validNewPassword("a".repeat(5)), false);
  assert.equal(policy.validNewPassword("a".repeat(6)), true);
  assert.equal(policy.validNewPassword("a".repeat(128)), true);
  assert.equal(policy.validNewPassword("a good long passphrase"), true);
  assert.equal(policy.validNewPassword("a".repeat(129)), false);
});

test("pending and matched rider jobs remove private fields even inside encoded tickets", () => {
  const { riderJobView } = load("../../fetch-rider/src/lib/job-privacy.ts");
  const privateJob = { status: "PENDING", customerId: "private-id", customer: { id: "private-id", name: "private-name", phone: "private-phone", email: "private-email" }, ticketId: "private-ticket", ticket: "encoded-private-data", cargoNotes: "private-notes", pickupLabel: "Route pickup", totalFare: 50 };
  for (const status of ["PENDING", "MATCHED"]) {
    const result = JSON.stringify(riderJobView({ ...privateJob, status }));
    for (const field of ["private-id", "private-name", "private-phone", "private-email", "private-ticket", "encoded-private-data", "private-notes"]) assert(!result.includes(field));
    assert(result.includes("Route pickup"));
  }
  const accepted = { ...privateJob, status: "ACCEPTED" };
  assert.equal(riderJobView(accepted), accepted);
});
