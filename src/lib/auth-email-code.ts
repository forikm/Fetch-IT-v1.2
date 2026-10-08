import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { sessionSecret } from "./session-secret";

export const EMAIL_CODE_TTL_MS = 10 * 60_000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export type EmailCodePurpose = "VERIFY_EMAIL" | "RESET_PASSWORD" | "ADMIN_RESET_PASSWORD";
export type EmailCodeTarget = { email: string; subjectId: string; provider: "FIREBASE" | "PASSWORD" };

export function emailCodeHash(id: string, code: string) {
  return createHmac("sha256", sessionSecret("EMAIL_CODE_SECRET")).update(JSON.stringify([id, code])).digest("hex");
}

export async function issueEmailCode(purpose: EmailCodePurpose, target: EmailCodeTarget) {
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
  await db.authEmailCode.upsert({
    where: { email_purpose: { email: target.email, purpose } },
    create: { id, purpose, ...target, codeHash: emailCodeHash(id, code), expiresAt },
    update: { id, ...target, codeHash: emailCodeHash(id, code), expiresAt, attempts: 0, usedAt: null, createdAt: new Date() },
  });
  return { id, code, expiresAt };
}

// Return failures instead of throwing inside the transaction, so failed-attempt
// increments commit. The row lock makes concurrent guesses/consumption atomic.
export async function consumeEmailCode(id: string, purpose: EmailCodePurpose, code: string, subjectId?: string) {
  if (!/^[0-9]{6}$/.test(code) || !/^[a-f0-9-]{36}$/.test(id)) return null;
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "AuthEmailCode" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.authEmailCode.findUnique({ where: { id } });
    if (!row || row.purpose !== purpose || (subjectId && row.subjectId !== subjectId) || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return null;
    const expected = Buffer.from(row.codeHash, "hex");
    const supplied = Buffer.from(emailCodeHash(id, code), "hex");
    const correct = expected.length === supplied.length && timingSafeEqual(expected, supplied);
    await tx.authEmailCode.update({ where: { id }, data: { attempts: { increment: 1 }, ...(correct ? { usedAt: new Date() } : {}) } });
    return correct ? row : null;
  }, { maxWait: 10000, timeout: 20000 });
}
