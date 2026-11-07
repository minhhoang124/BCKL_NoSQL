-- New Web commands can be closed before delayed delivery. Existing audit is preserved.
CREATE TABLE "account_status_commands" (
  "id" BIGSERIAL PRIMARY KEY,
  "actorId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "commandId" VARCHAR(36) NOT NULL,
  "targetId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "expectedRevision" INTEGER NOT NULL,
  "desiredActive" BOOLEAN NOT NULL,
  "reasonDigest" VARCHAR(64) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(8) NOT NULL,
  "auditId" BIGINT UNIQUE REFERENCES account_status_history(id) ON DELETE RESTRICT,
  "receipt" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("actorId", "commandId"),
  CONSTRAINT account_status_command_shape CHECK (
    "commandId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND
    "expectedRevision" >= 1 AND "reasonDigest" ~ '^[0-9a-f]{64}$' AND "requestHash" ~ '^[0-9a-f]{64}$' AND
    ((outcome = 'CLOSED' AND "auditId" IS NULL AND receipt IS NULL) OR
     (outcome = 'NOOP' AND "auditId" IS NULL AND receipt IS NOT NULL AND jsonb_typeof(receipt) = 'object') OR
     (outcome = 'APPLIED' AND "auditId" IS NOT NULL AND receipt IS NOT NULL AND jsonb_typeof(receipt) = 'object')))
);
CREATE INDEX account_status_commands_target_created ON account_status_commands("targetId", "createdAt");
CREATE FUNCTION account_status_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Account status command is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER account_status_command_immutable BEFORE UPDATE OR DELETE ON account_status_commands
FOR EACH ROW EXECUTE FUNCTION account_status_command_immutable();
