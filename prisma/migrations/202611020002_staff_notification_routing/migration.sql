-- Additive event routing. Source writes and their notifications commit together.
ALTER TABLE "SupportTicket" ADD COLUMN "isEmergency" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkflowCase" ADD COLUMN "emergencyAt" TIMESTAMP(3), ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "StaffResource" ADD COLUMN "audienceRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE TABLE "StaffNotice" (
  "id" TEXT PRIMARY KEY, "channel" TEXT NOT NULL CHECK ("channel" IN ('PERSONAL','TEAM','GENERAL','PLATFORM')),
  "recipientId" TEXT, "recipientRole" TEXT, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "detail" TEXT NOT NULL, "urgent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("channel"='PERSONAL') = ("recipientId" IS NOT NULL))
);
CREATE INDEX "StaffNotice_channel_recipientId_createdAt_id_idx" ON "StaffNotice"("channel","recipientId","createdAt","id");
CREATE INDEX "StaffNotice_entityType_entityId_idx" ON "StaffNotice"("entityType","entityId");
CREATE TABLE "StaffNoticeRead" (
  "noticeId" TEXT NOT NULL REFERENCES "StaffNotice"("id") ON DELETE CASCADE,
  "actorId" TEXT NOT NULL, "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("noticeId","actorId")
);
CREATE TABLE "PlatformIncident" (
  "id" TEXT PRIMARY KEY, "category" TEXT NOT NULL, "scope" TEXT NOT NULL,
  "title" TEXT NOT NULL, "detail" TEXT NOT NULL, "severity" TEXT NOT NULL,
  "platformWide" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3)
);
CREATE TABLE "ServiceHealthBucket" (
  "service" TEXT NOT NULL, "minute" TIMESTAMP(3) NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0, "failures" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("service","minute")
);

CREATE FUNCTION public.fetch_staff_notice(k text, channel text, recipient text, role_name text,
  entity text, record_id text, headline text, description text, urgent boolean DEFAULT false)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  INSERT INTO public."StaffNotice"("id","channel","recipientId","recipientRole","entityType","entityId","title","detail","urgent")
  VALUES(k,channel,recipient,role_name,entity,record_id,left(headline,200),left(description,500),urgent)
  ON CONFLICT("id") DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.fetch_staff_notice(text,text,text,text,text,text,text,text,boolean) FROM PUBLIC;

