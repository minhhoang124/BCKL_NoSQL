ALTER TABLE account_security_events DROP CONSTRAINT account_security_event_kind;
ALTER TABLE account_security_events ADD CONSTRAINT account_security_event_kind
 CHECK(event IN ('PASSWORD_CHANGED','SELLER_GRANTED','PASSWORD_RESET','GOOGLE_LINKED'));
CREATE TABLE google_identities (
 id UUID PRIMARY KEY,
 "userId" INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 provider VARCHAR(12) NOT NULL DEFAULT 'GOOGLE' CHECK(provider='GOOGLE'),
 subject VARCHAR(255) NOT NULL CHECK(subject ~ '^[A-Za-z0-9_-]{1,255}$'),
 "emailSnapshot" VARCHAR(254) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(provider,subject)
);
CREATE TABLE google_oauth_challenges (
 id UUID PRIMARY KEY,
 "stateHash" VARCHAR(64) NOT NULL UNIQUE CHECK("stateHash" ~ '^[a-f0-9]{64}$'),
 "proofHash" VARCHAR(64) NOT NULL CHECK("proofHash" ~ '^[a-f0-9]{64}$'),
 "nonceHash" VARCHAR(64) NOT NULL CHECK("nonceHash" ~ '^[a-f0-9]{64}$'),
 purpose VARCHAR(8) NOT NULL CHECK(purpose IN ('LOGIN','LINK')),
 "actorId" INTEGER REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "credentialVersion" INTEGER,
 "sessionHash" VARCHAR(64),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "claimedAt" TIMESTAMP(3),
 "completedAt" TIMESTAMP(3),
 CHECK((purpose='LOGIN' AND "actorId" IS NULL AND "credentialVersion" IS NULL AND "sessionHash" IS NULL)
 OR(purpose='LINK' AND "actorId" IS NOT NULL AND "credentialVersion">0 AND "sessionHash" ~ '^[a-f0-9]{64}$')),
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+INTERVAL '10 minutes'
 AND ("claimedAt" IS NULL OR "claimedAt">="createdAt")
 AND ("completedAt" IS NULL OR ("claimedAt" IS NOT NULL AND "completedAt">="claimedAt")))
);
CREATE INDEX "google_oauth_challenges_expiresAt_idx" ON google_oauth_challenges("expiresAt");
CREATE FUNCTION google_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Google identity ownership is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER google_identity_immutable BEFORE UPDATE OR DELETE ON google_identities
 FOR EACH ROW EXECUTE FUNCTION google_identity_immutable();
CREATE FUNCTION google_challenge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OAuth challenge evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'claimedAt'-'completedAt') IS DISTINCT FROM (to_jsonb(OLD)-'claimedAt'-'completedAt')
 OR (OLD."claimedAt" IS NOT NULL AND NEW."claimedAt" IS DISTINCT FROM OLD."claimedAt")
 OR (OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt")
 THEN RAISE EXCEPTION 'OAuth challenge is immutable and single-use' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER google_challenge_guard BEFORE UPDATE OR DELETE ON google_oauth_challenges
 FOR EACH ROW EXECUTE FUNCTION google_challenge_guard();
