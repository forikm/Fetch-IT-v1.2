BEGIN;
CREATE TABLE IF NOT EXISTS "CustomerReview" (
 "id" TEXT PRIMARY KEY,
 "bookingId" TEXT NOT NULL UNIQUE REFERENCES "Booking"("id"),
 "customerId" TEXT NOT NULL REFERENCES "User"("id"),
 "riderId" TEXT NOT NULL REFERENCES "User"("id"),
 "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
 "comment" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CustomerReview_riderId_idx" ON "CustomerReview"("riderId");
CREATE TABLE IF NOT EXISTS "SupportTicket" (
 "id" TEXT PRIMARY KEY,
 "customerId" TEXT NOT NULL REFERENCES "User"("id"),
 "bookingId" TEXT NOT NULL REFERENCES "Booking"("id"),
 "category" TEXT NOT NULL,
 "message" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'OPEN',
 "adminReply" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SupportTicket_customerId_createdAt_idx" ON "SupportTicket"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx" ON "SupportTicket"("status");
COMMIT;
