-- Expand only; no historical identity/reason guessing and no receipt rewrites.
BEGIN;
CREATE TABLE "order_command_resolutions" (
 "id" SERIAL PRIMARY KEY,
 "orderId" INTEGER NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "actorId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "actorType" "OrderActorType" NOT NULL,
 "actorScope" VARCHAR(64) NOT NULL,
 "idempotencyKey" VARCHAR(128) NOT NULL,
 "command" VARCHAR(32) NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL,
 "hashVersion" INTEGER NOT NULL,
 "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "order_resolution_identity_check" CHECK (
  "actorType" = 'SELLER' AND "actorScope" = 'USER:' || "actorId"::text
  AND "actorId" > 0 AND "orderId" > 0 AND "hashVersion" = 1
  AND "command" IN ('confirm','start-packing','ready-to-ship')
  AND "idempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$'
  AND "requestHash" ~ '^[0-9a-f]{64}$'
 )
);
CREATE UNIQUE INDEX "order_command_resolutions_actorScope_idempotencyKey_key"
 ON "order_command_resolutions"("actorScope","idempotencyKey");
CREATE INDEX "order_command_resolutions_orderId_resolvedAt_idx" ON "order_command_resolutions"("orderId","resolvedAt");
CREATE INDEX "order_command_resolutions_actorId_idx" ON "order_command_resolutions"("actorId");

-- Both opposite-table reads participate in SSI predicate tracking. A row lock
-- alone cannot cure an already-established transaction snapshot.
CREATE FUNCTION "order_command_outcome_exclusion"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE other_table text; conflict_exists boolean;
BEGIN
 IF NEW."actorType" <> 'SYSTEM' THEN
  IF current_setting('transaction_isolation') <> 'serializable' THEN
   RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='order_command_serializable_required',
    MESSAGE='Order command USER writes require Serializable';
  END IF;
  EXECUTE format('SELECT id FROM %I.users WHERE id=$1 FOR UPDATE',TG_TABLE_SCHEMA)
   USING NEW."actorId";
  other_table := CASE WHEN TG_TABLE_NAME='order_commands' THEN 'order_command_resolutions' ELSE 'order_commands' END;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE "actorScope"=$1 AND "idempotencyKey"=$2)',TG_TABLE_SCHEMA,other_table)
   INTO conflict_exists USING NEW."actorScope",NEW."idempotencyKey";
  IF conflict_exists THEN
   RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='order_command_outcome_exclusion',
    MESSAGE='Order command key already has an opposing outcome';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "order_commands_outcome_exclusion" BEFORE INSERT ON "order_commands"
 FOR EACH ROW EXECUTE FUNCTION "order_command_outcome_exclusion"();
CREATE TRIGGER "order_resolutions_outcome_exclusion" BEFORE INSERT ON "order_command_resolutions"
 FOR EACH ROW EXECUTE FUNCTION "order_command_outcome_exclusion"();

CREATE FUNCTION "order_command_identity_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW."orderId",NEW."actorScope",NEW."actorType",NEW."actorId",
  NEW."idempotencyKey",NEW.command,NEW."requestHash",NEW."hashVersion",NEW."createdAt")
 IS DISTINCT FROM ROW(OLD.id,OLD."orderId",OLD."actorScope",OLD."actorType",OLD."actorId",
  OLD."idempotencyKey",OLD.command,OLD."requestHash",OLD."hashVersion",OLD."createdAt") THEN
  RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='order_commands_identity_immutable',
   MESSAGE='Order command identity is immutable from claim creation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "order_commands_identity_immutable" BEFORE UPDATE ON "order_commands"
 FOR EACH ROW EXECUTE FUNCTION "order_command_identity_immutable"();
CREATE FUNCTION "order_resolution_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='order_resolutions_immutable',
  MESSAGE='Order command resolution is immutable';
END $$;
CREATE TRIGGER "order_resolutions_immutable" BEFORE UPDATE OR DELETE ON "order_command_resolutions"
 FOR EACH ROW EXECUTE FUNCTION "order_resolution_immutable"();
COMMIT;
