import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { getCustomerAdminAuth } from "./firebase-admin";
import { consumeEmailCode, EMAIL_CODE_TTL_MS, issueEmailCode, type EmailCodeTarget } from "./auth-email-code";
import { requireEmailCodeSender, sendAuthEmailCode } from "./auth-email-sender";
import { clientAddress, limitRequests } from "./request-guard";
import { validNewPassword, PASSWORD_REQUIREMENT } from "./password-policy";
import { hashPassword } from "./password";

const genericSend = "If this email can be used for this request, a code has been sent. Check your inbox and spam folder.";
const invalidCode = "The code is incorrect, expired or already used. Request a new code if needed.";
function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return (!origin || origin === req.nextUrl.origin) && req.headers.get("sec-fetch-site") !== "cross-site";
}
async function verificationTarget(idToken: unknown): Promise<EmailCodeTarget | null> {
  if (typeof idToken !== "string" || !idToken || idToken.length > 10000) return null;
  const auth = getCustomerAdminAuth();
  let token;
  try { token = await auth.verifyIdToken(idToken, true); } catch { return null; }
  const user = await auth.getUser(token.uid);
  if (user.disabled || !user.email || !user.providerData.some(p => p.providerId === "password")) return null;
  const email = user.email.toLowerCase();
  if (token.email?.toLowerCase() !== email) return null;
  const existing = await db.user.findUnique({ where: { email }, include: { authIdentities: true } });
  if (existing && (existing.role !== "CUSTOMER" || existing.isBanned || !existing.authIdentities.some(i => i.provider === "FIREBASE" && i.providerUserId === user.uid))) return null;
  return { email, subjectId: user.uid, provider: "FIREBASE" };
}
async function resetTarget(email: string): Promise<EmailCodeTarget | null> {
  const local = await db.user.findUnique({ where: { email }, include: { authIdentities: true } });
  if (local && (local.role !== "CUSTOMER" || local.isBanned)) return null;
  const identity = local?.authIdentities.find(i => i.provider === "FIREBASE");
  if (!identity && local?.authIdentities.some(i => i.provider === "PASSWORD" && i.passwordHash)) return { email, subjectId: local.id, provider: "PASSWORD" };
  const auth = getCustomerAdminAuth();
  let user;
  try { user = identity ? await auth.getUser(identity.providerUserId) : await auth.getUserByEmail(email); }
  catch (err) { if ((err as { code?: string }).code === "auth/user-not-found") return null; throw err; }
  if (user.disabled || user.email?.toLowerCase() !== email || !user.providerData.some(p => p.providerId === "password")) return null;
  return { email, subjectId: user.uid, provider: "FIREBASE" };
}

