-- Product domain migration: expand, backfill legacy products, then contract.

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "CategoryAttributeDataType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT');
CREATE TYPE "ProductSellerStatus" AS ENUM ('DRAFT', 'ACTIVE', 'HIDDEN');
CREATE TYPE "ProductModerationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'FROZEN');
CREATE TYPE "SearchOutboxTarget" AS ENUM ('SEARCH_SERVICE');
CREATE TYPE "SearchOutboxOperation" AS ENUM ('UPSERT', 'DELETE');
CREATE TYPE "SearchOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- Preflight legacy data before changing its shape.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "products" p
        JOIN "users" u ON u."id" = p."sellerId"
        WHERE u."role" <> 'SELLER'
    ) THEN
        RAISE EXCEPTION 'Product-domain migration stopped: every legacy product owner must have role SELLER';
    END IF;

    IF EXISTS (SELECT 1 FROM "products" WHERE "price" < 0 OR "stock" < 0) THEN
        RAISE EXCEPTION 'Product-domain migration stopped: legacy price and stock must not be negative';
    END IF;
END $$;

-- CreateTable
CREATE TABLE "stores" (
    "id" SERIAL NOT NULL,
    "sellerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brands" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- Expand Product with nullable relation columns so existing rows can be backfilled.
ALTER TABLE "products"
ADD COLUMN "brandId" INTEGER,
ADD COLUMN "categoryId" INTEGER,
ADD COLUMN "moderationStatus" "ProductModerationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedBy" INTEGER,
ADD COLUMN "sellerStatus" "ProductSellerStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "storeId" INTEGER,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Create one Store per legacy Seller and one fallback Category when legacy products exist.
INSERT INTO "stores" ("sellerId", "name", "status", "createdAt", "updatedAt")
SELECT DISTINCT
    p."sellerId",
    COALESCE(NULLIF(BTRIM(u."fullName"), ''), SPLIT_PART(u."email", '@', 1)) || ' Store',
    'ACTIVE'::"StoreStatus",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "products" p
JOIN "users" u ON u."id" = p."sellerId";

INSERT INTO "categories" ("name", "slug", "isActive", "createdAt", "updatedAt")
SELECT 'Legacy products', 'legacy-products', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "products");

UPDATE "products" p
SET
    "storeId" = s."id",
    "categoryId" = c."id",
    "sellerStatus" = 'DRAFT'::"ProductSellerStatus",
    "moderationStatus" = 'NOT_SUBMITTED'::"ProductModerationStatus"
FROM "stores" s, "categories" c
WHERE s."sellerId" = p."sellerId"
  AND c."slug" = 'legacy-products';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "products" WHERE "storeId" IS NULL OR "categoryId" IS NULL) THEN
        RAISE EXCEPTION 'Product-domain migration stopped: a legacy product could not be assigned to Store/Category';
    END IF;
END $$;

ALTER TABLE "products"
ALTER COLUMN "storeId" SET NOT NULL,
ALTER COLUMN "categoryId" SET NOT NULL;

-- CreateTable
CREATE TABLE "category_attribute_definitions" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "dataType" "CategoryAttributeDataType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isFilterable" BOOLEAN NOT NULL DEFAULT false,
    "allowsCustom" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "category_attribute_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "category_attribute_options" (
    "id" SERIAL NOT NULL,
    "attributeDefinitionId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "category_attribute_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_attribute_values" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "attributeDefinitionId" INTEGER NOT NULL,
    "optionId" INTEGER,
    "textValue" TEXT,
    "numberValue" DECIMAL(18,4),
    "booleanValue" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_attribute_values_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_attribute_values_one_value_check" CHECK (
        num_nonnulls("optionId", "textValue", "numberValue", "booleanValue") = 1
    )
);

CREATE TABLE "product_option_groups" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_option_groups_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "product_option_values" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_option_values_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "product_variants" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "skuCode" TEXT NOT NULL,
    "sellerSku" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "optionSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_variants_price_check" CHECK ("price" >= 0),
    CONSTRAINT "product_variants_stock_check" CHECK ("stock" >= 0)
);

CREATE TABLE "product_variant_option_values" (
    "variantId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "optionGroupId" INTEGER NOT NULL,
    "optionValueId" INTEGER NOT NULL,
    CONSTRAINT "product_variant_option_values_pkey" PRIMARY KEY ("variantId", "optionGroupId")
);

