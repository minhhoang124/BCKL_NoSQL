CREATE TABLE "search_logs" (
 "id" UUID NOT NULL, "tokenHash" CHAR(64) NOT NULL, "visitorHash" CHAR(64) NOT NULL,
 "strategy" VARCHAR(16) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "search_logs_strategy_check" CHECK ("strategy" IN ('HYBRID_TEXT','IMAGE')),
 CONSTRAINT "search_logs_expiry_check" CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '15 minutes'),
 CONSTRAINT "search_logs_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$' AND "visitorHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "search_logs_tokenHash_key" ON "search_logs"("tokenHash");
CREATE INDEX "search_logs_createdAt_idx" ON "search_logs"("createdAt");
CREATE TABLE "search_result_logs" (
 "searchId" UUID NOT NULL, "productId" INTEGER NOT NULL, "storeId" INTEGER NOT NULL, "rank" INTEGER NOT NULL, "impressionAt" TIMESTAMP(3),
 CONSTRAINT "search_result_logs_pkey" PRIMARY KEY ("searchId","productId"),
 CONSTRAINT "search_result_logs_ids_check" CHECK ("productId">0 AND "storeId">0 AND "rank">0 AND "rank"<=150),
 CONSTRAINT "search_result_logs_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "search_logs"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "search_result_logs_searchId_rank_key" ON "search_result_logs"("searchId","rank");
CREATE INDEX "search_result_logs_storeId_searchId_idx" ON "search_result_logs"("storeId","searchId");
CREATE TABLE "search_click_logs" (
 "searchId" UUID NOT NULL,"productId" INTEGER NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "search_click_logs_pkey" PRIMARY KEY ("searchId","productId"),
 CONSTRAINT "search_click_logs_searchId_productId_fkey" FOREIGN KEY ("searchId","productId") REFERENCES "search_result_logs"("searchId","productId") ON DELETE CASCADE ON UPDATE RESTRICT
);
