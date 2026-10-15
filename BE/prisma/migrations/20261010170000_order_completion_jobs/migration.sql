-- Expand only; no business-state mutation or inferred historical completion.
BEGIN;
CREATE TABLE "order_completion_jobs" (
  "id" SERIAL PRIMARY KEY,
  "orderId" INTEGER NOT NULL,
  "ruleVersion" INTEGER NOT NULL DEFAULT 1,
  "deliveredAt" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" VARCHAR(36),
  "leaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_completion_jobs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_completion_jobs_policy_check" CHECK ("ruleVersion" = 1 AND "dueAt" >= "deliveredAt" AND "attemptCount" BETWEEN 0 AND 6),
  CONSTRAINT "order_completion_jobs_state_check" CHECK (
    ("status" IN ('PENDING','RETRY') AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "completedAt" IS NULL)
    OR ("status" = 'RUNNING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "completedAt" IS NULL)
    OR ("status" IN ('SUCCEEDED','SKIPPED','FAILED') AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "completedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "order_completion_jobs_orderId_key" ON "order_completion_jobs"("orderId");
CREATE INDEX "order_completion_jobs_status_nextAttemptAt_idx" ON "order_completion_jobs"("status", "nextAttemptAt");
CREATE INDEX "orders_status_deliveredAt_idx" ON "orders"("status", "deliveredAt");
COMMIT;
