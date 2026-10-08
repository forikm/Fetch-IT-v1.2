ALTER TABLE "User" ADD COLUMN "authInvalidBefore" TIMESTAMP(3);
CREATE TABLE "AuthEmailCode" (
  "id" TEXT PRIMARY KEY,
  "purpose" TEXT NOT NULL CHECK ("purpose" IN ('VERIFY_EMAIL', 'RESET_PASSWORD')),
  "email" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AuthEmailCode_email_purpose_key" ON "AuthEmailCode"("email", "purpose");
CREATE INDEX "AuthEmailCode_expiresAt_idx" ON "AuthEmailCode"("expiresAt");
