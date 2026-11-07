-- Expand only: no fabricated legacy tracking, counters or business transitions.
BEGIN;

ALTER TABLE "orders"
  ADD COLUMN "currentDeliveryAttempt" INTEGER,
  ADD COLUMN "retryCount" INTEGER;

ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_counters_check" CHECK (
  ("currentDeliveryAttempt" IS NULL AND "retryCount" IS NULL)
  OR ("currentDeliveryAttempt" IS NOT NULL AND "retryCount" IS NOT NULL
    AND "currentDeliveryAttempt" BETWEEN 1 AND 4
    AND "retryCount" BETWEEN 0 AND 3
    AND "retryCount" = "currentDeliveryAttempt" - 1)
);

CREATE TABLE "delivery_attempts" (
  "id" SERIAL PRIMARY KEY,
  "orderId" INTEGER NOT NULL,
  "deliveryAttempt" INTEGER NOT NULL,
  "trackingReference" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_attempts_number_check" CHECK ("deliveryAttempt" BETWEEN 1 AND 4),
  CONSTRAINT "delivery_attempts_tracking_check" CHECK (
    length(btrim("trackingReference")) BETWEEN 1 AND 100
    AND "trackingReference" = btrim("trackingReference")
  )
);
CREATE UNIQUE INDEX "delivery_attempts_orderId_deliveryAttempt_key"
  ON "delivery_attempts"("orderId", "deliveryAttempt");
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- NoAction, not SetNull: the shared id column must never be nulled. Deferred
-- checking permits inserting the identity and updating the pointer atomically.
ALTER TABLE "orders" ADD CONSTRAINT "orders_id_currentDeliveryAttempt_fkey"
  FOREIGN KEY ("id", "currentDeliveryAttempt")
  REFERENCES "delivery_attempts"("orderId", "deliveryAttempt")
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION "delivery_attempt_freeze_identity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'delivery_attempts_identity_immutable_check',
      MESSAGE = 'Delivery attempt identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "delivery_attempts_identity_immutable_check"
  BEFORE UPDATE ON "delivery_attempts"
  FOR EACH ROW EXECUTE FUNCTION "delivery_attempt_freeze_identity"();

CREATE FUNCTION "order_delivery_require_next_attempt"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."currentDeliveryAttempt", NEW."retryCount")
      IS DISTINCT FROM (OLD."currentDeliveryAttempt", OLD."retryCount") THEN
    IF NEW."currentDeliveryAttempt" IS NULL
      OR (OLD."currentDeliveryAttempt" IS NULL AND NEW."currentDeliveryAttempt" <> 1)
      OR (OLD."currentDeliveryAttempt" IS NOT NULL
        AND NEW."currentDeliveryAttempt" <> OLD."currentDeliveryAttempt" + 1) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'orders_delivery_next_attempt_check',
        MESSAGE = 'Delivery attempt must advance exactly once';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "orders_delivery_next_attempt_check"
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION "order_delivery_require_next_attempt"();

-- At commit, identities must be contiguous 1..current (including the newest
-- one). Schema-qualified queries also work in isolated migration-test schemas.
CREATE FUNCTION "order_delivery_check_sequence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_order integer;
  current_attempt integer;
  order_exists boolean;
  attempt_count integer;
  last_attempt integer;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    target_order := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target_order := OLD."orderId";
  ELSE
    target_order := NEW."orderId";
  END IF;
  EXECUTE format('SELECT "currentDeliveryAttempt", true FROM %I.orders WHERE id=$1 FOR UPDATE', TG_TABLE_SCHEMA)
    INTO current_attempt, order_exists USING target_order;
  EXECUTE format('SELECT count(*)::int, max("deliveryAttempt") FROM %I.delivery_attempts WHERE "orderId"=$1', TG_TABLE_SCHEMA)
    INTO attempt_count, last_attempt USING target_order;
  IF order_exists IS NOT TRUE THEN
    RETURN NULL; -- deleting fixtures/order after their attempts in one transaction
  END IF;
  IF TG_TABLE_NAME = 'delivery_attempts' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'delivery_attempts_identity_immutable_check',
      MESSAGE = 'Delivery identity cannot be deleted while its order survives';
  END IF;
  IF (current_attempt IS NULL AND attempt_count <> 0)
    OR (current_attempt IS NOT NULL
      AND (attempt_count <> current_attempt OR last_attempt IS DISTINCT FROM current_attempt)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'orders_delivery_sequence_check',
      MESSAGE = 'Delivery attempts and current counter must commit together';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "orders_delivery_sequence_check"
  AFTER INSERT OR UPDATE ON "orders"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "order_delivery_check_sequence"();
CREATE CONSTRAINT TRIGGER "delivery_attempts_sequence_check"
  AFTER INSERT OR DELETE ON "delivery_attempts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "order_delivery_check_sequence"();

COMMIT;
