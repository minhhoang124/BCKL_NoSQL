-- Additive rollout. Legacy email ownership is NOT inferred from an existing account.
ALTER TABLE users ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE account_security_events DROP CONSTRAINT account_security_event_kind;
ALTER TABLE account_security_events ADD CONSTRAINT account_security_event_kind
 CHECK(event IN ('PASSWORD_CHANGED','SELLER_GRANTED','PASSWORD_RESET'));
CREATE TABLE auth_email_tokens (
 id UUID PRIMARY KEY,
 "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 purpose VARCHAR(20) NOT NULL CHECK(purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')),
 "tokenHash" VARCHAR(64) NOT NULL UNIQUE CHECK("tokenHash" ~ '^[a-f0-9]{64}$'),
 email VARCHAR(254) NOT NULL,
 "credentialVersion" INTEGER NOT NULL CHECK("credentialVersion">0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "usedAt" TIMESTAMP(3),
 "revokedAt" TIMESTAMP(3),
 CONSTRAINT auth_email_token_dates CHECK("expiresAt">"createdAt" AND
  ("usedAt" IS NULL OR "usedAt">="createdAt") AND
  ("revokedAt" IS NULL OR "revokedAt">="createdAt") AND
  NOT("usedAt" IS NOT NULL AND "revokedAt" IS NOT NULL))
);
CREATE INDEX "auth_email_tokens_userId_purpose_expiresAt_idx" ON auth_email_tokens("userId",purpose,"expiresAt");
-- Several bounded issued links can coexist. Anonymous re-request cannot kill an older valid link.
CREATE TABLE auth_email_rates (
 key VARCHAR(64) PRIMARY KEY CHECK(key ~ '^[a-f0-9]{64}$'),
 "windowStartedAt" TIMESTAMP(3) NOT NULL,
 count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 1000000)
);
CREATE FUNCTION auth_email_token_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Auth email evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'usedAt'-'revokedAt') IS DISTINCT FROM (to_jsonb(OLD)-'usedAt'-'revokedAt')
 OR (OLD."usedAt" IS NOT NULL AND NEW."usedAt" IS DISTINCT FROM OLD."usedAt")
 OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")
 THEN RAISE EXCEPTION 'Auth email identity is immutable and terminal state cannot be reversed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER auth_email_token_evidence_guard BEFORE UPDATE OR DELETE ON auth_email_tokens
 FOR EACH ROW EXECUTE FUNCTION auth_email_token_evidence_guard();
