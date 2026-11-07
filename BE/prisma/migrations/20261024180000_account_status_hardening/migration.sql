-- Additive rollout. No fabricated audit for existing account status.
ALTER TABLE "users" ADD COLUMN "statusRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "users" ADD CONSTRAINT "users_status_revision_positive" CHECK ("statusRevision" >= 1);
CREATE TABLE "account_status_history" (
  "id" BIGSERIAL PRIMARY KEY,
  "actorId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "targetId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "beforeActive" BOOLEAN NOT NULL,
  "afterActive" BOOLEAN NOT NULL,
  "fromRevision" INTEGER NOT NULL,
  "toRevision" INTEGER NOT NULL,
  "fromCredentialVersion" INTEGER NOT NULL,
  "toCredentialVersion" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_status_history_transition_check" CHECK (
    "beforeActive" <> "afterActive" AND "fromRevision" >= 1 AND
    "toRevision"::BIGINT = "fromRevision"::BIGINT + 1 AND
    "fromCredentialVersion" >= 1 AND
    "toCredentialVersion"::BIGINT = "fromCredentialVersion"::BIGINT + 1 AND
    char_length(btrim("reason")) BETWEEN 10 AND 500
  ),
  CONSTRAINT "account_status_history_target_revision_key" UNIQUE ("targetId", "toRevision")
);
CREATE FUNCTION account_status_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Account status audit is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER account_status_history_immutable BEFORE UPDATE OR DELETE ON "account_status_history"
FOR EACH ROW EXECUTE FUNCTION account_status_history_immutable();