CREATE FUNCTION public.fetch_route_support() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE token text;
BEGIN
  -- Explicit emergency source, never inferred from ordinary complaint keywords.
  IF NEW."isEmergency" THEN
    IF TG_OP='INSERT' THEN
      INSERT INTO public."WorkflowCase"("id","kind","title","summary","priority","status","bookingId","ticketId","subjectUserId","createdById","createdByName","emergencyAt","updatedAt")
      VALUES('emergency-'||md5(NEW.id),'SAFETY','Passenger requested immediate safety review',NEW.message,'URGENT','OPEN',NEW."bookingId",NEW.id,NEW."customerId",NEW."customerId",'Passenger safety alert',NEW."createdAt",CURRENT_TIMESTAMP);
    END IF;
    RETURN NEW;
  END IF;
  token := 'ticket:'||NEW.id||':'||extract(epoch from NEW."updatedAt")::text;
  IF NEW.status <> 'RESOLVED' AND NEW."assignedAdminId" IS NULL THEN
    PERFORM public.fetch_staff_notice(token||':intake','TEAM',NULL,'SUPPORT','SUPPORT',NEW.id,'Customer request awaiting assignment','Open this request to claim it or view it without taking ownership.');
  ELSIF NEW."assignedAdminId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."assignedAdminId" IS DISTINCT FROM OLD."assignedAdminId") THEN
    PERFORM public.fetch_staff_notice(token||':assigned','PERSONAL',NEW."assignedAdminId",NULL,'SUPPORT',NEW.id,'Customer request assigned to you','Review the conversation and respond to the customer.');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fetch_record_service_health(service_name text, failed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF service_name NOT IN ('ROAD_ROUTING','BOOKING_API') THEN RAISE EXCEPTION 'Unknown monitored service'; END IF;
  INSERT INTO public."ServiceHealthBucket"("service","minute","requests","failures")
  VALUES(service_name,date_trunc('minute',CURRENT_TIMESTAMP),1,CASE WHEN failed THEN 1 ELSE 0 END)
  ON CONFLICT("service","minute") DO UPDATE SET "requests"=LEAST("ServiceHealthBucket"."requests"+1,1000000),"failures"=LEAST("ServiceHealthBucket"."failures"+EXCLUDED."failures",1000000);
END $$;
REVOKE ALL ON FUNCTION public.fetch_record_service_health(text,boolean) FROM PUBLIC;

CREATE FUNCTION public.fetch_refresh_operational_signals() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE affected integer; s record; incident_key text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext(current_database()||current_schema()||'fetch-notification-monitor')) THEN RETURN; END IF;
  INSERT INTO public."ServiceHealthBucket"("service","minute") VALUES('MONITOR',date_trunc('minute',CURRENT_TIMESTAMP)) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected=0 THEN RETURN; END IF;
  -- A read is not acknowledgment. Escalate once to Admin if no reviewer took
  -- ownership after a minute, even when somebody marked the alert as read.
  FOR s IN SELECT id FROM public."WorkflowCase" WHERE "emergencyAt"<CURRENT_TIMESTAMP-INTERVAL '60 seconds' AND "acknowledgedAt" IS NULL AND status<>'RESOLVED' LOOP
    PERFORM public.fetch_staff_notice('emergency-backup:'||s.id,'TEAM',NULL,'ADMIN','CASE',s.id,'Safety alert has not been acknowledged','Take ownership or assign an available Safety reviewer immediately.',true);
  END LOOP;
  -- Require volume and failures in two separate minute buckets. Validation,
  -- authentication and rate-limit responses are never counted as outages.
  FOR s IN SELECT service,sum(requests) AS total,sum(failures) AS failed,count(*) FILTER(WHERE failures>0) AS failing_minutes
    FROM public."ServiceHealthBucket" WHERE service<>'MONITOR' AND minute>=CURRENT_TIMESTAMP-INTERVAL '5 minutes' GROUP BY service LOOP
    incident_key:='service:'||s.service;
    IF s.total>=20 AND s.failed>=10 AND s.failed::numeric/s.total>=0.5 AND s.failing_minutes>=2 THEN
      INSERT INTO public."PlatformIncident"(id,category,scope,title,detail,severity,"platformWide")
      VALUES(incident_key,'INFRASTRUCTURE','Fetch services',CASE s.service WHEN 'ROAD_ROUTING' THEN 'Road routing service is failing' ELSE 'Booking service is failing' END,
        'Repeated server failures are affecting requests. Review service logs and coordinate affected customer conversations.','CRITICAL',true)
      ON CONFLICT(id) DO UPDATE SET active=true,"resolvedAt"=NULL,revision="PlatformIncident".revision+1,"updatedAt"=CURRENT_TIMESTAMP WHERE NOT "PlatformIncident".active;
    ELSIF s.total>=10 AND s.failed=0 THEN
      UPDATE public."PlatformIncident" SET active=false,"resolvedAt"=CURRENT_TIMESTAMP,revision=revision+1,"updatedAt"=CURRENT_TIMESTAMP,
        detail='Recent requests are succeeding again. Review affected bookings and outstanding customer conversations.' WHERE id=incident_key AND active AND "updatedAt"<CURRENT_TIMESTAMP-INTERVAL '5 minutes';
    END IF;
  END LOOP;
  -- Geographic summaries use coarse 0.05-degree pickup grids, not addresses or
  -- individual customer locations. No inferred weather or merchant claims.
  FOR s IN SELECT floor("pickupLat"*20)/20 AS lat,floor("pickupLng"*20)/20 AS lng,count(*) AS total
    FROM public."Booking" WHERE status='PENDING' AND "riderId" IS NULL
      AND ("paymentMethod"='CASH' OR "paymentStatus"='PAID')
      AND greatest("createdAt",coalesce("scheduledAt","createdAt"))<CURRENT_TIMESTAMP-INTERVAL '5 minutes'
      AND greatest("createdAt",coalesce("scheduledAt","createdAt"))>CURRENT_TIMESTAMP-CASE WHEN type='RIDE' THEN INTERVAL '10 minutes' ELSE INTERVAL '30 minutes' END
    GROUP BY 1,2 HAVING count(*)>=10 LOOP
    incident_key:='backlog:'||s.lat||':'||s.lng;
    INSERT INTO public."PlatformIncident"(id,category,scope,title,detail,severity)
    VALUES(incident_key,'REGIONAL_BACKLOG','Pickup grid '||s.lat||', '||s.lng,'Unassigned bookings increasing in a pickup area',
      'At least 10 active requests in this pickup grid have waited over five minutes. Review rider availability and coordinate affected customer requests.','HIGH')
    ON CONFLICT(id) DO UPDATE SET active=true,"resolvedAt"=NULL,revision="PlatformIncident".revision+1,"updatedAt"=CURRENT_TIMESTAMP WHERE NOT "PlatformIncident".active;
  END LOOP;
  UPDATE public."PlatformIncident" i SET active=false,"resolvedAt"=CURRENT_TIMESTAMP,revision=revision+1,"updatedAt"=CURRENT_TIMESTAMP,
    detail='The active unassigned queue is below the alert threshold. Follow up with customers who were affected.'
    WHERE i.active AND i.category='REGIONAL_BACKLOG' AND (SELECT count(*) FROM public."Booking" b
      WHERE b.status='PENDING' AND b."riderId" IS NULL AND (b."paymentMethod"='CASH' OR b."paymentStatus"='PAID')
        AND i.id='backlog:'||(floor(b."pickupLat"*20)/20)||':'||(floor(b."pickupLng"*20)/20)
        AND greatest(b."createdAt",coalesce(b."scheduledAt",b."createdAt"))<CURRENT_TIMESTAMP-INTERVAL '5 minutes'
        AND greatest(b."createdAt",coalesce(b."scheduledAt",b."createdAt"))>CURRENT_TIMESTAMP-CASE WHEN b.type='RIDE' THEN INTERVAL '10 minutes' ELSE INTERVAL '30 minutes' END)<10;
  FOR s IN SELECT floor(b."pickupLat"*20)/20 AS lat,floor(b."pickupLng"*20)/20 AS lng,count(*) AS total
    FROM public."WorkflowCase" c JOIN public."Booking" b ON b.id=c."bookingId"
    WHERE c."emergencyAt">CURRENT_TIMESTAMP-INTERVAL '10 minutes' AND c.status<>'RESOLVED'
    GROUP BY 1,2 HAVING count(*)>=5 LOOP
    incident_key:='safety-volume:'||s.lat||':'||s.lng;
    INSERT INTO public."PlatformIncident"(id,category,scope,title,detail,severity,"platformWide")
    VALUES(incident_key,'SAFETY_PATTERN','Pickup grid '||s.lat||', '||s.lng,'Safety alert volume needs platform review',
      'At least five passenger safety alerts were reported in this pickup area within ten minutes. Coordinate Safety capacity and investigate possible links; a common cause is not confirmed.','CRITICAL',true)
    ON CONFLICT(id) DO UPDATE SET active=true,"resolvedAt"=NULL,revision="PlatformIncident".revision+1,"updatedAt"=CURRENT_TIMESTAMP WHERE NOT "PlatformIncident".active;
  END LOOP;
  DELETE FROM public."ServiceHealthBucket" WHERE minute<CURRENT_TIMESTAMP-INTERVAL '2 days';
  DELETE FROM public."StaffNotice" WHERE id IN (SELECT n.id FROM public."StaffNotice" n
    WHERE n."createdAt"<CURRENT_TIMESTAMP-INTERVAL '90 days'
      AND NOT EXISTS(SELECT 1 FROM public."WorkflowCase" c WHERE n."entityType"='CASE' AND c.id=n."entityId" AND c.status<>'RESOLVED')
      AND NOT EXISTS(SELECT 1 FROM public."SupportTicket" t WHERE n."entityType"='SUPPORT' AND t.id=n."entityId" AND t.status<>'RESOLVED')
      AND NOT EXISTS(SELECT 1 FROM public."RiderApplication" a WHERE n."entityType"='APPLICATION' AND a.id=n."entityId" AND a.status NOT IN ('ACTIVE','REJECTED','DEMO_COMPLETED'))
      AND NOT EXISTS(SELECT 1 FROM public."PlatformIncident" i WHERE n."entityType"='INCIDENT' AND i.id=n."entityId" AND i.active)
    LIMIT 1000);
