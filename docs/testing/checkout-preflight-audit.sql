-- Checkout preparation only. No migration, backfill, key/hash or stock writes.
-- Run against the explicitly selected database using psql -X -v ON_ERROR_STOP=1.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

SELECT current_database() AS database_name,
       current_setting('transaction_read_only') AS read_only,
       current_setting('transaction_isolation') AS isolation_level;

SELECT migration_name, finished_at IS NOT NULL AS finished,
       rolled_back_at IS NOT NULL AS rolled_back
FROM "_prisma_migrations" ORDER BY started_at;

SELECT expected AS missing_completed_migration
FROM unnest(ARRAY['20260930143000_cart_order_inventory_foundation',
                  '20261003140000_nullable_address_district']) AS expected
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" m WHERE m.migration_name = expected
    AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
);

SELECT name AS required_table, to_regclass('public.' || name) IS NOT NULL AS present
FROM unnest(ARRAY['checkouts', 'orders', 'order_items', 'payments',
                  'stock_movements', 'cart_items', 'product_variants']) AS name;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['checkouts', 'orders', 'order_items', 'payments',
                              'stock_movements', 'cart_items', 'product_variants']) AS name
    WHERE to_regclass('public.' || name) IS NULL
  ) THEN
    RAISE EXCEPTION 'CHECKOUT_PREFLIGHT_SCHEMA_NOT_READY: missing required tables; do not infer zero legacy rows or run a backfill';
  END IF;
END $$;

SELECT 'checkouts' AS entity, count(*) AS row_count FROM checkouts
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'stock_movements', count(*) FROM stock_movements;

-- No PII, full hash, idempotency key, address or payment credential output.
SELECT status, count(*) AS row_count,
       count(*) FILTER (WHERE "requestHash" !~ '^[0-9a-f]{64}$') AS non_sha256_shape,
       count(*) FILTER (WHERE status = 'COMPLETED' AND "completedAt" IS NULL)
         AS completed_without_timestamp
FROM checkouts GROUP BY status ORDER BY status;

-- A SHA-256 shape alone DOES NOT prove which canonical input/hash version was used.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'checkouts'
ORDER BY ordinal_position;

SELECT count(*) AS negative_stock FROM product_variants WHERE stock < 0;
SELECT count(*) AS nonpositive_or_fractional_prices
FROM product_variants WHERE price <= 0 OR price <> trunc(price);
SELECT count(*) AS cart_quantity_outside_contract
FROM cart_items WHERE quantity < 1 OR quantity > 99;

SELECT count(*) AS missing_or_mismatched_payment
FROM orders o LEFT JOIN payments p ON p."orderId" = o.id
WHERE p.id IS NULL OR p.amount <> o.total OR p.currency <> 'VND';

SELECT count(*) AS order_subtotal_mismatch
FROM orders o
WHERE o.subtotal <> COALESCE((SELECT sum(i."lineTotal")
                            FROM order_items i WHERE i."orderId" = o.id), 0);

SELECT count(*) AS checkout_without_order
FROM checkouts c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o."checkoutId" = c.id);

-- Record actual DB constraints; Prisma schema alone does not list all SQL checks.
SELECT rel.relname AS table_name, con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
  AND rel.relname IN ('checkouts', 'orders', 'order_items', 'payments', 'stock_movements')
ORDER BY rel.relname, con.conname;

SELECT tablename AS table_name, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('checkouts', 'orders', 'order_items', 'payments', 'stock_movements')
ORDER BY tablename, indexname;

ROLLBACK;
