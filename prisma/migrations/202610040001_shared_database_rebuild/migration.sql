-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'RIDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('FIREBASE', 'PASSWORD');

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('DELIVERY', 'RIDE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'MATCHED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleClass" AS ENUM ('MOTORCYCLE', 'TRICYCLE', 'SEDAN', 'CLOSED_VAN', 'FLATBED', 'REFRIGERATED');

-- CreateEnum
CREATE TYPE "TrackingSource" AS ENUM ('LEGACY', 'NATIVE');

-- CreateEnum
CREATE TYPE "ProofType" AS ENUM ('SIGNATURE', 'OTP', 'PHOTO');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('BOOKING', 'FARE', 'RIDER', 'LOST_ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "BookingEventAction" AS ENUM ('CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "bannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "refCode" TEXT NOT NULL,
    "ticketId" TEXT,
    "type" "BookingType" NOT NULL DEFAULT 'DELIVERY',
    "customerId" TEXT NOT NULL,
    "riderId" TEXT,
    "pickupLabel" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffLabel" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "cargoWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "passengers" INTEGER NOT NULL DEFAULT 1,
    "cargoNotes" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "baseFare" DECIMAL(12,2) NOT NULL,
    "surgeMultiplier" DECIMAL(5,3) NOT NULL DEFAULT 1.0,
    "totalFare" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "matchedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "etaMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCounter" (
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TicketCounter_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "TrackingUpdate" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "source" "TrackingSource" NOT NULL DEFAULT 'LEGACY',
    "speedKph" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "etaMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryProof" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "proofType" "ProofType" NOT NULL,
    "signatureSvg" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "photoUrl" TEXT,
    "recipientName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReview" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "category" "SupportCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderProfile" (
    "userId" TEXT NOT NULL,
    "vehicleClass" "VehicleClass" NOT NULL,
    "vehiclePlate" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "totalDeliveries" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RiderPresence" (
    "userId" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "locationAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderPresence_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "action" "BookingEventAction" NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus" NOT NULL,
    "riderId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryChallenge" (
    "bookingId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeCiphertext" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryChallenge_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "BookingLocation" (
    "bookingId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speedKph" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingLocation_pkey" PRIMARY KEY ("bookingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_refCode_key" ON "Booking"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_ticketId_key" ON "Booking"("ticketId");

-- CreateIndex
CREATE INDEX "Booking_customerId_createdAt_id_idx" ON "Booking"("customerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Booking_riderId_status_createdAt_idx" ON "Booking"("riderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_status_vehicleClass_createdAt_idx" ON "Booking"("status", "vehicleClass", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_type_createdAt_idx" ON "Booking"("type", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingUpdate_bookingId_createdAt_idx" ON "TrackingUpdate"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingUpdate_createdAt_idx" ON "TrackingUpdate"("createdAt");

-- CreateIndex
CREATE INDEX "DeliveryProof_bookingId_idx" ON "DeliveryProof"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReview_bookingId_key" ON "CustomerReview"("bookingId");

-- CreateIndex
CREATE INDEX "CustomerReview_riderId_idx" ON "CustomerReview"("riderId");

-- CreateIndex
CREATE INDEX "SupportTicket_customerId_createdAt_idx" ON "SupportTicket"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAudit_entityType_entityId_idx" ON "AdminAudit"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_key" ON "AuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "AuthIdentity"("userId", "provider");

-- CreateIndex
CREATE INDEX "RiderPresence_isOnline_locationAt_idx" ON "RiderPresence"("isOnline", "locationAt");

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingUpdate" ADD CONSTRAINT "TrackingUpdate_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingUpdate" ADD CONSTRAINT "TrackingUpdate_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReview" ADD CONSTRAINT "CustomerReview_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReview" ADD CONSTRAINT "CustomerReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReview" ADD CONSTRAINT "CustomerReview_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAudit" ADD CONSTRAINT "AdminAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPresence" ADD CONSTRAINT "RiderPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallenge" ADD CONSTRAINT "DeliveryChallenge_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLocation" ADD CONSTRAINT "BookingLocation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain constraints: enforced regardless of which app writes the record.
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized" CHECK ("email" = lower(btrim("email")) AND length("email") > 0);
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_credentials" CHECK (
  length("providerUserId") > 0 AND (("provider" = 'PASSWORD' AND "passwordHash" IS NOT NULL AND length("passwordHash") > 0)
  OR ("provider" = 'FIREBASE' AND "passwordHash" IS NULL)));
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_values" CHECK ("rating" BETWEEN 1 AND 5 AND "totalDeliveries" >= 0);
ALTER TABLE "RiderPresence" ADD CONSTRAINT "RiderPresence_coordinates" CHECK (
  ("lat" IS NULL AND "lng" IS NULL) OR ("lat" IS NOT NULL AND "lng" IS NOT NULL AND "lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180 AND "locationAt" IS NOT NULL));
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_values" CHECK (
  "baseFare" >= 0 AND "totalFare" >= 0 AND "surgeMultiplier" BETWEEN 1 AND 1.5
  AND "distanceKm" BETWEEN 0 AND 100000 AND "cargoWeightKg" BETWEEN 0 AND 1000000 AND "passengers" BETWEEN 1 AND 4
  AND ("etaMinutes" IS NULL OR "etaMinutes" >= 0)
  AND "pickupLat" BETWEEN -90 AND 90 AND "dropoffLat" BETWEEN -90 AND 90
  AND "pickupLng" BETWEEN -180 AND 180 AND "dropoffLng" BETWEEN -180 AND 180);
ALTER TABLE "CustomerReview" ADD CONSTRAINT "CustomerReview_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "DeliveryChallenge" ADD CONSTRAINT "DeliveryChallenge_attempts" CHECK ("attempts" >= 0 AND "attempts" <= "maxAttempts" AND "maxAttempts" BETWEEN 1 AND 10);
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_artifact" CHECK (
  ("proofType" = 'OTP' AND "verifiedAt" IS NOT NULL AND "signatureSvg" IS NULL AND "photoUrl" IS NULL)
  OR ("proofType" = 'SIGNATURE' AND "signatureSvg" IS NOT NULL AND length("signatureSvg") BETWEEN 1 AND 100000 AND "photoUrl" IS NULL)
  OR ("proofType" = 'PHOTO' AND "photoUrl" IS NOT NULL AND length("photoUrl") BETWEEN 1 AND 200000 AND "signatureSvg" IS NULL));
ALTER TABLE "TrackingUpdate" ADD CONSTRAINT "TrackingUpdate_coordinates" CHECK (
  "lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180 AND ("speedKph" IS NULL OR "speedKph" BETWEEN 0 AND 500)
  AND ("heading" IS NULL OR ("heading" >= 0 AND "heading" < 360)));
ALTER TABLE "BookingLocation" ADD CONSTRAINT "BookingLocation_coordinates" CHECK (
  "lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180 AND ("speedKph" IS NULL OR "speedKph" BETWEEN 0 AND 500)
  AND ("heading" IS NULL OR ("heading" >= 0 AND "heading" < 360)));
ALTER TABLE "TicketCounter" ADD CONSTRAINT "TicketCounter_type_value" CHECK ("type" IN ('RIDE', 'DELIVERY') AND "value" >= 0);

-- A foreign key to User alone cannot verify its role.
CREATE FUNCTION fetch_rider_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."userId" AND "role" = 'RIDER') THEN
    RAISE EXCEPTION 'Rider records require a RIDER account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "RiderProfile_role" BEFORE INSERT OR UPDATE ON "RiderProfile" FOR EACH ROW EXECUTE FUNCTION fetch_rider_only();
CREATE TRIGGER "RiderPresence_role" BEFORE INSERT OR UPDATE ON "RiderPresence" FOR EACH ROW EXECUTE FUNCTION fetch_rider_only();

CREATE FUNCTION fetch_account_role_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" <> OLD."role" THEN RAISE EXCEPTION 'Account role is immutable; create a separate account' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_role_immutable" BEFORE UPDATE OF "role" ON "User" FOR EACH ROW EXECUTE FUNCTION fetch_account_role_immutable();

CREATE FUNCTION fetch_booking_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."customerId" AND "role" = 'CUSTOMER') THEN
    RAISE EXCEPTION 'Booking customer must be a CUSTOMER' USING ERRCODE = '23514';
  END IF;
  IF NEW."riderId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "RiderProfile" WHERE "userId" = NEW."riderId") THEN
    RAISE EXCEPTION 'Assigned rider must have a rider profile' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Booking_roles" BEFORE INSERT OR UPDATE OF "customerId", "riderId" ON "Booking" FOR EACH ROW EXECUTE FUNCTION fetch_booking_roles();

CREATE FUNCTION fetch_review_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Booking" WHERE "id" = NEW."bookingId" AND "customerId" = NEW."customerId" AND "riderId" = NEW."riderId" AND "status" = 'DELIVERED') THEN
    RAISE EXCEPTION 'Review must match a completed booking' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CustomerReview_booking" BEFORE INSERT OR UPDATE ON "CustomerReview" FOR EACH ROW EXECUTE FUNCTION fetch_review_booking();

CREATE FUNCTION fetch_support_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Booking" WHERE "id" = NEW."bookingId" AND "customerId" = NEW."customerId") THEN
    RAISE EXCEPTION 'Support request must belong to the booking customer' USING ERRCODE = '23514';
  END IF;
  IF NEW."assignedAdminId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."assignedAdminId" AND "role" = 'ADMIN') THEN
    RAISE EXCEPTION 'Support assignee must be an ADMIN' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SupportTicket_ownership" BEFORE INSERT OR UPDATE OF "customerId", "bookingId", "assignedAdminId" ON "SupportTicket" FOR EACH ROW EXECUTE FUNCTION fetch_support_ownership();
