-- Retire the supervisor workflow while preserving the customer and payment records
-- it previously pointed to. FINANCE is still a case kind for Admin payment review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

LOCK TABLE "User", "SupportTicket", "WorkflowCase" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE retired_staff ON COMMIT DROP AS
SELECT id, email, name FROM "User" WHERE role::text IN ('SUPPORT_SUPERVISOR','FINANCE');

CREATE TEMP TABLE retired_cases ON COMMIT DROP AS
SELECT c.* FROM "WorkflowCase" c
WHERE c.kind = 'ESCALATION'
   OR (c.kind = 'FINANCE' AND c.id ~ '^team_activity_20261029_v1_case_finance_[0-9]+$'
       AND c."bookingId" IS NULL
       AND EXISTS (
         SELECT 1 FROM "SupportTicket" t WHERE t.id = c."ticketId"
         AND t.id ~ '^team_activity_20261029_v1_ticket_[0-9]+$' AND t."bookingId" IS NULL
       ));

CREATE TEMP TABLE surviving_admin ON COMMIT DROP AS
SELECT u.id, u.name FROM "User" u
WHERE u.role = 'ADMIN' AND NOT u."isBanned"
AND EXISTS (SELECT 1 FROM "AuthIdentity" a WHERE a."userId" = u.id AND a.provider = 'PASSWORD')
ORDER BY u."createdAt", u.id LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM surviving_admin) THEN
    RAISE EXCEPTION 'An active Admin is required for support handoff';
  END IF;
  IF EXISTS (
    SELECT 1 FROM retired_cases c WHERE c.kind = 'ESCALATION' AND c.status <> 'RESOLVED'
    AND NOT EXISTS (SELECT 1 FROM "SupportTicket" t WHERE t.id = c."ticketId"
      AND t.status <> 'RESOLVED' AND NOT t."isEmergency")
  ) THEN
    RAISE EXCEPTION 'A pending support review requires manual handoff';
  END IF;
  IF EXISTS (SELECT 1 FROM "BookingEvent" WHERE "actorId" IN (SELECT id FROM retired_staff)
      OR "actorRole"::text IN ('SUPPORT_SUPERVISOR','FINANCE'))
     OR EXISTS (SELECT 1 FROM "PaymentEvent" WHERE "actorId" IN (SELECT id FROM retired_staff)
      OR "actorRole"::text IN ('SUPPORT_SUPERVISOR','FINANCE'))
     OR EXISTS (SELECT 1 FROM "Booking" WHERE "customerId" IN (SELECT id FROM retired_staff)
      OR "riderId" IN (SELECT id FROM retired_staff))
     OR EXISTS (SELECT 1 FROM "RiderApplication" WHERE "userId" IN (SELECT id FROM retired_staff))
     OR EXISTS (SELECT 1 FROM "RiderProfile" WHERE "userId" IN (SELECT id FROM retired_staff)) THEN
    RAISE EXCEPTION 'A retired staff record has live booking, payment, or rider dependencies';
  END IF;
END $$;

CREATE FUNCTION pg_temp.without_retired_labels(input text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(input, '\m(support[ _]supervisor|the supervisor|supervisor help)\M', 'Support team', 'gi'),
        '\mFinance (review|staff)\M', 'payment review', 'gi'),
      'Why do you need Support team\?', 'Follow-up needed', 'gi'),
    '\mBefore escalating\M', 'Before sending a handoff', 'gi');
$$;

-- Preserve actionable follow-up only, as internal ticket notes. These rows do not send messages.
INSERT INTO "SupportInternalNote" (id,"ticketId","authorId","authorName",body,"createdAt")
SELECT 'support-follow-up:'||md5(c.id), c."ticketId", admin.id, 'Support team',
  pg_temp.without_retired_labels(concat_ws(E'\n\n',
    'Follow-up needed: ' || c.title, nullif(c.summary,''),
    'Recorded findings: ' || nullif(c.recommendation,''),
    'Recorded decision: ' || nullif(c.decision,''),
    (SELECT string_agg(n.body, E'\n\n' ORDER BY n."createdAt",n.id)
      FROM "WorkflowNote" n WHERE n."caseId" = c.id))), c."updatedAt"
FROM retired_cases c CROSS JOIN surviving_admin admin
WHERE c.kind = 'ESCALATION' AND c.status <> 'RESOLVED';

