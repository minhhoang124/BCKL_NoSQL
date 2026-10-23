-- Additive rollout: legacy JWTs are accepted only while this value remains 1.
-- Deploy on QA first. Do not enable password writes while old app replicas exist.
ALTER TABLE "users" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "users" ADD CONSTRAINT "users_credential_version_positive"
  CHECK ("credentialVersion" >= 1);
