-- Order detail/command preparation. Aggregate output only: no PII or key/hash.
-- Run with: psql -X -v ON_ERROR_STOP=1 -d <explicit_database> -f <this_file>
-- This script does not migrate, backfill, seed or repair business data.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

SELECT current_database() AS database_name,
       current_setting('transaction_read_only') AS read_only,
       current_setting('transaction_isolation') AS isolation_level;

SELECT name AS required_table, to_regclass('public.' || name) IS NOT NULL AS present
FROM unnest(ARRAY['_prisma_migrations', 'checkouts', 'orders', 'order_items',
                  'payments', 'order_status_history', 'stock_movements']) AS name;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['_prisma_migrations', 'checkouts', 'orders', 'order_items',
                     'payments', 'order_status_history', 'stock_movements']) AS name
    WHERE to_regclass('public.' || name) IS NULL
  ) THEN
    RAISE EXCEPTION 'ORDER_AUDIT_SCHEMA_NOT_READY: required tables missing; do not infer zero legacy rows';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('checkouts', 'buyerId'),
      ('orders', 'buyerId'), ('orders', 'checkoutId'), ('orders', 'status'),
      ('orders', 'cancelledAt'), ('orders', 'deliveredAt'), ('orders', 'completedAt'),
      ('order_items', 'optionSnapshot'),
      ('order_status_history', 'actorId'), ('order_status_history', 'fromStatus'),
      ('order_status_history', 'toStatus'), ('order_status_history', 'createdAt'),
      ('payments', 'provider'), ('payments', 'status'), ('payments', 'paidAt'),
      ('stock_movements', 'quantityDelta')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns AS c
      WHERE c.table_schema = 'public'
        AND c.table_name = required.table_name AND c.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'ORDER_AUDIT_SCHEMA_NOT_READY: baseline columns missing; no backfill permitted';
  END IF;
END $$;

SELECT migration_name, finished_at IS NOT NULL AS finished,
       rolled_back_at IS NOT NULL AS rolled_back
FROM "_prisma_migrations" ORDER BY started_at;

SELECT 'orders' AS entity, count(*) AS row_count FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'order_status_history', count(*) FROM order_status_history
UNION ALL SELECT 'stock_movements', count(*) FROM stock_movements;

SELECT status, count(*) AS row_count FROM orders GROUP BY status ORDER BY status;
SELECT provider, status, count(*) AS row_count
FROM payments GROUP BY provider, status ORDER BY provider, status;

-- List absent target columns; do not assume that they exist on shared develop.
SELECT required.table_name, required.column_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns AS c
         WHERE c.table_schema = 'public' AND c.table_name = required.table_name
           AND c.column_name = required.column_name
       ) AS present
FROM (VALUES
  ('orders', 'cancelledById'), ('orders', 'cancelledByType'),
  ('orders', 'cancellationReasonCode'), ('orders', 'cancellationReasonText'),
  ('order_status_history', 'commandId'), ('order_status_history', 'actorType'),
  ('order_status_history', 'reasonCode'), ('order_status_history', 'reasonText'),
  ('order_status_history', 'restockable'), ('order_status_history', 'receiptReference'),
  ('order_status_history', 'trackingReference'), ('order_status_history', 'deliveryAttempt')
) AS required(table_name, column_name)
ORDER BY required.table_name, required.column_name;

SELECT name AS target_table, to_regclass('public.' || name) IS NOT NULL AS present
FROM unnest(ARRAY['order_commands', 'delivery_attempts']) AS name;

-- Integrity indicators, not instructions to synthesize Payment or snapshot data.
SELECT 'order_without_items' AS check_name, count(*) AS affected_count
FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i."orderId" = o.id)
UNION ALL
SELECT 'order_without_payment', count(*)
FROM orders o WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id)
UNION ALL
SELECT 'payment_amount_or_currency_mismatch', count(*)
FROM orders o JOIN payments p ON p."orderId" = o.id
WHERE p.amount <> o.total OR p.currency <> 'VND'
UNION ALL
SELECT 'order_subtotal_mismatch', count(*) FROM orders o
WHERE o.subtotal <> COALESCE((SELECT sum(i."lineTotal")
                             FROM order_items i WHERE i."orderId" = o.id), 0)
