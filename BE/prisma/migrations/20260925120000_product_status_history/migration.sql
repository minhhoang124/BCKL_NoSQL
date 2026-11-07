-- Additive audit trail; existing Product rows and review fields are preserved.
CREATE TABLE "product_status_history" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "fromSellerStatus" "ProductSellerStatus" NOT NULL,
    "toSellerStatus" "ProductSellerStatus" NOT NULL,
    "fromModerationStatus" "ProductModerationStatus" NOT NULL,
    "toModerationStatus" "ProductModerationStatus" NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_status_history_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_status_history_productId_version_key"
  ON "product_status_history"("productId", "version");
CREATE INDEX "product_status_history_actorId_idx" ON "product_status_history"("actorId");
ALTER TABLE "product_status_history" ADD CONSTRAINT "product_status_history_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_status_history" ADD CONSTRAINT "product_status_history_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
