CREATE TABLE "CheckoutDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestHash" TEXT NOT NULL,
  "bookingData" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bookingId" TEXT REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CheckoutDraft_bookingId_key" ON "CheckoutDraft"("bookingId");
CREATE INDEX "CheckoutDraft_customerId_createdAt_idx" ON "CheckoutDraft"("customerId", "createdAt");
ALTER TABLE "DemoCheckout" ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE "DemoCheckout" ADD COLUMN "draftId" TEXT REFERENCES "CheckoutDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoCheckout" ADD CONSTRAINT "DemoCheckout_one_parent" CHECK (("bookingId" IS NULL) <> ("draftId" IS NULL));
CREATE INDEX "DemoCheckout_draftId_createdAt_idx" ON "DemoCheckout"("draftId", "createdAt");
CREATE UNIQUE INDEX "DemoCheckout_pending_draft" ON "DemoCheckout"("draftId") WHERE "status" = 'PENDING';