export async function handleEmailCode(req: NextRequest, action: "send-verification" | "verify-email" | "send-reset" | "reset-password") {
  if (!sameOrigin(req)) return NextResponse.json({ error: "This request is not allowed." }, { status: 403 });
  try { requireEmailCodeSender(); }
  catch { return NextResponse.json({ error: "Email codes are not configured yet. Please contact support." }, { status: 503 }); }
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const verification = action === "send-verification" || action === "verify-email";
  const sending = action === "send-verification" || action === "send-reset";
  const purpose = verification ? "VERIFY_EMAIL" : "RESET_PASSWORD";
  await limitRequests(`email-code:${sending ? "send" : "check"}-ip`, clientAddress(req), sending ? 30 : 120, 60 * 60_000);
  let target: EmailCodeTarget | null = null;
  if (verification) {
    target = await verificationTarget(body.idToken);
    if (!target) return NextResponse.json({ error: "Sign in again to verify your email." }, { status: 401 });
  }
  if (sending) {
    const email = verification ? target!.email : typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    await limitRequests(`email-code:${purpose}:cooldown`, email, 1, 60_000);
    await limitRequests(`email-code:${purpose}:account`, email, 6, 60 * 60_000);
    await limitRequests("email-code:daily-sends", "gmail", 200, 24 * 60 * 60_000);
    if (!verification) target = await resetTarget(email);
    let result = { id: randomUUID(), expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS) };
    if (target) {
      // Both purposes share a conservative fixed-window budget. Two adjacent
      // windows can burst to 400, leaving room below Gmail's nominal daily cap.
      const challenge = await issueEmailCode(purpose, target);
      result = challenge;
      try { await sendAuthEmailCode(email, purpose, challenge.code); }
      catch {
        await db.authEmailCode.deleteMany({ where: { id: challenge.id } });
        // A reset request must not disclose whether the email has an account.
        if (verification) return NextResponse.json({ error: "Could not send the email. Wait a minute and request a new code." }, { status: 503 });
        console.info(JSON.stringify({ operation: "customer:password-reset/delivery", code: "EMAIL_DELIVERY_FAILED" }));
      }
    }
    return NextResponse.json({ message: genericSend, challengeId: result.id, expiresAt: result.expiresAt.toISOString(), retryAfter: 60 });
  }
  if (typeof body.challengeId !== "string" || typeof body.code !== "string") return NextResponse.json({ error: invalidCode }, { status: 400 });
  if (!verification && !validNewPassword(body.password)) return NextResponse.json({ error: PASSWORD_REQUIREMENT }, { status: 400 });
  const challenge = await consumeEmailCode(body.challengeId, purpose, body.code, target?.subjectId);
  if (!challenge) return NextResponse.json({ error: invalidCode }, { status: 400 });
  if (verification) {
    if (challenge.email !== target!.email || challenge.provider !== "FIREBASE") return NextResponse.json({ error: invalidCode }, { status: 400 });
    await getCustomerAdminAuth().updateUser(challenge.subjectId, { emailVerified: true });
    return NextResponse.json({ message: "Email verified." });
  }
  if (challenge.provider === "FIREBASE") {
    const auth = getCustomerAdminAuth();
    const firebaseUser = await auth.getUser(challenge.subjectId);
    const local = await db.user.findUnique({ where: { email: challenge.email } });
    if (firebaseUser.disabled || firebaseUser.email?.toLowerCase() !== challenge.email || (local && (local.role !== "CUSTOMER" || local.isBanned))) return NextResponse.json({ error: invalidCode }, { status: 400 });
    await db.user.updateMany({ where: { role: "CUSTOMER", authIdentities: { some: { provider: "FIREBASE", providerUserId: challenge.subjectId } } }, data: { authInvalidBefore: new Date() } });
    await auth.updateUser(challenge.subjectId, { password: body.password });
    await auth.revokeRefreshTokens(challenge.subjectId);
    await db.$transaction(async tx => {
      await tx.authIdentity.updateMany({ where: { provider: "PASSWORD", user: { role: "CUSTOMER", authIdentities: { some: { provider: "FIREBASE", providerUserId: challenge.subjectId } } } }, data: { passwordHash: hashPassword(body.password) } });
      // Also invalidate sessions opened while the provider was changing the password.
      await tx.user.updateMany({ where: { role: "CUSTOMER", authIdentities: { some: { provider: "FIREBASE", providerUserId: challenge.subjectId } } }, data: { authInvalidBefore: new Date() } });
    });
  } else {
    const changed = await db.$transaction(async tx => {
      const result = await tx.authIdentity.updateMany({ where: { provider: "PASSWORD", userId: challenge.subjectId,
        user: { email: challenge.email, role: "CUSTOMER", isBanned: false } }, data: { passwordHash: hashPassword(body.password) } });
      if (result.count === 1) await tx.user.update({ where: { id: challenge.subjectId }, data: { authInvalidBefore: new Date() } });
      return result;
    });
    if (changed.count !== 1) return NextResponse.json({ error: invalidCode }, { status: 400 });
  }
  return NextResponse.json({ message: "Password updated. Sign in with your new password." });
}
