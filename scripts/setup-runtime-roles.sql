-- Run with psql as the migration/maintenance owner AFTER deploying migrations.
-- Never run with a runtime credential. Review against the intended Neon database.
-- This creates permission groups with NOLOGIN; enable login and set a unique
-- password separately for each role using your authorized maintenance session.
-- Do not grant membership in neon_superuser or use the table-owner connection.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fetch_customer_runtime') THEN CREATE ROLE fetch_customer_runtime NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fetch_rider_runtime') THEN CREATE ROLE fetch_rider_runtime NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fetch_staff_runtime') THEN CREATE ROLE fetch_staff_runtime NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fetch_owner_runtime') THEN CREATE ROLE fetch_owner_runtime NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime,fetch_owner_runtime;
-- Runtime users cannot create schema objects or inherit table-owner permissions.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime,fetch_owner_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime,fetch_owner_runtime;
REVOKE ALL ON "OwnerIdentity","OwnerCredential","OwnerSession","OwnerInvitation","OwnerChallenge","OwnerAudit","PlatformConfig" FROM PUBLIC;

GRANT SELECT ON "User","RiderProfile","RiderPresence","Booking","TrackingUpdate","BookingLocation","DeliveryProof","CustomerReview","BookingEvent","PaymentEvent","SupportTicket","SupportMessage","PlatformConfig" TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime,fetch_owner_runtime;
GRANT INSERT ON "User" TO fetch_customer_runtime,fetch_rider_runtime;
-- Prisma includes updatedAt whenever it changes a User row.
GRANT UPDATE("name","phone","authInvalidBefore","updatedAt") ON "User" TO fetch_customer_runtime;
GRANT UPDATE("name","phone","updatedAt") ON "User" TO fetch_rider_runtime;
GRANT UPDATE("isBanned","banReason","bannedAt","authInvalidBefore","updatedAt") ON "User" TO fetch_staff_runtime;
GRANT SELECT,INSERT,UPDATE ON "AuthIdentity","AuthEmailCode","RateLimitBucket" TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime;
GRANT DELETE ON "AuthEmailCode","RateLimitBucket" TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime;
GRANT SELECT,INSERT,UPDATE ON "Booking","TicketCounter","CheckoutDraft","DemoCheckout","SupportTicket" TO fetch_customer_runtime;
GRANT SELECT,INSERT,UPDATE ON "RiderProfile","RiderPresence","Booking","TicketCounter","DeliveryChallenge","BookingLocation" TO fetch_rider_runtime;
GRANT INSERT,UPDATE ON "RiderProfile","RiderPresence" TO fetch_customer_runtime;
GRANT INSERT ON "TrackingUpdate","DeliveryProof","CustomerReview","BookingEvent","PaymentEvent","SupportMessage" TO fetch_customer_runtime,fetch_rider_runtime;
GRANT UPDATE ON "DeliveryProof","BookingLocation" TO fetch_rider_runtime;
GRANT DELETE ON "BookingLocation","DeliveryChallenge" TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime;
GRANT SELECT,INSERT,UPDATE ON "DeliveryChallenge" TO fetch_customer_runtime,fetch_staff_runtime;
GRANT SELECT,INSERT,UPDATE ON "Booking","SupportTicket","CheckoutDraft","DemoCheckout" TO fetch_staff_runtime;
GRANT INSERT ON "BookingEvent","PaymentEvent","SupportMessage" TO fetch_staff_runtime;
GRANT SELECT,INSERT,UPDATE ON "StaffSession","WorkflowCase","StaffResource" TO fetch_staff_runtime;
GRANT SELECT,INSERT ON "SupportInternalNote","WorkflowNote","AdminAudit" TO fetch_staff_runtime;

-- Owners receive the same operational data access plus owner-only capabilities.
-- Grant the staff permission group, not staff credentials or shared sessions.
GRANT fetch_staff_runtime TO fetch_owner_runtime;
GRANT SELECT,INSERT,UPDATE ON "User","AuthIdentity","OwnerIdentity","OwnerCredential","OwnerSession","OwnerInvitation","OwnerChallenge","PlatformConfig","RateLimitBucket" TO fetch_owner_runtime;
GRANT DELETE ON "OwnerCredential","OwnerChallenge" TO fetch_owner_runtime;
GRANT SELECT,INSERT ON "OwnerAudit" TO fetch_owner_runtime;
-- Do not allow runtime roles to rewrite original case evidence or audit history.
REVOKE UPDATE,DELETE ON "OwnerAudit","AdminAudit","WorkflowNote","SupportInternalNote" FROM fetch_staff_runtime,fetch_owner_runtime;

-- No customer/rider runtime may insert privileged User roles or update them.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fetch_runtime_read ON "User";
CREATE POLICY fetch_runtime_read ON "User" FOR SELECT TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime,fetch_owner_runtime USING(true);
DROP POLICY IF EXISTS fetch_customer_insert ON "User";
CREATE POLICY fetch_customer_insert ON "User" FOR INSERT TO fetch_customer_runtime WITH CHECK("role" IN ('CUSTOMER','RIDER'));
DROP POLICY IF EXISTS fetch_rider_insert ON "User";
CREATE POLICY fetch_rider_insert ON "User" FOR INSERT TO fetch_rider_runtime WITH CHECK("role" = 'RIDER');
DROP POLICY IF EXISTS fetch_runtime_update ON "User";
CREATE POLICY fetch_runtime_update ON "User" FOR UPDATE TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime USING("role" <> 'SUPERADMIN') WITH CHECK("role" <> 'SUPERADMIN');
DROP POLICY IF EXISTS fetch_owner_insert ON "User";
CREATE POLICY fetch_owner_insert ON "User" FOR INSERT TO fetch_owner_runtime WITH CHECK(true);
DROP POLICY IF EXISTS fetch_owner_update ON "User";
CREATE POLICY fetch_owner_update ON "User" FOR UPDATE TO fetch_owner_runtime USING(true) WITH CHECK(true);

-- Explicitly grant notification/outbox access if present in the installed schema.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['CustomerNotification','CustomerPushSubscription','WebPushIdentity'] LOOP
    IF to_regclass(format('public.%I',t)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime',t);
    END IF;
  END LOOP;
END $$;
-- Rider onboarding uses dedicated authenticated application routes.
GRANT SELECT ON "RiderServiceApproval" TO fetch_customer_runtime,fetch_rider_runtime,fetch_staff_runtime,fetch_owner_runtime;
GRANT SELECT,INSERT,UPDATE ON "RiderApplication","RiderApplicationDocument" TO fetch_rider_runtime,fetch_staff_runtime,fetch_owner_runtime;
GRANT SELECT,INSERT ON "RiderApplicationEvent" TO fetch_rider_runtime,fetch_staff_runtime,fetch_owner_runtime;
GRANT SELECT ON "RiderApplicationEmail" TO fetch_rider_runtime;
GRANT SELECT,INSERT,UPDATE ON "RiderServiceApproval","RiderApplicationEmail" TO fetch_staff_runtime,fetch_owner_runtime;
-- No automatic grants on future tables. Review grants whenever schema changes.
COMMIT;

GRANT UPDATE("vehicleClass","vehiclePlate","updatedAt") ON "RiderProfile" TO fetch_staff_runtime,fetch_owner_runtime;
GRANT UPDATE("isOnline","updatedAt") ON "RiderPresence" TO fetch_staff_runtime,fetch_owner_runtime;
