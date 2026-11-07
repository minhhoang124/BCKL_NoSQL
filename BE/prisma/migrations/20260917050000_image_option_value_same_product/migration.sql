-- Enforce that ProductImage.productOptionValueId references a
-- ProductOptionValue belonging to the same Product.

-- 1. Preflight: reject orphans AND cross-product mismatches.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "product_images" pi
    LEFT JOIN "product_option_values" pov
      ON pov."id" = pi."productOptionValueId"
    WHERE pi."productOptionValueId" IS NOT NULL
      AND (
        pov."id" IS NULL
        OR pi."productId" <> pov."productId"
      )
  ) THEN
    RAISE EXCEPTION
      'Migration stopped: invalid product image option ownership. '
      'Fix data manually before retrying.';
  END IF;
END $$;

-- 2. Drop old single-column FK.
ALTER TABLE "product_images"
  DROP CONSTRAINT "product_images_productOptionValueId_fkey";

-- 3. Drop old single-column index.
DROP INDEX IF EXISTS "product_images_productOptionValueId_idx";

-- 4. Add composite FK enforcing same-product ownership.
ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_productOptionValueId_productId_fkey"
  FOREIGN KEY ("productOptionValueId", "productId")
  REFERENCES "product_option_values"("id", "productId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- 5. Add composite index on referencing columns.
CREATE INDEX "product_images_productOptionValueId_productId_idx"
  ON "product_images"("productOptionValueId", "productId");
