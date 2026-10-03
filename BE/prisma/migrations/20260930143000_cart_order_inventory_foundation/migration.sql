-- Cart, multi-store checkout, immutable order snapshots and auditable inventory.
CREATE TYPE "CheckoutStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'PACKING', 'READY_TO_SHIP', 'SHIPPING', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DELIVERY_FAILED');
CREATE TYPE "PaymentProvider" AS ENUM ('COD', 'VNPAY', 'MOMO');
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED');
CREATE TYPE "StockMovementType" AS ENUM ('CHECKOUT_DECREMENT', 'CANCELLATION_RESTORE', 'RETURN_RESTORE', 'MANUAL_ADJUSTMENT');

-- VND is stored as Decimal(14,2) across variants and immutable snapshots so
-- copying a price never changes it. Business data must contain whole dong;
-- reject legacy fractional values before widening the variant precision.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "product_variants" WHERE "price" <> trunc("price")) THEN
    RAISE EXCEPTION 'Cannot enable whole-dong pricing: product_variants contains fractional prices';
  END IF;
END $$;
ALTER TABLE "product_variants" ALTER COLUMN "price" TYPE DECIMAL(14,2);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_price_whole_vnd_check" CHECK ("price" = trunc("price"));

CREATE TABLE "user_addresses" (
  "id" SERIAL PRIMARY KEY, "userId" INTEGER NOT NULL, "recipientName" TEXT NOT NULL,
  "phone" TEXT NOT NULL, "province" TEXT NOT NULL, "district" TEXT NOT NULL,
  "ward" TEXT NOT NULL, "addressLine" TEXT NOT NULL, "postalCode" TEXT,
  "deliveryNote" TEXT, "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "carts" (
  "id" SERIAL PRIMARY KEY, "userId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "cart_items" (
  "id" SERIAL PRIMARY KEY, "cartId" INTEGER NOT NULL, "variantId" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cart_items_quantity_check" CHECK ("quantity" > 0)
);
CREATE TABLE "checkouts" (
  "id" SERIAL PRIMARY KEY, "buyerId" INTEGER NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL, "status" "CheckoutStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3)
);
CREATE TABLE "orders" (
  "id" SERIAL PRIMARY KEY, "orderNumber" TEXT NOT NULL, "checkoutId" INTEGER NOT NULL,
  "buyerId" INTEGER NOT NULL, "storeId" INTEGER NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "recipientNameSnapshot" TEXT NOT NULL, "phoneSnapshot" TEXT NOT NULL,
  "provinceSnapshot" TEXT NOT NULL, "districtSnapshot" TEXT NOT NULL,
  "wardSnapshot" TEXT NOT NULL, "addressLineSnapshot" TEXT NOT NULL,
  "postalCodeSnapshot" TEXT, "deliveryNoteSnapshot" TEXT,
  "subtotal" DECIMAL(14,2) NOT NULL, "shippingFee" DECIMAL(14,2) NOT NULL,
  "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0, "total" DECIMAL(14,2) NOT NULL,
  "cancellationReason" TEXT, "cancelledAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_money_nonnegative_check" CHECK ("subtotal" >= 0 AND "shippingFee" >= 0 AND "discountTotal" >= 0 AND "total" >= 0),
  CONSTRAINT "orders_money_whole_vnd_check" CHECK ("subtotal" = trunc("subtotal") AND "shippingFee" = trunc("shippingFee") AND "discountTotal" = trunc("discountTotal") AND "total" = trunc("total")),
  CONSTRAINT "orders_total_check" CHECK ("total" = "subtotal" + "shippingFee" - "discountTotal")
);
CREATE TABLE "order_items" (
  "id" SERIAL PRIMARY KEY, "orderId" INTEGER NOT NULL, "productId" INTEGER NOT NULL,
  "variantId" INTEGER NOT NULL, "storeId" INTEGER NOT NULL,
  "productNameSnapshot" TEXT NOT NULL, "skuSnapshot" TEXT NOT NULL,
  "optionSnapshot" JSONB NOT NULL, "unitPrice" DECIMAL(14,2) NOT NULL,
  "quantity" INTEGER NOT NULL, "lineTotal" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_money_check" CHECK ("unitPrice" >= 0 AND "lineTotal" = "unitPrice" * "quantity"),
  CONSTRAINT "order_items_money_whole_vnd_check" CHECK ("unitPrice" = trunc("unitPrice") AND "lineTotal" = trunc("lineTotal"))
);
CREATE TABLE "payments" (
  "id" SERIAL PRIMARY KEY, "orderId" INTEGER NOT NULL, "provider" "PaymentProvider" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID', "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND', "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_amount_check" CHECK ("amount" >= 0 AND "amount" = trunc("amount")),
  CONSTRAINT "payments_currency_check" CHECK ("currency" = 'VND')
);
CREATE TABLE "order_status_history" (
  "id" SERIAL PRIMARY KEY, "orderId" INTEGER NOT NULL, "fromStatus" "OrderStatus",
  "toStatus" "OrderStatus" NOT NULL, "actorId" INTEGER, "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "stock_movements" (
  "id" BIGSERIAL PRIMARY KEY, "variantId" INTEGER NOT NULL, "orderItemId" INTEGER,
  "type" "StockMovementType" NOT NULL, "quantityDelta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL, "idempotencyKey" TEXT NOT NULL, "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_delta_check" CHECK ("quantityDelta" <> 0),
  CONSTRAINT "stock_movements_balance_check" CHECK ("balanceAfter" >= 0),
  CONSTRAINT "stock_movements_direction_check" CHECK (
    ("type" = 'CHECKOUT_DECREMENT' AND "quantityDelta" < 0) OR
    ("type" IN ('CANCELLATION_RESTORE', 'RETURN_RESTORE') AND "quantityDelta" > 0) OR
    ("type" = 'MANUAL_ADJUSTMENT')
  ),
  CONSTRAINT "stock_movements_order_item_requirement_check" CHECK (
    ("type" = 'MANUAL_ADJUSTMENT' AND "orderItemId" IS NULL) OR
    ("type" IN ('CHECKOUT_DECREMENT', 'CANCELLATION_RESTORE', 'RETURN_RESTORE') AND "orderItemId" IS NOT NULL)
  )
);

