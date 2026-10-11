ALTER TYPE "PaymentMethod" ADD VALUE 'DEMO_GCASH';
ALTER TYPE "PaymentMethod" ADD VALUE 'DEMO_MAYA';
ALTER TYPE "PaymentMethod" ADD VALUE 'DEMO_BANK';
CREATE TYPE "DemoCheckoutStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
ALTER TABLE "Booking"
 ADD COLUMN "demoCommissionBps" INTEGER,
 ADD COLUMN "demoCommission" DECIMAL(12,2),
 ADD COLUMN "demoRiderEarnings" DECIMAL(12,2),
 ADD COLUMN "demoPayoutAt" TIMESTAMP(3),
 ADD COLUMN "demoPayoutReference" TEXT;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_demoCommissionBps_check"
 CHECK ("demoCommissionBps" IS NULL OR "demoCommissionBps" BETWEEN 0 AND 10000);
CREATE TABLE "DemoCheckout" (
 "id" TEXT NOT NULL,
 "bookingId" TEXT NOT NULL,
 "status" "DemoCheckoutStatus" NOT NULL DEFAULT 'PENDING',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resolvedAt" TIMESTAMP(3),
 CONSTRAINT "DemoCheckout_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "DemoCheckout_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DemoCheckout_bookingId_createdAt_idx" ON "DemoCheckout"("bookingId", "createdAt");
CREATE UNIQUE INDEX "DemoCheckout_one_pending_per_booking" ON "DemoCheckout"("bookingId") WHERE "status" = 'PENDING';
