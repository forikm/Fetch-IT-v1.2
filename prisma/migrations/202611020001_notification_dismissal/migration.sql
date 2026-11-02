-- Dismiss inbox entries without deleting bookings, messages, or event sources.
ALTER TABLE "CustomerNotification" ADD COLUMN "dismissedAt" TIMESTAMP(3);
