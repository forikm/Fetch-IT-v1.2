CREATE TYPE "PaymentMethod" AS ENUM ('CASH');
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'REFUNDED', 'FAILED');
ALTER TYPE "BookingEventAction" ADD VALUE 'REASSIGNED';
ALTER TABLE "Booking"
 ADD COLUMN "cancellationReason" TEXT,
 ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
 ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
 ADD COLUMN "customerPaidAmount" DECIMAL(12,2),
 ADD COLUMN "riderReceivedAmount" DECIMAL(12,2),
 ADD COLUMN "customerPaidAt" TIMESTAMP(3),
 ADD COLUMN "riderReceivedAt" TIMESTAMP(3),
 ADD COLUMN "paidAt" TIMESTAMP(3),
 ADD COLUMN "paymentReference" TEXT,
 ADD COLUMN "assignmentExpiresAt" TIMESTAMP(3),
 ADD COLUMN "excludedRiderIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "Booking_status_assignmentExpiresAt_idx" ON "Booking"("status", "assignmentExpiresAt");
CREATE TABLE "PaymentEvent" (
 "id" TEXT PRIMARY KEY, "bookingId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "actorName" TEXT NOT NULL, "actorRole" "UserRole" NOT NULL, "action" TEXT NOT NULL,
 "amount" DECIMAL(12,2), "fromStatus" "PaymentStatus" NOT NULL,
 "toStatus" "PaymentStatus" NOT NULL, "reason" TEXT, "reference" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PaymentEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PaymentEvent_bookingId_createdAt_idx" ON "PaymentEvent"("bookingId", "createdAt");
ALTER TABLE "AuthEmailCode" DROP CONSTRAINT "AuthEmailCode_purpose_check";
ALTER TABLE "AuthEmailCode" ADD CONSTRAINT "AuthEmailCode_purpose_check"
 CHECK ("purpose" IN ('VERIFY_EMAIL', 'RESET_PASSWORD', 'ADMIN_RESET_PASSWORD'));
