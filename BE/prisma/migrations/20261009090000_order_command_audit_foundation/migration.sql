-- Expand only. Preserve legacy reason, actorId, snapshots and business state.
-- No guessed actorType/reason backfill and no changes to stock or Payment.
BEGIN;

CREATE TYPE "OrderActorType" AS ENUM ('BUYER', 'SELLER', 'ADMIN', 'SYSTEM');
CREATE TYPE "OrderCommandStatus" AS ENUM ('PROCESSING', 'SUCCEEDED');

ALTER TABLE "orders"
  ADD COLUMN "cancelledById" INTEGER,
  ADD COLUMN "cancelledByType" "OrderActorType",
  ADD COLUMN "cancellationReasonCode" VARCHAR(64),
  ADD COLUMN "cancellationReasonText" VARCHAR(500);

ALTER TABLE "orders" ADD CONSTRAINT "orders_cancellation_audit_check" CHECK (
  ("cancelledById" IS NULL AND "cancelledByType" IS NULL
    AND "cancellationReasonCode" IS NULL AND "cancellationReasonText" IS NULL)
  OR
  ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL
    AND "cancelledById" IS NOT NULL AND "cancelledByType" IS NOT NULL
    AND "cancelledByType" IN ('BUYER', 'SELLER', 'ADMIN')
    AND "cancellationReasonCode" IS NOT NULL AND "cancellationReasonText" IS NOT NULL
    AND "cancellationReasonCode" ~ '^[A-Z][A-Z_]{0,63}$'
    AND length(btrim("cancellationReasonText")) > 0
    AND "cancellationReasonText" = btrim("cancellationReasonText"))
);
CREATE INDEX "orders_cancelledById_idx" ON "orders"("cancelledById");
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "order_commands" (
  "id" SERIAL PRIMARY KEY,
  "orderId" INTEGER NOT NULL,
  "actorScope" VARCHAR(64) NOT NULL,
  "actorType" "OrderActorType" NOT NULL,
  "actorId" INTEGER,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "command" VARCHAR(32) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "hashVersion" INTEGER NOT NULL,
  "status" "OrderCommandStatus" NOT NULL DEFAULT 'PROCESSING',
  "responseStatus" INTEGER,
  "resultSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "order_commands_actor_scope_check" CHECK (
    ("actorType" = 'SYSTEM' AND "actorId" IS NULL
      AND "actorScope" = 'SYSTEM:ORDER_AUTO_COMPLETE' AND "command" = 'complete')
    OR
    ("actorType" IN ('BUYER', 'SELLER', 'ADMIN') AND "actorId" IS NOT NULL
      AND "actorScope" = 'USER:' || "actorId"::text)
  ),
  CONSTRAINT "order_commands_key_hash_check" CHECK (
    "idempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$'
    AND "requestHash" ~ '^[0-9a-f]{64}$' AND "hashVersion" > 0
  ),
  CONSTRAINT "order_commands_command_check" CHECK (
    "command" IN ('confirm', 'start-packing', 'ready-to-ship', 'cancel',
      'confirm-returned', 'ship', 'mark-delivered', 'delivery-failed',
      'retry-delivery', 'complete')
  ),
  CONSTRAINT "order_commands_receipt_check" CHECK (
    ("status" = 'PROCESSING' AND "responseStatus" IS NULL
      AND "resultSnapshot" IS NULL AND "completedAt" IS NULL)
    OR
    ("status" = 'SUCCEEDED' AND "responseStatus" IS NOT NULL AND "responseStatus" = 200
      AND "resultSnapshot" IS NOT NULL AND jsonb_typeof("resultSnapshot") = 'object'
      AND "completedAt" IS NOT NULL AND "completedAt" >= "createdAt")
  )
);
CREATE UNIQUE INDEX "order_commands_id_orderId_key" ON "order_commands"("id", "orderId");
CREATE UNIQUE INDEX "order_commands_actorScope_idempotencyKey_key"
  ON "order_commands"("actorScope", "idempotencyKey");
