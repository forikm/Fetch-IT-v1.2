-- Apply only after applications stop querying the retired enum values.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- The prior migration verified and normalized all four columns.
-- DROP TYPE intentionally omits CASCADE so unexpected dependencies cause a rollback.

-- Retain the exact row access policy definitions on deployments with runtime roles.
CREATE TEMP TABLE staff_role_policies ON COMMIT DROP AS
SELECT
  format('DROP POLICY %I ON %I.%I', policyname, schemaname, tablename) AS remove_sql,
  format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
    policyname, schemaname, tablename, permissive, cmd,
    (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
      FROM unnest(roles) AS r),
    CASE WHEN qual IS NULL THEN '' ELSE format(' USING (%s)', qual) END,
    CASE WHEN with_check IS NULL THEN '' ELSE format(' WITH CHECK (%s)', with_check) END) AS restore_sql
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'User'
  AND policyname IN ('fetch_customer_insert','fetch_rider_insert','fetch_runtime_update');

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT remove_sql FROM staff_role_policies LOOP
    EXECUTE p.remove_sql;
  END LOOP;
END $$;

DROP TRIGGER "User_role_immutable" ON "User";
ALTER TABLE "User" ALTER COLUMN role DROP DEFAULT;
ALTER TABLE "SupportMessage" ALTER COLUMN "authorRole" DROP DEFAULT;
ALTER TABLE "User" DROP CONSTRAINT "User_active_role_check";

ALTER TYPE "UserRole" RENAME TO "UserRole_before_staff_retirement";
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER','RIDER','ADMIN','SUPPORT','SAFETY','SUPERADMIN');

ALTER TABLE "User" ALTER COLUMN role TYPE "UserRole" USING role::text::"UserRole";
ALTER TABLE "SupportMessage" ALTER COLUMN "authorRole" TYPE "UserRole" USING "authorRole"::text::"UserRole";
ALTER TABLE "BookingEvent" ALTER COLUMN "actorRole" TYPE "UserRole" USING "actorRole"::text::"UserRole";
ALTER TABLE "PaymentEvent" ALTER COLUMN "actorRole" TYPE "UserRole" USING "actorRole"::text::"UserRole";

ALTER TABLE "User" ALTER COLUMN role SET DEFAULT 'CUSTOMER';
ALTER TABLE "SupportMessage" ALTER COLUMN "authorRole" SET DEFAULT 'ADMIN';
CREATE TRIGGER "User_role_immutable" BEFORE UPDATE OF role ON "User"
FOR EACH ROW EXECUTE FUNCTION fetch_account_role_immutable();

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT restore_sql FROM staff_role_policies LOOP
    EXECUTE p.restore_sql;
  END LOOP;
END $$;

DROP TYPE "UserRole_before_staff_retirement";

COMMIT;

