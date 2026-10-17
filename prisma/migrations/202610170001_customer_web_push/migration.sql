CREATE TYPE "CustomerNotificationCategory" AS ENUM ('DELIVERY', 'RIDE', 'SUPPORT');

CREATE TABLE "WebPushIdentity" (
  "id" TEXT PRIMARY KEY,
  "publicKey" TEXT NOT NULL,
  "privateKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CustomerPushSubscription" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "deviceId" TEXT NOT NULL UNIQUE,
  "endpoint" TEXT NOT NULL UNIQUE,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "CustomerPushSubscription_customerId_idx" ON "CustomerPushSubscription"("customerId");

CREATE TABLE "CustomerNotification" (
  "id" TEXT PRIMARY KEY,
  "sourceId" TEXT NOT NULL UNIQUE,
  "customerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "category" "CustomerNotificationCategory" NOT NULL,
  "bookingId" TEXT REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "ticketId" TEXT REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" "BookingStatus",
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  "pushDeliveredAt" TIMESTAMP(3),
  "pushLeaseUntil" TIMESTAMP(3),
  "pushNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pushAttempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CustomerNotification_target_check" CHECK (
    ("category" = 'SUPPORT' AND "ticketId" IS NOT NULL AND "bookingId" IS NULL)
    OR ("category" IN ('DELIVERY', 'RIDE') AND "bookingId" IS NOT NULL AND "ticketId" IS NULL)
  )
);
CREATE INDEX "CustomerNotification_customerId_category_readAt_idx" ON "CustomerNotification"("customerId", "category", "readAt");
CREATE INDEX "CustomerNotification_customerId_createdAt_id_idx" ON "CustomerNotification"("customerId", "createdAt", "id");
CREATE INDEX "CustomerNotification_pushDeliveredAt_pushNextAttemptAt_idx" ON "CustomerNotification"("pushDeliveredAt", "pushNextAttemptAt");
