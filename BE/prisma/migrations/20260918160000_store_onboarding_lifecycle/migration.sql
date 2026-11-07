-- Add the missing seller-onboarding states without changing existing stores.
ALTER TYPE "StoreStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'ACTIVE';
ALTER TYPE "StoreStatus" ADD VALUE IF NOT EXISTS 'REJECTED' AFTER 'ACTIVE';

-- New stores must be reviewed before they can sell. Existing ACTIVE stores stay ACTIVE.
ALTER TABLE "stores"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Immutable transition history records actor, timestamp and reason.
CREATE TABLE "store_status_history" (
  "id" SERIAL NOT NULL,
  "storeId" INTEGER NOT NULL,
  "fromStatus" "StoreStatus",
  "toStatus" "StoreStatus" NOT NULL,
  "actorId" INTEGER NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_status_history_storeId_createdAt_idx"
  ON "store_status_history"("storeId", "createdAt");
CREATE INDEX "store_status_history_actorId_idx"
  ON "store_status_history"("actorId");

ALTER TABLE "store_status_history"
  ADD CONSTRAINT "store_status_history_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_status_history"
  ADD CONSTRAINT "store_status_history_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