CREATE OR REPLACE FUNCTION fetch_account_role_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" <> OLD."role" AND NOT (
    OLD."role"::text IN ('ADMIN','SUPPORT','SAFETY') AND
    NEW."role"::text IN ('ADMIN','SUPPORT','SAFETY')
  ) THEN
    RAISE EXCEPTION 'Create a separate account for this role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fetch_support_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."customerId" AND "role"::text = 'CUSTOMER') THEN
    RAISE EXCEPTION 'Support request must belong to a CUSTOMER' USING ERRCODE = '23514';
  END IF;
  IF NEW."bookingId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Booking" WHERE "id" = NEW."bookingId" AND "customerId" = NEW."customerId"
  ) THEN
    RAISE EXCEPTION 'Support request must belong to the booking customer' USING ERRCODE = '23514';
  END IF;
  IF NEW."assignedAdminId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "id" = NEW."assignedAdminId" AND "role"::text IN ('ADMIN','SUPPORT','SUPERADMIN') AND NOT "isBanned"
  ) THEN
    RAISE EXCEPTION 'Choose an active support assignee' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fetch_route_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE token text; reviewer_role text;
BEGIN
  token:='case:'||NEW.id||':'||NEW.version;
  reviewer_role:=CASE NEW.kind WHEN 'SAFETY' THEN 'SAFETY' ELSE 'ADMIN' END;
  IF NEW.status IN ('OPEN','IN_REVIEW') AND NEW."assignedToId" IS NULL THEN
    PERFORM public.fetch_staff_notice(token||':team','TEAM',NULL,reviewer_role,'CASE',NEW.id,CASE WHEN NEW."emergencyAt" IS NOT NULL THEN 'Immediate safety review needed' ELSE 'New '||CASE NEW.kind WHEN 'SAFETY' THEN 'Safety review' ELSE 'payment review' END END,'Review the linked request and take ownership to start work.',NEW."emergencyAt" IS NOT NULL);
  END IF;
  IF NEW."assignedToId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."assignedToId" IS DISTINCT FROM OLD."assignedToId") THEN
    PERFORM public.fetch_staff_notice(token||':assigned','PERSONAL',NEW."assignedToId",NULL,'CASE',NEW.id,'Review assigned to you','Review the request, supporting facts, and next action.',NEW."emergencyAt" IS NOT NULL);
  END IF;
  IF NEW.status='AWAITING_ADMIN' THEN
    PERFORM public.fetch_staff_notice(token||':decision','TEAM',NULL,'ADMIN','CASE',NEW.id,'Independent Admin decision needed','Review the recommendation. The requester and assigned reviewer cannot approve it.');
  END IF;
  IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('AWAITING_ADMIN','APPROVED','REJECTED','RESOLVED') THEN
    IF NEW."createdById"<>coalesce(NEW."assignedToId",'') THEN
      PERFORM public.fetch_staff_notice(token||':origin','PERSONAL',NEW."createdById",NULL,'CASE',NEW.id,'Your handoff was updated','Review its current status and continue the customer conversation. Completing the review does not resolve the customer request.');
    END IF;
    IF NEW."assignedToId" IS NOT NULL THEN
      PERFORM public.fetch_staff_notice(token||':reviewer','PERSONAL',NEW."assignedToId",NULL,'CASE',NEW.id,CASE NEW.status WHEN 'APPROVED' THEN 'Admin approved the recommendation' WHEN 'REJECTED' THEN 'Admin returned the recommendation' WHEN 'RESOLVED' THEN 'Review resolved' ELSE 'Recommendation sent for decision' END,'Open the review for the decision and next permitted action.');
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fetch_route_resource() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text;
BEGIN
  IF NEW.kind='ANNOUNCEMENT' THEN
    FOREACH r IN ARRAY CASE WHEN cardinality(NEW."audienceRoles")>0 THEN NEW."audienceRoles" ELSE ARRAY['ADMIN','SUPPORT','SAFETY'] END LOOP
      IF r IN ('ADMIN','SUPPORT','SAFETY') THEN
        PERFORM public.fetch_staff_notice('announcement:'||NEW.id||':'||NEW.version||':'||r,'GENERAL',NULL,r,'RESOURCE',NEW.id,'Updated guidance: '||NEW.title,'Read the announcement before handling affected requests.');
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fetch_route_incident() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.active=OLD.active AND NEW.title=OLD.title AND NEW.detail=OLD.detail THEN RETURN NEW; END IF;
  IF NEW."platformWide" THEN
    PERFORM public.fetch_staff_notice('incident:'||NEW.id||':'||NEW.revision||':platform','PLATFORM',NULL,NULL,'INCIDENT',NEW.id,CASE WHEN NEW.active THEN NEW.title ELSE 'Recovered: '||NEW.title END,NEW.detail,NEW.active AND NEW.severity='CRITICAL');
  END IF;
  PERFORM public.fetch_staff_notice('incident:'||NEW.id||':'||NEW.revision||':general','GENERAL',NULL,NULL,'INCIDENT',NEW.id,CASE WHEN NEW.active THEN NEW.title ELSE 'Recovered: '||NEW.title END,NEW.detail);
  IF NEW.active AND NEW.category='SAFETY_PATTERN' THEN
    PERFORM public.fetch_staff_notice('incident:'||NEW.id||':'||NEW.revision||':safety','TEAM',NULL,'SAFETY','INCIDENT',NEW.id,'Review the linked safety alert pattern',NEW.detail,true);
  END IF;
  IF NEW.active THEN
    PERFORM public.fetch_staff_notice('incident:'||NEW.id||':'||NEW.revision||':support-admin','TEAM',NULL,'ADMIN','INCIDENT',NEW.id,'Coordinate affected customer requests',NEW.title||'. Review the operational advisory and team workload.');
  END IF;
  RETURN NEW;