CREATE INDEX "user_addresses_userId_idx" ON "user_addresses"("userId");
CREATE UNIQUE INDEX "user_addresses_one_default_per_user_key" ON "user_addresses"("userId") WHERE "isDefault" = true;
CREATE UNIQUE INDEX "carts_userId_key" ON "carts"("userId");
CREATE UNIQUE INDEX "cart_items_cartId_variantId_key" ON "cart_items"("cartId", "variantId");
CREATE INDEX "cart_items_variantId_idx" ON "cart_items"("variantId");
CREATE UNIQUE INDEX "checkouts_buyerId_idempotencyKey_key" ON "checkouts"("buyerId", "idempotencyKey");
CREATE UNIQUE INDEX "checkouts_id_buyerId_key" ON "checkouts"("id", "buyerId");
CREATE INDEX "checkouts_buyerId_createdAt_idx" ON "checkouts"("buyerId", "createdAt");
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");
CREATE UNIQUE INDEX "orders_id_storeId_key" ON "orders"("id", "storeId");
CREATE UNIQUE INDEX "orders_checkoutId_storeId_key" ON "orders"("checkoutId", "storeId");
CREATE INDEX "orders_buyerId_createdAt_idx" ON "orders"("buyerId", "createdAt");
CREATE INDEX "orders_storeId_status_createdAt_idx" ON "orders"("storeId", "status", "createdAt");
CREATE INDEX "orders_checkoutId_idx" ON "orders"("checkoutId");
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");
CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");
CREATE INDEX "order_items_storeId_idx" ON "order_items"("storeId");
CREATE UNIQUE INDEX "order_items_id_variantId_key" ON "order_items"("id", "variantId");
CREATE UNIQUE INDEX "product_variants_id_productId_storeId_key" ON "product_variants"("id", "productId", "storeId");
CREATE UNIQUE INDEX "payments_orderId_key" ON "payments"("orderId");
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");
CREATE INDEX "order_status_history_orderId_createdAt_idx" ON "order_status_history"("orderId", "createdAt");
CREATE INDEX "order_status_history_actorId_idx" ON "order_status_history"("actorId");
CREATE UNIQUE INDEX "stock_movements_idempotencyKey_key" ON "stock_movements"("idempotencyKey");
CREATE UNIQUE INDEX "stock_movements_orderItemId_type_key" ON "stock_movements"("orderItemId", "type");
CREATE INDEX "stock_movements_variantId_createdAt_idx" ON "stock_movements"("variantId", "createdAt");

ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkoutId_buyerId_fkey" FOREIGN KEY ("checkoutId", "buyerId") REFERENCES "checkouts"("id", "buyerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_storeId_fkey" FOREIGN KEY ("orderId", "storeId") REFERENCES "orders"("id", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "products"("id", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_productId_storeId_fkey" FOREIGN KEY ("variantId", "productId", "storeId") REFERENCES "product_variants"("id", "productId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_orderItemId_variantId_fkey" FOREIGN KEY ("orderItemId", "variantId") REFERENCES "order_items"("id", "variantId") ON DELETE RESTRICT ON UPDATE CASCADE;
