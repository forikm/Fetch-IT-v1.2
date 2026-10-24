-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'SUPPORT';
ALTER TYPE "UserRole" ADD VALUE 'FINANCE';
ALTER TYPE "UserRole" ADD VALUE 'SAFETY';
ALTER TYPE "UserRole" ADD VALUE 'SUPPORT_SUPERVISOR';
ALTER TYPE "UserRole" ADD VALUE 'SUPERADMIN';

-- CreateTable
CREATE TABLE "OwnerIdentity" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerCredential" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "OwnerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerInvitation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "ownerId" TEXT,
    "invitationId" TEXT,
    "sessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "version" INTEGER NOT NULL DEFAULT 1,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCase" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "bookingId" TEXT,
    "ticketId" TEXT,
    "subjectUserId" TEXT,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "recommendation" TEXT,
    "decision" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportInternalNote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportInternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffResource" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerIdentity_actorId_key" ON "OwnerIdentity"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerIdentity_email_key" ON "OwnerIdentity"("email");

-- CreateIndex
CREATE INDEX "OwnerSession_ownerId_expiresAt_idx" ON "OwnerSession"("ownerId", "expiresAt");

-- CreateIndex
CREATE INDEX "OwnerChallenge_expiresAt_idx" ON "OwnerChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "OwnerAudit_createdAt_idx" ON "OwnerAudit"("createdAt");

-- CreateIndex
CREATE INDEX "StaffSession_userId_expiresAt_idx" ON "StaffSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "WorkflowCase_kind_assignedToId_status_idx" ON "WorkflowCase"("kind", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "WorkflowCase_bookingId_idx" ON "WorkflowCase"("bookingId");

-- CreateIndex
CREATE INDEX "WorkflowNote_caseId_createdAt_idx" ON "WorkflowNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportInternalNote_ticketId_createdAt_idx" ON "SupportInternalNote"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffResource_kind_updatedAt_idx" ON "StaffResource"("kind", "updatedAt");

-- AddForeignKey
ALTER TABLE "OwnerIdentity" ADD CONSTRAINT "OwnerIdentity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerCredential" ADD CONSTRAINT "OwnerCredential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerSession" ADD CONSTRAINT "OwnerSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerInvitation" ADD CONSTRAINT "OwnerInvitation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowNote" ADD CONSTRAINT "WorkflowNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "WorkflowCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Privileged staff can move between operational roles. Customer, rider and
-- owner identities remain separate accounts. Runtime column grants determine
-- which database principal can perform these changes.
CREATE OR REPLACE FUNCTION fetch_account_role_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" <> OLD."role" AND NOT (
    OLD."role"::text IN ('ADMIN','SUPPORT','SUPPORT_SUPERVISOR','FINANCE','SAFETY') AND
    NEW."role"::text IN ('ADMIN','SUPPORT','SUPPORT_SUPERVISOR','FINANCE','SAFETY')
  ) THEN
    RAISE EXCEPTION 'Create a separate account for this role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fetch_support_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."customerId" AND "role"::text = 'CUSTOMER') THEN
    RAISE EXCEPTION 'Support request must belong to a CUSTOMER' USING ERRCODE = '23514';
  END IF;
  IF NEW."bookingId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Booking" WHERE "id" = NEW."bookingId" AND "customerId" = NEW."customerId"
  ) THEN
    RAISE EXCEPTION 'Support request must belong to the booking customer' USING ERRCODE = '23514';
  END IF;
  IF NEW."assignedAdminId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "id" = NEW."assignedAdminId" AND "role"::text IN ('ADMIN','SUPPORT','SUPPORT_SUPERVISOR','SUPERADMIN') AND NOT "isBanned"
  ) THEN
    RAISE EXCEPTION 'Choose an active support assignee' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

