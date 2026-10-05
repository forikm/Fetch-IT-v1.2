-- Preserve existing support requests and replies; allow account help without a booking.
ALTER TABLE "SupportTicket" ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE "SupportTicket" ADD COLUMN "customerReadAt" TIMESTAMP(3),
  ADD COLUMN "lastCustomerMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastAdminReplyAt" TIMESTAMP(3);
ALTER TABLE "SupportMessage" ADD COLUMN "authorRole" "UserRole" NOT NULL DEFAULT 'ADMIN';
UPDATE "SupportTicket" t SET "lastCustomerMessageAt" = t."createdAt",
  "lastAdminReplyAt" = (SELECT MAX(m."createdAt") FROM "SupportMessage" m WHERE m."ticketId" = t."id");

CREATE OR REPLACE FUNCTION fetch_support_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."customerId" AND "role" = 'CUSTOMER') THEN
    RAISE EXCEPTION 'Support request must belong to a CUSTOMER' USING ERRCODE = '23514';
  END IF;
  IF NEW."bookingId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Booking" WHERE "id" = NEW."bookingId" AND "customerId" = NEW."customerId"
  ) THEN
    RAISE EXCEPTION 'Support request must belong to the booking customer' USING ERRCODE = '23514';
  END IF;
  IF NEW."assignedAdminId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "id" = NEW."assignedAdminId" AND "role" = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Support assignee must be an ADMIN' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
