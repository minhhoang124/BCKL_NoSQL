-- NoSQL #24 Redis cart (USE_REDIS_CART=true). Additive only; unused while the flag is false.
-- Line versions for Redis cart writes. CACHE 1 keeps nextval() strictly increasing in call
-- order across connections; NO CYCLE fails loudly instead of reusing versions.
CREATE SEQUENCE "cart_line_seq" AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 CACHE 1 NO CYCLE;

-- Fence: a Redis cart line is effective only while its seq > consumedSeq. Written in the
-- same transaction as the order, so a late or failed Redis cleanup cannot allow a re-buy.
CREATE TABLE "cart_consumed_lines" (
    "buyerId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "consumedSeq" BIGINT NOT NULL,
    "checkoutId" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_consumed_lines_pkey" PRIMARY KEY ("buyerId","variantId"),
    CONSTRAINT "cart_consumed_lines_seq_positive" CHECK ("consumedSeq" > 0)
);

CREATE INDEX "cart_consumed_lines_checkoutId_buyerId_idx" ON "cart_consumed_lines"("checkoutId", "buyerId");

ALTER TABLE "cart_consumed_lines" ADD CONSTRAINT "cart_consumed_lines_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cart_consumed_lines" ADD CONSTRAINT "cart_consumed_lines_checkoutId_buyerId_fkey" FOREIGN KEY ("checkoutId", "buyerId") REFERENCES "checkouts"("id", "buyerId") ON DELETE RESTRICT ON UPDATE CASCADE;
