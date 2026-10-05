import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { initializeApp, deleteApp } from "firebase/app";
import {
  initializeAuth, inMemoryPersistence, connectAuthEmulator,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, updateProfile, signOut,
} from "firebase/auth";
import { startCustomerSignup } from "../src/lib/customer-signup.ts";

// Exercise the real Firebase SDK against a local REST fixture. No Firebase
// project, real user or email delivery is involved in this regression test.
test("Firebase SDK resumes an account created before verification delivery failed", async () => {
  const account = { localId: "fixture-customer", email: "fixture@example.invalid", emailVerified: false };
  const input = { email: account.email, password: "fixture-password", name: "Fixture Customer" };
  const requests = [];
  let created = false;
  let sendAttempts = 0;
  const token = [
    { alg: "none", typ: "JWT" },
    { sub: account.localId, user_id: account.localId, email: account.email, email_verified: false,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, auth_time: Math.floor(Date.now() / 1000) },
  ].map(part => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".fixture";
  const credentials = { ...account, idToken: token, refreshToken: "fixture-refresh", expiresIn: "3600" };
  const server = http.createServer(async (req, res) => {
    const operation = new URL(req.url, "http://localhost").pathname.split("/").at(-1);
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    requests.push(operation);
    let status = 200;
    let result;
    switch (operation) {
      case "accounts:signUp":
        if (created) { status = 400; result = { error: { message: "EMAIL_EXISTS" } }; }
        else { created = true; result = credentials; }
        break;
      case "accounts:signInWithPassword":
        if (body.password !== input.password) { status = 400; result = { error: { message: "INVALID_LOGIN_CREDENTIALS" } }; }
        else result = credentials;
        break;
      case "accounts:lookup": result = { users: [account] }; break;
      case "accounts:sendOobCode":
        assert.equal(body.requestType, "VERIFY_EMAIL");
        if (++sendAttempts === 1) { status = 400; result = { error: { message: "TOO_MANY_ATTEMPTS_TRY_LATER" } }; }
        else result = { email: account.email };
        break;
      case "accounts:update":
        account.displayName = body.displayName;
        result = { ...credentials, displayName: account.displayName };
        break;
      default: status = 500; result = { error: { message: "UNEXPECTED_FIXTURE_REQUEST" } };
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const app = initializeApp({ apiKey: "fixture-api-key", projectId: "demo-signup-regression" }, "signup-regression");
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, `http://127.0.0.1:${server.address().port}`, { disableWarnings: true });
  const operations = {
    create: async (email, password) => (await createUserWithEmailAndPassword(auth, email, password)).user,
    signIn: async (email, password) => (await signInWithEmailAndPassword(auth, email, password)).user,
    signOut: () => signOut(auth),
    sendVerification: sendEmailVerification,
    updateName: (user, displayName) => updateProfile(user, { displayName }),
  };
  try {
    const first = await startCustomerSignup(operations, input);
    assert.equal(first.verificationError.code, "auth/too-many-requests");
    assert.equal(auth.currentUser.uid, account.localId);
    await signOut(auth); // Reproduce leaving the app and retrying signup later.
    const retry = await startCustomerSignup(operations, input);
    assert.equal(retry.recovered, true);
    assert.equal(retry.verificationError, null);
    assert.equal(retry.user.uid, first.user.uid);
    assert.equal(retry.user.displayName, input.name);
    assert.equal(requests.filter(operation => operation === "accounts:signUp").length, 2);
    assert.equal(requests.filter(operation => operation === "accounts:signInWithPassword").length, 1);
    assert.equal(sendAttempts, 2);
  } finally {
    await signOut(auth);
    await deleteApp(app);
    await new Promise(resolve => server.close(resolve));
  }
});