CREATE INDEX "order_commands_orderId_createdAt_idx" ON "order_commands"("orderId", "createdAt");
CREATE INDEX "order_commands_actorId_idx" ON "order_commands"("actorId");
ALTER TABLE "order_commands" ADD CONSTRAINT "order_commands_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_commands" ADD CONSTRAINT "order_commands_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_status_history"
  ADD COLUMN "actorType" "OrderActorType",
  ADD COLUMN "commandId" INTEGER,
  ADD COLUMN "reasonCode" VARCHAR(64),
  ADD COLUMN "reasonText" VARCHAR(500),
  ADD COLUMN "restockable" BOOLEAN,
  ADD COLUMN "receiptReference" VARCHAR(100),
  ADD COLUMN "trackingReference" VARCHAR(100),
  ADD COLUMN "deliveryAttempt" INTEGER;

-- An untyped row remains legacy. A typed initial event is BUYER checkout;
-- typed transitions must identify the command that produced them.
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_history_audit_shape_check" CHECK (
  ("actorType" IS NULL AND "commandId" IS NULL AND "reasonCode" IS NULL
    AND "reasonText" IS NULL AND "restockable" IS NULL AND "receiptReference" IS NULL
    AND "trackingReference" IS NULL AND "deliveryAttempt" IS NULL)
  OR
  ("actorType" IS NOT NULL
    AND (("actorType" = 'SYSTEM' AND "actorId" IS NULL)
      OR ("actorType" <> 'SYSTEM' AND "actorId" IS NOT NULL))
    AND (
      ("commandId" IS NULL AND "fromStatus" IS NULL
        AND "toStatus" = 'PENDING_CONFIRMATION' AND "actorType" = 'BUYER'
        AND "reasonCode" IS NULL AND "reasonText" IS NULL AND "restockable" IS NULL
        AND "receiptReference" IS NULL AND "trackingReference" IS NULL AND "deliveryAttempt" IS NULL)
      OR ("commandId" IS NOT NULL AND "fromStatus" IS NOT NULL)
    ))
);
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_history_reason_check" CHECK (
  ("reasonCode" IS NULL AND "reasonText" IS NULL)
  OR ("reasonCode" IS NOT NULL AND "reasonText" IS NOT NULL
    AND "reasonCode" ~ '^[A-Z][A-Z_]{0,63}$'
    AND length(btrim("reasonText")) > 0 AND "reasonText" = btrim("reasonText"))
);
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_history_required_reason_check" CHECK (
  "actorType" IS NULL OR "toStatus" NOT IN ('CANCELLED', 'DELIVERY_FAILED')
  OR ("reasonCode" IS NOT NULL AND "reasonText" IS NOT NULL)
);
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_history_delivery_fields_check" CHECK (
  ("deliveryAttempt" IS NULL OR "deliveryAttempt" BETWEEN 1 AND 4)
  AND ("receiptReference" IS NULL OR
    (length(btrim("receiptReference")) > 0 AND "receiptReference" = btrim("receiptReference")))
  AND ("trackingReference" IS NULL OR
    (length(btrim("trackingReference")) > 0 AND "trackingReference" = btrim("trackingReference")))
);
CREATE UNIQUE INDEX "order_status_history_commandId_key" ON "order_status_history"("commandId");
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_commandId_orderId_fkey"
  FOREIGN KEY ("commandId", "orderId") REFERENCES "order_commands"("id", "orderId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retain the historic actor instead of silently nulling it when User is deleted.
ALTER TABLE "order_status_history" DROP CONSTRAINT "order_status_history_actorId_fkey";
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PROCESSING is an uncommitted claim, not a job. Read the final row at commit:
-- the INSERT event's NEW snapshot may still say PROCESSING after a later UPDATE.
CREATE FUNCTION "order_command_require_completion"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE final_status text;
BEGIN
  EXECUTE format('SELECT status::text FROM %I.order_commands WHERE id = $1', TG_TABLE_SCHEMA)
    INTO final_status USING NEW.id;
  IF final_status IS NOT NULL AND final_status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'order_commands_completed_at_commit_check',
      MESSAGE = 'Order command must complete in the same transaction';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "order_commands_completed_at_commit_check"
  AFTER INSERT OR UPDATE ON "order_commands"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "order_command_require_completion"();

CREATE FUNCTION "order_command_freeze_receipt"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'SUCCEEDED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'order_commands_receipt_immutable_check',
      MESSAGE = 'Completed order command receipt is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "order_commands_receipt_immutable_check"
  BEFORE UPDATE ON "order_commands"
  FOR EACH ROW EXECUTE FUNCTION "order_command_freeze_receipt"();

COMMIT;
