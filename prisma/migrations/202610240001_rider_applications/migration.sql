-- CreateTable
CREATE TABLE "RiderApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "vehicleClass" "VehicleClass" NOT NULL,
    "services" "BookingType"[],
    "fields" JSONB NOT NULL DEFAULT '{}',
    "fieldReviews" JSONB NOT NULL DEFAULT '{}',
    "emailVerifiedAt" TIMESTAMP(3),
    "verifiedEmail" TEXT,
    "assignedToId" TEXT,
    "recommendedById" TEXT,
    "recommendedAt" TIMESTAMP(3),
    "orientationAt" TIMESTAMP(3),
    "orientationVenue" TEXT,
    "orientationInstructions" TEXT,
    "attendedAt" TIMESTAMP(3),
    "assessmentPassedAt" TIMESTAMP(3),
    "assessmentNotes" TEXT,
    "assessedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderApplicationDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "pathname" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderServiceApproval" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "service" "BookingType" NOT NULL,
    "source" TEXT NOT NULL,
    "operatingZone" JSONB,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RiderServiceApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderApplicationEmail" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderApplicationEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiderApplication_userId_key" ON "RiderApplication"("userId");

-- CreateIndex
CREATE INDEX "RiderApplication_status_updatedAt_idx" ON "RiderApplication"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "RiderApplicationDocument_applicationId_current_idx" ON "RiderApplicationDocument"("applicationId", "current");

-- CreateIndex
CREATE UNIQUE INDEX "RiderApplicationDocument_applicationId_kind_version_key" ON "RiderApplicationDocument"("applicationId", "kind", "version");

-- CreateIndex
CREATE INDEX "RiderApplicationEvent_applicationId_createdAt_idx" ON "RiderApplicationEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiderServiceApproval_userId_vehicleClass_service_key" ON "RiderServiceApproval"("userId", "vehicleClass", "service");

-- CreateIndex
CREATE UNIQUE INDEX "RiderApplicationEmail_sourceId_key" ON "RiderApplicationEmail"("sourceId");

-- CreateIndex
CREATE INDEX "RiderApplicationEmail_applicationId_createdAt_idx" ON "RiderApplicationEmail"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "RiderApplication" ADD CONSTRAINT "RiderApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderApplicationDocument" ADD CONSTRAINT "RiderApplicationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RiderApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderApplicationEvent" ADD CONSTRAINT "RiderApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RiderApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderServiceApproval" ADD CONSTRAINT "RiderServiceApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderApplicationEmail" ADD CONSTRAINT "RiderApplicationEmail_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RiderApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing access explicitly; these rows are NOT document verification.
ALTER TABLE "AuthEmailCode" DROP CONSTRAINT "AuthEmailCode_purpose_check";
ALTER TABLE "AuthEmailCode" ADD CONSTRAINT "AuthEmailCode_purpose_check" CHECK ("purpose" IN ('VERIFY_EMAIL','RESET_PASSWORD','ADMIN_RESET_PASSWORD','RIDER_VERIFY_EMAIL'));
-- New signups after this migration receive no approval until onboarding completes.
INSERT INTO "RiderServiceApproval" ("id","userId","vehicleClass","service","source","approvedAt")
SELECT 'legacy-' || md5(u."id" || ':' || p."vehicleClass"::text || ':' || s.service), u."id",p."vehicleClass",s.service::"BookingType",'LEGACY_EXISTING',CURRENT_TIMESTAMP
FROM "User" u JOIN "RiderProfile" p ON p."userId"=u."id"
CROSS JOIN (VALUES ('DELIVERY'),('RIDE')) AS s(service)
WHERE u."role"='RIDER' AND (s.service='DELIVERY' OR p."vehicleClass"::text IN ('MOTORCYCLE','TRICYCLE','SEDAN'))
ON CONFLICT DO NOTHING;
CREATE UNIQUE INDEX "RiderApplicationDocument_current_kind" ON "RiderApplicationDocument"("applicationId","kind") WHERE "current"=true;
-- Existing runtime groups get only the privileges needed for this feature.
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['fetch_customer_runtime','fetch_rider_runtime','fetch_staff_runtime','fetch_owner_runtime'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('GRANT SELECT ON "RiderServiceApproval" TO %I',role_name);
  END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['fetch_rider_runtime','fetch_staff_runtime','fetch_owner_runtime'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON "RiderApplication","RiderApplicationDocument" TO %I',role_name);
   EXECUTE format('GRANT SELECT,INSERT ON "RiderApplicationEvent" TO %I',role_name);
   EXECUTE format('GRANT SELECT ON "RiderApplicationEmail" TO %I',role_name);
  END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['fetch_staff_runtime','fetch_owner_runtime'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('GRANT INSERT,UPDATE ON "RiderServiceApproval","RiderApplicationEmail" TO %I',role_name);
   EXECUTE format('GRANT UPDATE("vehicleClass","vehiclePlate","updatedAt") ON "RiderProfile" TO %I',role_name);
   EXECUTE format('GRANT UPDATE("isOnline","updatedAt") ON "RiderPresence" TO %I',role_name);
  END IF;
 END LOOP;
END $$;