CREATE TABLE "product_images" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "productOptionValueId" INTEGER,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_images_sort_order_check" CHECK ("sortOrder" >= 0)
);

CREATE TABLE "product_shipping_profiles" (
    "productId" INTEGER NOT NULL,
    "packageWeightGrams" INTEGER,
    "packageLengthCm" DECIMAL(8,2),
    "packageWidthCm" DECIMAL(8,2),
    "packageHeightCm" DECIMAL(8,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_shipping_profiles_pkey" PRIMARY KEY ("productId"),
    CONSTRAINT "product_shipping_profiles_weight_check" CHECK ("packageWeightGrams" IS NULL OR "packageWeightGrams" > 0),
    CONSTRAINT "product_shipping_profiles_length_check" CHECK ("packageLengthCm" IS NULL OR "packageLengthCm" > 0),
    CONSTRAINT "product_shipping_profiles_width_check" CHECK ("packageWidthCm" IS NULL OR "packageWidthCm" > 0),
    CONSTRAINT "product_shipping_profiles_height_check" CHECK ("packageHeightCm" IS NULL OR "packageHeightCm" > 0)
);

CREATE TABLE "search_outbox" (
    "id" BIGSERIAL NOT NULL,
    "target" "SearchOutboxTarget" NOT NULL DEFAULT 'SEARCH_SERVICE',
    "operation" "SearchOutboxOperation" NOT NULL,
    "productId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SearchOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "search_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "search_outbox_version_check" CHECK ("version" > 0),
    CONSTRAINT "search_outbox_attempt_count_check" CHECK ("attemptCount" >= 0)
);

-- Indexes and unique constraints required for backfill and relations.
CREATE UNIQUE INDEX "stores_sellerId_key" ON "stores"("sellerId");
CREATE INDEX "stores_status_idx" ON "stores"("status");
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");
CREATE INDEX "categories_isActive_idx" ON "categories"("isActive");
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");
CREATE INDEX "brands_isActive_idx" ON "brands"("isActive");

CREATE INDEX "products_storeId_idx" ON "products"("storeId");
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");
CREATE INDEX "products_brandId_idx" ON "products"("brandId");
CREATE INDEX "products_reviewedBy_idx" ON "products"("reviewedBy");
CREATE INDEX "products_sellerStatus_moderationStatus_idx" ON "products"("sellerStatus", "moderationStatus");
CREATE UNIQUE INDEX "products_id_storeId_key" ON "products"("id", "storeId");

CREATE INDEX "category_attribute_definitions_categoryId_isActive_idx" ON "category_attribute_definitions"("categoryId", "isActive");
CREATE UNIQUE INDEX "category_attribute_definitions_categoryId_slug_key" ON "category_attribute_definitions"("categoryId", "slug");
CREATE INDEX "category_attribute_options_attributeDefinitionId_isActive_idx" ON "category_attribute_options"("attributeDefinitionId", "isActive");
CREATE UNIQUE INDEX "category_attribute_options_attributeDefinitionId_slug_key" ON "category_attribute_options"("attributeDefinitionId", "slug");
CREATE UNIQUE INDEX "category_attribute_options_id_attributeDefinitionId_key" ON "category_attribute_options"("id", "attributeDefinitionId");

CREATE INDEX "product_attribute_values_attributeDefinitionId_idx" ON "product_attribute_values"("attributeDefinitionId");
CREATE INDEX "product_attribute_values_optionId_idx" ON "product_attribute_values"("optionId");
CREATE UNIQUE INDEX "product_attribute_values_productId_attributeDefinitionId_key" ON "product_attribute_values"("productId", "attributeDefinitionId");

CREATE INDEX "product_option_groups_productId_position_idx" ON "product_option_groups"("productId", "position");
CREATE UNIQUE INDEX "product_option_groups_id_productId_key" ON "product_option_groups"("id", "productId");
CREATE UNIQUE INDEX "product_option_groups_productId_name_key" ON "product_option_groups"("productId", "name");
CREATE INDEX "product_option_values_productId_idx" ON "product_option_values"("productId");
CREATE UNIQUE INDEX "product_option_values_id_groupId_productId_key" ON "product_option_values"("id", "groupId", "productId");
CREATE UNIQUE INDEX "product_option_values_id_productId_key" ON "product_option_values"("id", "productId");
CREATE UNIQUE INDEX "product_option_values_groupId_value_key" ON "product_option_values"("groupId", "value");

CREATE UNIQUE INDEX "product_variants_skuCode_key" ON "product_variants"("skuCode");
CREATE INDEX "product_variants_productId_isActive_idx" ON "product_variants"("productId", "isActive");
CREATE INDEX "product_variants_storeId_idx" ON "product_variants"("storeId");
CREATE UNIQUE INDEX "product_variants_id_productId_key" ON "product_variants"("id", "productId");
CREATE UNIQUE INDEX "product_variants_storeId_sellerSku_key" ON "product_variants"("storeId", "sellerSku");
CREATE UNIQUE INDEX "product_variants_productId_optionSignature_key" ON "product_variants"("productId", "optionSignature");
CREATE INDEX "product_variant_option_values_optionValueId_optionGroupId_p_idx" ON "product_variant_option_values"("optionValueId", "optionGroupId", "productId");
CREATE UNIQUE INDEX "product_variant_option_values_variantId_optionValueId_key" ON "product_variant_option_values"("variantId", "optionValueId");

CREATE INDEX "product_images_productId_sortOrder_idx" ON "product_images"("productId", "sortOrder");
CREATE INDEX "product_images_productOptionValueId_idx" ON "product_images"("productOptionValueId");
CREATE UNIQUE INDEX "product_images_productId_url_key" ON "product_images"("productId", "url");
CREATE UNIQUE INDEX "product_images_one_primary_per_product_key" ON "product_images"("productId") WHERE "isPrimary" = true;

CREATE INDEX "search_outbox_status_nextAttemptAt_idx" ON "search_outbox"("status", "nextAttemptAt");
CREATE INDEX "search_outbox_productId_idx" ON "search_outbox"("productId");
CREATE UNIQUE INDEX "search_outbox_target_productId_version_key" ON "search_outbox"("target", "productId", "version");

-- Backfill one default Variant for every legacy Product before old columns are removed.
INSERT INTO "product_variants" (
    "productId", "storeId", "skuCode", "sellerSku", "price", "stock",
    "isActive", "optionSignature", "createdAt", "updatedAt"
)
SELECT
    p."id",
    p."storeId",
    'LEGACY-' || p."id"::text || '-DEFAULT',
    NULL,
    p."price",
    p."stock",
    p."status" <> 'HIDDEN'::"ProductStatus",
    'default',
    p."createdAt",
    p."updatedAt"
FROM "products" p;

-- Foreign keys.
ALTER TABLE "stores" ADD CONSTRAINT "stores_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_version_check" CHECK ("version" > 0);

ALTER TABLE "category_attribute_definitions" ADD CONSTRAINT "category_attribute_definitions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "category_attribute_options" ADD CONSTRAINT "category_attribute_options_attributeDefinitionId_fkey" FOREIGN KEY ("attributeDefinitionId") REFERENCES "category_attribute_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attributeDefinitionId_fkey" FOREIGN KEY ("attributeDefinitionId") REFERENCES "category_attribute_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_optionId_attributeDefinitionId_fkey" FOREIGN KEY ("optionId", "attributeDefinitionId") REFERENCES "category_attribute_options"("id", "attributeDefinitionId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_groupId_productId_fkey" FOREIGN KEY ("groupId", "productId") REFERENCES "product_option_groups"("id", "productId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "products"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variantId_productId_fkey" FOREIGN KEY ("variantId", "productId") REFERENCES "product_variants"("id", "productId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_optionValueId_optionGroupId__fkey" FOREIGN KEY ("optionValueId", "optionGroupId", "productId") REFERENCES "product_option_values"("id", "groupId", "productId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productOptionValueId_fkey" FOREIGN KEY ("productOptionValueId") REFERENCES "product_option_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_shipping_profiles" ADD CONSTRAINT "product_shipping_profiles_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "search_outbox" ADD CONSTRAINT "search_outbox_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contract legacy Product fields only after their data has been copied to Store/Variant.
ALTER TABLE "products" DROP CONSTRAINT "products_sellerId_fkey";
DROP INDEX "products_sellerId_idx";
DROP INDEX "products_status_idx";
ALTER TABLE "products"
DROP COLUMN "price",
DROP COLUMN "sellerId",
DROP COLUMN "status",
DROP COLUMN "stock";
DROP TYPE "ProductStatus";