END $$;

UPDATE "SupportTicket" t
SET "assignedAdminId" = CASE WHEN t.status = 'RESOLVED' THEN NULL ELSE admin.id END,
    "updatedAt" = clock_timestamp()
FROM surviving_admin admin
WHERE t."assignedAdminId" IN (SELECT id FROM retired_staff);

-- Remove retired-only notices and dependent receipts. StaffNoticeRead cascades from StaffNotice.
DELETE FROM "StaffNotice" n
WHERE n."recipientId" IN (SELECT id FROM retired_staff)
   OR n."recipientRole" IN ('SUPPORT_SUPERVISOR','FINANCE')
   OR (n."entityType" = 'CASE' AND n."entityId" IN (SELECT id FROM retired_cases));
DELETE FROM "StaffNoticeRead" WHERE "actorId" IN (SELECT id FROM retired_staff);

-- Purge audit rows about the removed records. Retain accountability on surviving work.
DELETE FROM "AdminAudit" a
WHERE (a."entityType" = 'CASE' AND a."entityId" IN (SELECT id FROM retired_cases))
   OR (a."entityType" = 'AUTH' AND a."actorId" IN (SELECT id FROM retired_staff))
   OR (a."entityType" = 'BOOKING' AND a."actorId" IN (SELECT id FROM retired_staff)
       AND a."entityId" ~ '^team_activity_20261029_v1_booking_[0-9]+$'
       AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b.id = a."entityId"));
DELETE FROM "OwnerAudit" a
WHERE a.action LIKE 'STAFF_%' AND a."entityId" IN (SELECT id FROM retired_staff);
UPDATE "AdminAudit" SET "actorId" = NULL, "actorName" = 'Former staff',
  details = details - 'actorRole'
WHERE "actorId" IN (SELECT id FROM retired_staff);
UPDATE "AdminAudit" SET details = jsonb_set(details,'{actorRole}','"Former staff"')
WHERE details->>'actorRole' IN ('SUPPORT_SUPERVISOR','FINANCE');

DELETE FROM "WorkflowNote" WHERE "caseId" IN (SELECT id FROM retired_cases);
DELETE FROM "WorkflowCase" WHERE id IN (SELECT id FROM retired_cases);

UPDATE "WorkflowCase" c SET
  "assignedToId" = CASE WHEN c."assignedToId" IN (SELECT id FROM retired_staff) THEN NULL ELSE c."assignedToId" END,
  "createdById" = CASE WHEN c."createdById" IN (SELECT id FROM retired_staff) THEN 'former-staff' ELSE c."createdById" END,
  "createdByName" = CASE WHEN c."createdById" IN (SELECT id FROM retired_staff) THEN 'Former staff' ELSE c."createdByName" END,
  "decidedById" = CASE WHEN c."decidedById" IN (SELECT id FROM retired_staff) THEN 'former-staff' ELSE c."decidedById" END
WHERE c."assignedToId" IN (SELECT id FROM retired_staff)
   OR c."createdById" IN (SELECT id FROM retired_staff)
   OR c."decidedById" IN (SELECT id FROM retired_staff);
UPDATE "WorkflowNote" SET "authorId" = 'former-staff', "authorName" = 'Former staff'
WHERE "authorId" IN (SELECT id FROM retired_staff);

UPDATE "SupportMessage" SET "authorId" = NULL, "authorName" = 'Support team', "authorRole" = 'SUPPORT'
WHERE "authorId" IN (SELECT id FROM retired_staff) OR "authorRole"::text IN ('SUPPORT_SUPERVISOR','FINANCE');
UPDATE "SupportMessage" SET body = regexp_replace(pg_temp.without_retired_labels(body), '\mFinance\M', 'Admin', 'gi')
WHERE "authorRole" <> 'CUSTOMER' AND body IS DISTINCT FROM regexp_replace(pg_temp.without_retired_labels(body), '\mFinance\M', 'Admin', 'gi');
UPDATE "SupportInternalNote" SET "authorId" = 'former-staff', "authorName" = 'Support team'
WHERE "authorId" IN (SELECT id FROM retired_staff);
UPDATE "SupportInternalNote" SET body = pg_temp.without_retired_labels(body)
WHERE body IS DISTINCT FROM pg_temp.without_retired_labels(body);

