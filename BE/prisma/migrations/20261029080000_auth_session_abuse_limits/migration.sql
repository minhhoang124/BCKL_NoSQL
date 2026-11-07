CREATE TABLE "auth_rate_buckets" (
  "scope" VARCHAR(16) NOT NULL,
  "subjectHash" CHAR(64) NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_rate_buckets_pkey" PRIMARY KEY ("scope", "subjectHash"),
  CONSTRAINT "auth_rate_count_positive" CHECK ("count" BETWEEN 1 AND 10000),
  CONSTRAINT "auth_rate_subject_hash" CHECK ("subjectHash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "auth_rate_buckets_resetAt_idx" ON "auth_rate_buckets"("resetAt");
