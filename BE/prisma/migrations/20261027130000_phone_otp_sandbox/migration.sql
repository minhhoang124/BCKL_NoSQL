CREATE TABLE phone_otp_challenges (
 id UUID PRIMARY KEY,
 "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "phoneNumber" VARCHAR(16) NOT NULL CHECK("phoneNumber" ~ '^\+[1-9][0-9]{7,14}$'),
 "codeHash" VARCHAR(64) NOT NULL CHECK("codeHash" ~ '^[a-f0-9]{64}$'),
 "credentialVersion" INTEGER NOT NULL CHECK("credentialVersion">0),
 "baseVersion" INTEGER NOT NULL CHECK("baseVersion" BETWEEN 0 AND 2147483646),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 "usedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "exhaustedAt" TIMESTAMP(3),
 "appliedVersion" INTEGER,
 CONSTRAINT phone_otp_terminal_shape CHECK(
  num_nonnulls("usedAt","revokedAt","exhaustedAt")<=1
  AND (("usedAt" IS NULL AND "appliedVersion" IS NULL) OR
       ("usedAt" IS NOT NULL AND "appliedVersion" IS NOT NULL AND "appliedVersion"="baseVersion"+1 AND attempts<5))
  AND ((attempts=5 AND "exhaustedAt" IS NOT NULL) OR (attempts<5 AND "exhaustedAt" IS NULL))),
 CONSTRAINT phone_otp_dates CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+INTERVAL '5 minutes'
  AND ("usedAt" IS NULL OR ("usedAt">="createdAt" AND "usedAt"<"expiresAt"))
  AND ("revokedAt" IS NULL OR "revokedAt">="createdAt")
  AND ("exhaustedAt" IS NULL OR "exhaustedAt">="createdAt"))
);
CREATE INDEX "phone_otp_challenges_userId_createdAt_idx" ON phone_otp_challenges("userId","createdAt");
CREATE TABLE user_phone_contacts (
 "userId" INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "phoneNumber" VARCHAR(16) NOT NULL CHECK("phoneNumber" ~ '^\+[1-9][0-9]{7,14}$'),
 channel VARCHAR(8) NOT NULL DEFAULT 'SANDBOX' CHECK(channel='SANDBOX'),
 version INTEGER NOT NULL CHECK(version>0),
 "lastChallengeId" UUID NOT NULL UNIQUE REFERENCES phone_otp_challenges(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "sandboxConfirmedAt" TIMESTAMP(3) NOT NULL
);
-- Sandbox contacts are not login identities and never reserve a number globally.
CREATE INDEX "user_phone_contacts_phoneNumber_idx" ON user_phone_contacts("phoneNumber");
CREATE TABLE phone_otp_rates (
 key VARCHAR(64) PRIMARY KEY CHECK(key ~ '^[a-f0-9]{64}$'),
 "windowStartedAt" TIMESTAMP(3) NOT NULL,
 count INTEGER NOT NULL CHECK(count BETWEEN 0 AND 1000000)
);
CREATE FUNCTION phone_otp_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OTP evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'attempts'-'usedAt'-'revokedAt'-'exhaustedAt'-'appliedVersion') IS DISTINCT FROM
    (to_jsonb(OLD)-'attempts'-'usedAt'-'revokedAt'-'exhaustedAt'-'appliedVersion')
 OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1
 OR ((OLD."usedAt" IS NOT NULL OR OLD."revokedAt" IS NOT NULL OR OLD."exhaustedAt" IS NOT NULL) AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'OTP payload immutable and terminal evidence cannot reopen' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phone_otp_evidence_guard BEFORE UPDATE OR DELETE ON phone_otp_challenges
 FOR EACH ROW EXECUTE FUNCTION phone_otp_evidence_guard();
CREATE FUNCTION phone_contact_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence phone_otp_challenges;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Contact version cannot be reset' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."userId"<>OLD."userId" OR OLD.version=2147483647 OR NEW.version<>OLD.version+1)
 THEN RAISE EXCEPTION 'Contact revision must advance once' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.version<>1 THEN RAISE EXCEPTION 'Initial contact revision must be one' USING ERRCODE='23514'; END IF;
 SELECT * INTO evidence FROM phone_otp_challenges WHERE id=NEW."lastChallengeId";
 IF NOT FOUND OR evidence."userId"<>NEW."userId" OR evidence."usedAt" IS NULL
 OR evidence."phoneNumber"<>NEW."phoneNumber" OR evidence."appliedVersion"<>NEW.version
 OR evidence."usedAt"<>NEW."sandboxConfirmedAt"
 THEN RAISE EXCEPTION 'Contact must match the consumed own challenge' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER phone_contact_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON user_phone_contacts
 FOR EACH ROW EXECUTE FUNCTION phone_contact_evidence_guard();
