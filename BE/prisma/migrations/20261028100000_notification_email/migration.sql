CREATE TABLE "notification_email_jobs" (
 "notificationId" BIGINT PRIMARY KEY REFERENCES notifications(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 provider VARCHAR(8) NOT NULL, "fromEmail" VARCHAR(254) NOT NULL, "toEmail" VARCHAR(254) NOT NULL,
 subject VARCHAR(200) NOT NULL, "bodyText" VARCHAR(1000) NOT NULL,
 "payloadHash" CHAR(64) NOT NULL, "configFingerprint" CHAR(64) NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'QUEUED', attempts INTEGER NOT NULL DEFAULT 0,
 "leaseId" UUID, "leaseUntil" TIMESTAMP(3), "firstDispatchAt" TIMESTAMP(3), "attemptStartedAt" TIMESTAMP(3),
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "acceptedAt" TIMESTAMP(3), "providerMessageId" VARCHAR(128), "lastCode" VARCHAR(40),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT notification_email_job_shape CHECK (
  provider IN('resend','mailpit') AND status IN('QUEUED','LEASED','RETRY_WAIT','ACCEPTED_BY_PROVIDER','SUPPRESSED','UNKNOWN','FAILED') AND attempts BETWEEN 0 AND 5 AND
  "payloadHash" ~ '^[0-9a-f]{64}$' AND "configFingerprint" ~ '^[0-9a-f]{64}$' AND
  ((status='LEASED')=("leaseId" IS NOT NULL AND "leaseUntil" IS NOT NULL)) AND
  (status='LEASED' OR ("leaseId" IS NULL AND "leaseUntil" IS NULL)) AND
  ((status='ACCEPTED_BY_PROVIDER')=("acceptedAt" IS NOT NULL AND "providerMessageId" IS NOT NULL)) AND
  (status='ACCEPTED_BY_PROVIDER' OR ("acceptedAt" IS NULL AND "providerMessageId" IS NULL)) AND
  ((attempts=0)=("firstDispatchAt" IS NULL)) AND
  ("attemptStartedAt" IS NULL OR ("firstDispatchAt" IS NOT NULL AND "attemptStartedAt">="firstDispatchAt")) AND
  ("acceptedAt" IS NULL OR ("firstDispatchAt" IS NOT NULL AND "acceptedAt">="firstDispatchAt"))
 )
);
CREATE INDEX notification_email_jobs_due_idx ON notification_email_jobs(status,"nextAttemptAt","notificationId");
CREATE FUNCTION notification_email_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'email dedupe tombstone is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status NOT IN('QUEUED','SUPPRESSED') OR NEW.attempts<>0 OR NOT EXISTS(SELECT 1 FROM notifications WHERE id=NEW."notificationId" AND channel='IN_APP' AND "sourceKind" IN('ORDER','STORE','PRODUCT','AFTERSALE')) THEN
   RAISE EXCEPTION 'invalid email source or initial state' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.status IN('ACCEPTED_BY_PROVIDER','SUPPRESSED','UNKNOWN','FAILED') OR
  ROW(NEW."notificationId",NEW.provider,NEW."fromEmail",NEW."toEmail",NEW.subject,NEW."bodyText",NEW."payloadHash",NEW."configFingerprint",NEW."createdAt") IS DISTINCT FROM
  ROW(OLD."notificationId",OLD.provider,OLD."fromEmail",OLD."toEmail",OLD.subject,OLD."bodyText",OLD."payloadHash",OLD."configFingerprint",OLD."createdAt") OR
  (OLD."firstDispatchAt" IS NOT NULL AND NEW."firstDispatchAt" IS DISTINCT FROM OLD."firstDispatchAt") THEN
   RAISE EXCEPTION 'email job identity or terminal state is immutable' USING ERRCODE='23514';
 END IF;
 IF (OLD.status IN('QUEUED','RETRY_WAIT') AND NEW.status<>'LEASED') OR
    (OLD.status='LEASED' AND NEW.status='QUEUED') OR
    NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR
    (NEW.attempts=OLD.attempts+1 AND (OLD.status<>'LEASED' OR NEW.status<>'LEASED' OR NEW."attemptStartedAt" IS NULL OR NEW."leaseId" IS DISTINCT FROM OLD."leaseId")) THEN
   RAISE EXCEPTION 'invalid email transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_email_job_guard BEFORE INSERT OR UPDATE OR DELETE ON notification_email_jobs FOR EACH ROW EXECUTE FUNCTION notification_email_job_guard();
