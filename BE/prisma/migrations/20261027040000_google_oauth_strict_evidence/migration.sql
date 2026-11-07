-- Explicit non-null predicates: SQL CHECK also accepts UNKNOWN, so the shape
-- constraint must not rely on a nullable comparison alone for LINK evidence.
ALTER TABLE google_oauth_challenges ADD CONSTRAINT google_link_evidence_required
 CHECK(purpose<>'LINK' OR ("actorId" IS NOT NULL AND "credentialVersion" IS NOT NULL
 AND "sessionHash" IS NOT NULL));
ALTER TABLE google_oauth_challenges ADD CONSTRAINT google_claim_within_expiry
 CHECK(("claimedAt" IS NULL OR "claimedAt"<"expiresAt")
 AND ("completedAt" IS NULL OR "completedAt"<"expiresAt"));