END $$;
REVOKE ALL ON FUNCTION public.fetch_refresh_operational_signals() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['fetch_customer_runtime','fetch_rider_runtime','fetch_staff_runtime','fetch_owner_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.fetch_record_service_health(text,boolean) TO %I',r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['fetch_customer_runtime','fetch_staff_runtime','fetch_owner_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.fetch_refresh_operational_signals() TO %I',r);
    END IF;
  END LOOP;
END $$;
CREATE TRIGGER fetch_route_support AFTER INSERT OR UPDATE OF "assignedAdminId",status ON "SupportTicket" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_support();

CREATE FUNCTION public.fetch_route_support_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public."SupportTicket"; c public."WorkflowCase";
BEGIN
  IF NEW."authorRole" <> 'CUSTOMER' THEN RETURN NEW; END IF;
  SELECT * INTO t FROM public."SupportTicket" WHERE id=NEW."ticketId";
  IF t."isEmergency" THEN
    SELECT * INTO c FROM public."WorkflowCase" WHERE "ticketId"=t.id AND kind='SAFETY' AND status<>'RESOLVED' ORDER BY "createdAt" DESC LIMIT 1;
    IF c."assignedToId" IS NOT NULL THEN
      PERFORM public.fetch_staff_notice('message:'||NEW.id,'PERSONAL',c."assignedToId",NULL,'CASE',c.id,'Passenger added safety information','Review the new message in the linked conversation.',true);
    END IF;
  ELSIF t."assignedAdminId" IS NOT NULL THEN
    PERFORM public.fetch_staff_notice('message:'||NEW.id,'PERSONAL',t."assignedAdminId",NULL,'SUPPORT',t.id,'Customer replied','Review the latest message and respond in the conversation.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_route_support_message AFTER INSERT ON "SupportMessage" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_support_message();

CREATE FUNCTION public.fetch_acknowledge_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."emergencyAt" IS NOT NULL AND NEW."assignedToId" IS NOT NULL AND NEW."acknowledgedAt" IS NULL THEN NEW."acknowledgedAt"=CURRENT_TIMESTAMP; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_acknowledge_review BEFORE INSERT OR UPDATE ON "WorkflowCase" FOR EACH ROW EXECUTE FUNCTION public.fetch_acknowledge_review();

CREATE FUNCTION public.fetch_route_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE token text; reviewer_role text;
BEGIN
  token:='case:'||NEW.id||':'||NEW.version;
  reviewer_role:=CASE NEW.kind WHEN 'SAFETY' THEN 'SAFETY' WHEN 'ESCALATION' THEN 'SUPPORT_SUPERVISOR' ELSE 'ADMIN' END;
  IF NEW.status IN ('OPEN','IN_REVIEW') AND NEW."assignedToId" IS NULL THEN
    PERFORM public.fetch_staff_notice(token||':team','TEAM',NULL,reviewer_role,'CASE',NEW.id,CASE WHEN NEW."emergencyAt" IS NOT NULL THEN 'Immediate safety review needed' ELSE 'New '||CASE NEW.kind WHEN 'SAFETY' THEN 'Safety review' WHEN 'ESCALATION' THEN 'Supervisor help request' ELSE 'Admin financial review' END END,'Review the linked request and take ownership to start work.',NEW."emergencyAt" IS NOT NULL);
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
CREATE TRIGGER fetch_route_review AFTER INSERT OR UPDATE ON "WorkflowCase" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_review();

CREATE FUNCTION public.fetch_route_note() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public."WorkflowCase";
BEGIN
  SELECT * INTO c FROM public."WorkflowCase" WHERE id=NEW."caseId";
  IF c.status<>'RESOLVED' AND c."assignedToId" IS NOT NULL AND c."assignedToId"<>NEW."authorId" THEN
    PERFORM public.fetch_staff_notice('note:'||NEW.id,'PERSONAL',c."assignedToId",NULL,'CASE',c.id,'New supporting information','Review the internal update in your assigned case.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_route_note AFTER INSERT ON "WorkflowNote" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_note();

CREATE FUNCTION public.fetch_route_application() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE token text;
BEGIN
  token:='application:'||NEW.id||':'||NEW.version;
  IF NEW.status IN ('SUBMITTED','IN_REVIEW') THEN
    PERFORM public.fetch_staff_notice(token,CASE WHEN NEW."assignedToId" IS NULL THEN 'TEAM' ELSE 'PERSONAL' END,NEW."assignedToId",CASE WHEN NEW."assignedToId" IS NULL THEN 'SAFETY' ELSE NULL END,'APPLICATION',NEW.id,'Rider application needs review','Review the declared services and documents using the application review workflow.');
  ELSIF NEW.status='FORCE_APPROVAL_PENDING' THEN
    PERFORM public.fetch_staff_notice(token,'TEAM',NULL,'ADMIN','APPLICATION',NEW.id,'Application exception needs a decision','An eligible independent Admin must review this exception.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_route_application AFTER INSERT OR UPDATE OF status,"assignedToId" ON "RiderApplication" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_application();

CREATE FUNCTION public.fetch_route_resource() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text;
BEGIN
  IF NEW.kind='ANNOUNCEMENT' THEN
    FOREACH r IN ARRAY CASE WHEN cardinality(NEW."audienceRoles")>0 THEN NEW."audienceRoles" ELSE ARRAY['ADMIN','SUPPORT','SUPPORT_SUPERVISOR','SAFETY'] END LOOP
      IF r IN ('ADMIN','SUPPORT','SUPPORT_SUPERVISOR','SAFETY') THEN
        PERFORM public.fetch_staff_notice('announcement:'||NEW.id||':'||NEW.version||':'||r,'GENERAL',NULL,r,'RESOURCE',NEW.id,'Updated guidance: '||NEW.title,'Read the announcement before handling affected requests.');
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_route_resource AFTER INSERT OR UPDATE ON "StaffResource" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_resource();

CREATE FUNCTION public.fetch_route_security() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE recipient text; owner_event boolean;
BEGIN
  owner_event:=TG_TABLE_NAME='OwnerAudit';
  IF owner_event THEN SELECT "actorId" INTO recipient FROM public."OwnerIdentity" WHERE id=NEW."entityId"; ELSE recipient:=NEW."entityId"; END IF;
  IF recipient IS NOT NULL AND NEW.action IN ('LOGIN_SUCCEEDED','PASSWORD_RESET','OWNER_PASSWORD_SIGN_IN','OWNER_PASSWORD_CHANGED','OWNER_PASSWORD_RESET','OWNER_PASSWORD_SET') THEN
    PERFORM public.fetch_staff_notice('security:'||TG_TABLE_NAME||':'||NEW.id,'PERSONAL',recipient,CASE WHEN owner_event THEN 'SUPERADMIN' ELSE NULL END,'SECURITY',recipient,CASE WHEN NEW.action IN ('LOGIN_SUCCEEDED','OWNER_PASSWORD_SIGN_IN') THEN 'Your account signed in' ELSE 'Your password changed' END,'Review account access if you do not recognize this activity. No password or recovery code is included.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_route_staff_security AFTER INSERT ON "AdminAudit" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_security();
CREATE TRIGGER fetch_route_owner_security AFTER INSERT ON "OwnerAudit" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_security();

CREATE FUNCTION public.fetch_route_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW."paymentMethod"='CASH' AND NEW."paymentStatus"='PENDING' AND NEW."customerPaidAmount" IS NOT NULL AND NEW."riderReceivedAmount" IS NOT NULL
    AND (NEW."customerPaidAmount"<>NEW."totalFare" OR NEW."riderReceivedAmount"<>NEW."totalFare") THEN
    PERFORM public.fetch_staff_notice('cash:'||NEW.id||':'||extract(epoch from NEW."updatedAt")::text,'TEAM',NULL,'ADMIN','PAYMENT',NEW.id,'Cash payment needs review','The customer and rider confirmations do not match the recorded fare. Review the evidence before changing the payment record.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_route_payment AFTER INSERT OR UPDATE OF "customerPaidAmount","riderReceivedAmount","paymentStatus" ON "Booking" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_payment();

CREATE FUNCTION public.fetch_route_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE recipient text; owner_event boolean;
BEGIN
  IF NEW."revokedAt" IS NULL OR OLD."revokedAt" IS NOT NULL THEN RETURN NEW; END IF;
  owner_event:=TG_TABLE_NAME='OwnerSession';
  IF owner_event THEN SELECT "actorId" INTO recipient FROM public."OwnerIdentity" WHERE id=NEW."ownerId"; ELSE recipient:=NEW."userId"; END IF;
  IF recipient IS NOT NULL THEN
    PERFORM public.fetch_staff_notice('session:'||NEW.id,'PERSONAL',recipient,CASE WHEN owner_event THEN 'SUPERADMIN' ELSE NULL END,'SECURITY',recipient,'A sign-in session was ended','A session on your account was revoked. Review your remaining sessions if you do not recognize this change.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_route_staff_session AFTER UPDATE OF "revokedAt" ON "StaffSession" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_session();
CREATE TRIGGER fetch_route_owner_session AFTER UPDATE OF "revokedAt" ON "OwnerSession" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_session();

CREATE FUNCTION public.fetch_route_incident() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
    PERFORM public.fetch_staff_notice('incident:'||NEW.id||':'||NEW.revision||':supervisor','TEAM',NULL,'SUPPORT_SUPERVISOR','INCIDENT',NEW.id,'Coordinate affected customer requests',NEW.title||'. Review the operational advisory and team workload.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fetch_route_incident AFTER INSERT OR UPDATE ON "PlatformIncident" FOR EACH ROW EXECUTE FUNCTION public.fetch_route_incident();

-- Backfill open work, not the full historical audit stream. Preserve existing
-- priorities and ownership; legacy explicit emergency records gain a Safety case.
UPDATE "SupportTicket" SET "isEmergency"=true WHERE priority='URGENT' AND status<>'RESOLVED' AND (message LIKE E'URGENT SAFETY ALERT\n%' OR message LIKE E'SOS EMERGENCY ALERT\n%');
INSERT INTO "WorkflowCase"("id","kind","title","summary","priority","status","bookingId","ticketId","subjectUserId","createdById","createdByName","emergencyAt","updatedAt")
SELECT 'emergency-'||md5(t.id),'SAFETY','Passenger requested immediate safety review',t.message,'URGENT','OPEN',t."bookingId",t.id,t."customerId",t."customerId",'Passenger safety alert',t."createdAt",CURRENT_TIMESTAMP
FROM "SupportTicket" t WHERE t."isEmergency" AND NOT EXISTS(SELECT 1 FROM "WorkflowCase" c WHERE c."ticketId"=t.id AND c.kind='SAFETY' AND c.status<>'RESOLVED');
UPDATE "WorkflowCase" SET "emergencyAt"=t."createdAt" FROM "SupportTicket" t WHERE "WorkflowCase"."ticketId"=t.id AND t."isEmergency" AND "WorkflowCase".kind='SAFETY' AND "WorkflowCase".status<>'RESOLVED';
UPDATE "SupportTicket" SET status=status WHERE status<>'RESOLVED' AND NOT "isEmergency";
INSERT INTO "StaffNotice"(id,channel,"recipientId","entityType","entityId",title,detail)
SELECT 'backfill-support:'||id,'PERSONAL',"assignedAdminId",'SUPPORT',id,'Customer request awaits your reply','Review the latest unanswered message in your assigned conversation.'
FROM "SupportTicket" WHERE NOT "isEmergency" AND status<>'RESOLVED' AND "assignedAdminId" IS NOT NULL AND ("lastAdminReplyAt" IS NULL OR "lastCustomerMessageAt">"lastAdminReplyAt") ON CONFLICT DO NOTHING;
INSERT INTO "StaffNotice"(id,channel,"recipientId","entityType","entityId",title,detail)
SELECT 'backfill-case:'||id,'PERSONAL',"assignedToId",'CASE',id,'Your review is still open','Review its current status and the next permitted action.'
FROM "WorkflowCase" WHERE status<>'RESOLVED' AND "assignedToId" IS NOT NULL ON CONFLICT DO NOTHING;
UPDATE "Booking" SET "paymentStatus"="paymentStatus" WHERE "paymentMethod"='CASH' AND "paymentStatus"='PENDING' AND "customerPaidAmount" IS NOT NULL AND "riderReceivedAmount" IS NOT NULL;
UPDATE "WorkflowCase" SET version=version WHERE status<>'RESOLVED';
UPDATE "RiderApplication" SET status=status WHERE status IN ('SUBMITTED','IN_REVIEW','FORCE_APPROVAL_PENDING');

-- Runtime roles cannot manufacture staff notices or incidents. Source triggers
-- own insertion; monitor writes use separately granted, validated functions.
REVOKE ALL ON "StaffNotice","StaffNoticeRead","PlatformIncident","ServiceHealthBucket" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['fetch_staff_runtime','fetch_owner_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('GRANT SELECT ON public."StaffNotice",public."PlatformIncident",public."ServiceHealthBucket" TO %I',r);
      EXECUTE format('GRANT SELECT,INSERT ON public."StaffNoticeRead" TO %I',r);
    END IF;
  END LOOP;
END $$;
ALTER TABLE "StaffNotice" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fetch_staff_runtime') THEN
    CREATE POLICY staff_notice_read ON "StaffNotice" FOR SELECT TO fetch_staff_runtime USING("channel"<>'PLATFORM' AND coalesce("recipientRole",'')<>'SUPERADMIN');
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fetch_owner_runtime') THEN
    CREATE POLICY owner_notice_read ON "StaffNotice" FOR SELECT TO fetch_owner_runtime USING(true);
  END IF;
END $$;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fetch_owner_runtime') THEN
   GRANT SELECT,INSERT,UPDATE ON public."PlatformIncident" TO fetch_owner_runtime;
 END IF;
END $$;