UNION ALL
SELECT 'order_without_history', count(*) FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h."orderId" = o.id)
UNION ALL
SELECT 'cancelled_without_timestamp', count(*) FROM orders
WHERE status = 'CANCELLED' AND "cancelledAt" IS NULL
UNION ALL
SELECT 'delivered_or_completed_without_delivery_timestamp', count(*) FROM orders
WHERE status IN ('DELIVERED', 'COMPLETED') AND "deliveredAt" IS NULL
UNION ALL
SELECT 'completed_without_completion_timestamp', count(*) FROM orders
WHERE status = 'COMPLETED' AND "completedAt" IS NULL
UNION ALL
SELECT 'cod_delivered_or_completed_without_paid_payment', count(*)
FROM orders o JOIN payments p ON p."orderId" = o.id
WHERE p.provider = 'COD' AND o.status IN ('DELIVERED', 'COMPLETED')
  AND (p.status <> 'PAID' OR p."paidAt" IS NULL)
UNION ALL
SELECT 'cod_cancelled_without_cancelled_payment', count(*)
FROM orders o JOIN payments p ON p."orderId" = o.id
WHERE p.provider = 'COD' AND o.status = 'CANCELLED' AND p.status <> 'CANCELLED';

-- Candidate initial history only: matching identities is NOT sufficient provenance
-- to backfill actorType automatically. Never derive past actorType from User.role.
SELECT count(*) AS history_total,
       count(*) FILTER (
         WHERE h."fromStatus" IS NULL AND h."toStatus" = 'PENDING_CONFIRMATION'
           AND h."actorId" = o."buyerId" AND c."buyerId" = o."buyerId"
       ) AS initial_buyer_structural_candidates,
       count(*) FILTER (WHERE h."actorId" IS NULL) AS history_without_actor_id,
       count(*) FILTER (WHERE h."fromStatus" IS NOT NULL) AS noninitial_history_needing_audit
FROM order_status_history h
JOIN orders o ON o.id = h."orderId"
JOIN checkouts c ON c.id = o."checkoutId";

WITH ordered_history AS (
  SELECT h.*, row_number() OVER w AS sequence_number,
         lag(h."toStatus") OVER w AS previous_status
  FROM order_status_history h
  WINDOW w AS (PARTITION BY h."orderId" ORDER BY h."createdAt", h.id)
), latest AS (
  SELECT DISTINCT ON ("orderId") "orderId", "toStatus"
  FROM order_status_history ORDER BY "orderId", "createdAt" DESC, id DESC
)
SELECT 'history_chain_mismatch' AS check_name, count(*) AS affected_count
FROM ordered_history
WHERE (sequence_number = 1 AND "fromStatus" IS NOT NULL)
   OR (sequence_number > 1 AND "fromStatus" IS DISTINCT FROM previous_status)
UNION ALL
SELECT 'latest_history_order_status_mismatch', count(*)
FROM orders o JOIN latest h ON h."orderId" = o.id WHERE h."toStatus" <> o.status;

-- Shape only. Do not read options from a live Variant to repair historical JSON.
SELECT jsonb_typeof("optionSnapshot") AS snapshot_json_type, count(*) AS row_count
FROM order_items GROUP BY jsonb_typeof("optionSnapshot");

SELECT 'item_without_checkout_decrement' AS check_name, count(*) AS affected_count
FROM order_items i WHERE NOT EXISTS (
  SELECT 1 FROM stock_movements m
  WHERE m."orderItemId" = i.id AND m.type = 'CHECKOUT_DECREMENT'
)
UNION ALL
SELECT 'checkout_decrement_quantity_mismatch', count(*)
FROM order_items i JOIN stock_movements m ON m."orderItemId" = i.id
WHERE m.type = 'CHECKOUT_DECREMENT'
  AND (m."variantId" <> i."variantId" OR m."quantityDelta" <> -i.quantity)
UNION ALL
SELECT 'cancellation_restore_quantity_mismatch', count(*)
FROM order_items i JOIN stock_movements m ON m."orderItemId" = i.id
WHERE m.type = 'CANCELLATION_RESTORE'
  AND (m."variantId" <> i."variantId" OR m."quantityDelta" <> i.quantity)
UNION ALL
SELECT 'cancellation_restore_on_non_cancelled_order', count(*)
FROM stock_movements m JOIN order_items i ON i.id = m."orderItemId"
JOIN orders o ON o.id = i."orderId"
WHERE m.type = 'CANCELLATION_RESTORE' AND o.status <> 'CANCELLED';

-- Unique constraints and audit FK are inspected; this script does not add them.
SELECT rel.relname AS table_name, con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
  AND rel.relname IN ('orders', 'order_status_history', 'stock_movements',
                     'order_commands', 'delivery_attempts')
ORDER BY rel.relname, con.conname;

-- Prisma implements several unique declarations as unique indexes.
SELECT tablename AS table_name, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'order_status_history', 'stock_movements',
                    'order_commands', 'delivery_attempts')
ORDER BY tablename, indexname;

ROLLBACK;