UPDATE "StaffResource" r SET
  "updatedById" = CASE WHEN r."updatedById" IN (SELECT id FROM retired_staff)
    THEN (SELECT id FROM surviving_admin) ELSE r."updatedById" END,
  "audienceRoles" = CASE WHEN cardinality(r."audienceRoles") > 0
    AND cardinality(array_remove(array_remove(r."audienceRoles",'SUPPORT_SUPERVISOR'),'FINANCE')) = 0
    THEN ARRAY['ADMIN'] ELSE array_remove(array_remove(r."audienceRoles",'SUPPORT_SUPERVISOR'),'FINANCE') END,
  title = replace(pg_temp.without_retired_labels(title),'Safety escalation coverage','Safety follow-up coverage'),
  body = pg_temp.without_retired_labels(body)
WHERE r."updatedById" IN (SELECT id FROM retired_staff)
   OR r."audienceRoles" && ARRAY['SUPPORT_SUPERVISOR','FINANCE']
   OR r.title = 'Safety escalation coverage'
   OR r.title IS DISTINCT FROM pg_temp.without_retired_labels(r.title)
   OR r.body IS DISTINCT FROM pg_temp.without_retired_labels(r.body);

-- The history keeps actions on retained accounts, but omits references to retired access.
UPDATE "OwnerAudit" SET details = regexp_replace(details::text,
  '"(SUPPORT_SUPERVISOR|FINANCE)"', '"Retired access"', 'g')::jsonb
WHERE details::text ~ '"(SUPPORT_SUPERVISOR|FINANCE)"';
UPDATE "AdminAudit" SET details = replace(details::text,'"SUPPORT_SUPERVISOR"','"Support team"')::jsonb
WHERE details::text LIKE '%"SUPPORT_SUPERVISOR"%';


-- Shared audit records still describe the action, with retired identities removed.
DO $$
DECLARE previous retired_staff%ROWTYPE;
BEGIN
  FOR previous IN SELECT * FROM retired_staff LOOP
    UPDATE "AdminAudit" SET details = replace(
      replace(details::text, to_json(previous.id)::text, '"Former staff"'),
      to_json(previous.email)::text, '"Former staff"')::jsonb
    WHERE details::text LIKE '%'||to_json(previous.id)::text||'%'
       OR details::text LIKE '%'||to_json(previous.email)::text||'%';
    UPDATE "OwnerAudit" SET details = replace(
      replace(details::text, to_json(previous.id)::text, '"Former staff"'),
      to_json(previous.email)::text, '"Former staff"')::jsonb
    WHERE details::text LIKE '%'||to_json(previous.id)::text||'%'
       OR details::text LIKE '%'||to_json(previous.email)::text||'%';
  END LOOP;
END $$;

DELETE FROM "StaffSession" WHERE "userId" IN (SELECT id FROM retired_staff);
DELETE FROM "AuthEmailCode" WHERE "subjectId" IN (SELECT id FROM retired_staff) OR email IN (SELECT email FROM retired_staff);
DELETE FROM "User" WHERE id IN (SELECT id FROM retired_staff);

-- Keep previously deployed apps compatible until the enum is contracted separately.
ALTER TABLE "User" ADD CONSTRAINT "User_active_role_check"
  CHECK (role::text IN ('CUSTOMER','RIDER','ADMIN','SUPPORT','SAFETY','SUPERADMIN'));
ALTER TABLE "WorkflowCase" ADD CONSTRAINT "WorkflowCase_active_kind_check"
  CHECK (kind IN ('SAFETY','FINANCE'));


DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE role::text IN ('SUPPORT_SUPERVISOR','FINANCE'))
     OR EXISTS (SELECT 1 FROM "WorkflowCase" WHERE kind = 'ESCALATION')
     OR EXISTS (SELECT 1 FROM "StaffNotice" WHERE "recipientRole" IN ('SUPPORT_SUPERVISOR','FINANCE'))
     OR EXISTS (SELECT 1 FROM "SupportMessage" WHERE "authorRole"::text IN ('SUPPORT_SUPERVISOR','FINANCE'))
     OR EXISTS (SELECT 1 FROM retired_cases c WHERE c.kind='ESCALATION' AND c.status<>'RESOLVED'
       AND NOT EXISTS (SELECT 1 FROM "SupportInternalNote" n WHERE n.id='support-follow-up:'||md5(c.id))) THEN
    RAISE EXCEPTION 'Retirement verification failed';
  END IF;
END $$;

COMMIT;

