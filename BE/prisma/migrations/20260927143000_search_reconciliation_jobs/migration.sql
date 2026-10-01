-- Durable fan-out work for parent changes that affect Product search state.
CREATE TYPE "SearchReconciliationScope" AS ENUM ('ALL', 'STORE', 'CATEGORY', 'BRAND', 'SELLER');
CREATE TYPE "SearchReconciliationStatus" AS ENUM ('PENDING', 'PROCESSING', 'FAILED', 'SUCCEEDED', 'DEAD');

CREATE TABLE "search_reconciliation_jobs" (
    "id" BIGSERIAL NOT NULL,
    "scope" "SearchReconciliationScope" NOT NULL,
    "scopeId" INTEGER,
    "status" "SearchReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "cursorProductId" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "search_reconciliation_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "search_reconciliation_jobs_scope_check" CHECK (
      ("scope" = 'ALL' AND "scopeId" IS NULL) OR
      ("scope" <> 'ALL' AND "scopeId" IS NOT NULL)
    )
);

CREATE INDEX "search_reconciliation_jobs_status_nextAttemptAt_idx"
ON "search_reconciliation_jobs"("status", "nextAttemptAt");

CREATE INDEX "search_reconciliation_jobs_scope_scopeId_createdAt_idx"
ON "search_reconciliation_jobs"("scope", "scopeId", "createdAt");
