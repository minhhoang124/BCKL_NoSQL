-- Expand only: legacy rows retain NULL provenance. Never infer a hash version
-- or reconstruct an initial receipt from today's Order/Payment state.
ALTER TABLE "checkouts"
  ADD COLUMN "hashVersion" INTEGER,
  ADD COLUMN "receiptVersion" INTEGER,
  ADD COLUMN "receiptJson" JSONB;

ALTER TABLE "checkouts"
  ADD CONSTRAINT "checkouts_hash_version_positive" CHECK ("hashVersion" IS NULL OR "hashVersion" > 0),
  ADD CONSTRAINT "checkouts_receipt_pair" CHECK (
    ("receiptVersion" IS NULL AND "receiptJson" IS NULL)
    OR ("receiptVersion" > 0 AND "receiptJson" IS NOT NULL AND "receiptVersion" IS NOT NULL)
  ),
  ADD CONSTRAINT "checkouts_v1_hash_shape" CHECK (
    "hashVersion" IS DISTINCT FROM 1 OR "requestHash" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "checkouts_v1_completed_receipt" CHECK (
    "hashVersion" IS DISTINCT FROM 1 OR "status" <> 'COMPLETED'
    OR COALESCE(
      "completedAt" IS NOT NULL AND "receiptVersion" = 1
      AND jsonb_typeof("receiptJson") = 'object', false
    )
  );

-- Runtime validates the entire allowlist. SQL additionally prevents a later
-- Order status update or buggy retry from rewriting a completed v1 boundary.
CREATE FUNCTION "protect_completed_checkout_v1"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."hashVersion" = 1 AND OLD."status" = 'COMPLETED' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."buyerId" IS DISTINCT FROM OLD."buyerId"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."hashVersion" IS DISTINCT FROM OLD."hashVersion"
    OR NEW."receiptVersion" IS DISTINCT FROM OLD."receiptVersion"
    OR NEW."receiptJson" IS DISTINCT FROM OLD."receiptJson"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Completed checkout v1 is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'checkouts_v1_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "checkouts_v1_immutable"
  BEFORE UPDATE ON "checkouts"
  FOR EACH ROW EXECUTE FUNCTION "protect_completed_checkout_v1"();
