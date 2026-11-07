-- Snapshot the browser refresh-cookie digest for LOGIN too. Legacy NULL LOGIN
-- evidence remains immutable; the service refuses those pending challenges.
ALTER TABLE google_oauth_challenges DROP CONSTRAINT google_oauth_challenges_check;
ALTER TABLE google_oauth_challenges ADD CONSTRAINT google_oauth_challenge_shape
 CHECK((purpose='LOGIN' AND "actorId" IS NULL AND "credentialVersion" IS NULL
 AND ("sessionHash" IS NULL OR "sessionHash" ~ '^[a-f0-9]{64}$'))
 OR(purpose='LINK' AND "actorId" IS NOT NULL AND "credentialVersion" IS NOT NULL
 AND "credentialVersion">0 AND "sessionHash" IS NOT NULL AND "sessionHash" ~ '^[a-f0-9]{64}$'));
