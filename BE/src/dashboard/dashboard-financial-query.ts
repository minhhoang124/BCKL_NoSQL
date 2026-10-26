import { Prisma } from '@prisma/client';
import type { Range } from './dashboard-input.js';

/** Shared CTE for totals, buckets and data-quality pages. No top-N money sampling. */
export function financialOrders(
  storeId: number | null,
  range: Range,
  asOf: Date,
) {
  const scope =
    storeId === null ? Prisma.sql`TRUE` : Prisma.sql`o."storeId"=${storeId}`;
  return Prisma.sql`WITH candidates AS (
    SELECT o.id FROM orders o WHERE ${scope} AND o.status='COMPLETED' AND
      ((o."completedAt">=${range.from} AND o."completedAt"<${range.to}) OR
       (o."completedAt" IS NULL AND o."createdAt">=${range.from} AND o."createdAt"<${range.to}))
    UNION
    SELECT i."orderId" FROM refund_records r JOIN order_items i ON i.id=r."orderItemId"
      JOIN orders o ON o.id=i."orderId" LEFT JOIN revenue_adjustments a ON a."refundId"=r.id
      WHERE ${scope} AND (a.id IS NULL OR a."effectiveAt" IS NULL OR (a."effectiveAt">=${range.from} AND a."effectiveAt"<${range.to}))
  ), checked AS (
    SELECT o.*, COALESCE(
      o.subtotal BETWEEN 0 AND 999999999999.99 AND o."shippingFee" BETWEEN 0 AND 999999999999.99
      AND o.total BETWEEN 0 AND 999999999999.99 AND o."discountTotal"=0
      AND o.total=o.subtotal+o."shippingFee" AND p.id IS NOT NULL AND p.status='PAID'
      AND p.currency='VND' AND p.amount BETWEEN 0 AND 999999999999.99 AND p.amount=o.total
      AND p."paidAt" IS NOT NULL AND p."paidAt"<=${asOf}
      AND lines.n>0 AND lines.valid AND lines.amount=o.subtotal,FALSE) AS money_ok,
      COALESCE(o."deliveredAt" IS NOT NULL AND o."deliveredAt"<=${asOf} AND
        ((o.status='COMPLETED' AND o."completedAt" IS NOT NULL AND o."completedAt"<=${asOf})
         OR (o.status='DELIVERED' AND o."completedAt" IS NULL)),FALSE) AS time_ok,
      COALESCE(refunds.valid,TRUE) AS refund_ok, COALESCE(refunds.pending,0) AS pending
    FROM candidates c JOIN orders o ON o.id=c.id LEFT JOIN payments p ON p."orderId"=o.id
    LEFT JOIN LATERAL (
      SELECT count(*) AS n, sum(i."lineTotal") AS amount,
        bool_and(i.quantity>0 AND i."unitPrice" BETWEEN 0 AND 999999999999.99
          AND i."lineTotal" BETWEEN 0 AND 999999999999.99
          AND i."lineTotal"=i."unitPrice"*i.quantity) AS valid
      FROM order_items i WHERE i."orderId"=o.id
    ) lines ON TRUE
    LEFT JOIN LATERAL (
      SELECT bool_and(COALESCE(r.amount>0 AND r.amount<=999999999999.99 AND r.amount=i."lineTotal"
        AND r.currency='VND' AND r.mode='SIMULATED' AND r."paymentId"=p.id AND r."succeededAt"<=${asOf}
        AND a.id IS NOT NULL AND a.amount=-r.amount AND q.state='REFUNDED'
        AND ((o.status='DELIVERED' AND o."completedAt" IS NULL AND a."effectiveAt" IS NULL)
          OR (o.status='COMPLETED' AND o."completedAt" IS NOT NULL AND a."effectiveAt"=GREATEST(r."succeededAt",o."completedAt"))),FALSE)) AS valid,
        sum(r.amount) FILTER(WHERE a.id IS NOT NULL AND a."effectiveAt" IS NULL) AS pending
      FROM order_items i JOIN refund_records r ON r."orderItemId"=i.id
        JOIN aftersale_requests q ON q.id=r."requestId"
        LEFT JOIN revenue_adjustments a ON a."refundId"=r.id WHERE i."orderId"=o.id
    ) refunds ON TRUE
  ), financial_orders AS (
    SELECT *, array_remove(ARRAY[
      CASE WHEN NOT money_ok THEN 'MONEY_SNAPSHOT_INVALID' END,
      CASE WHEN NOT time_ok THEN 'FULFILLMENT_TIME_INVALID' END,
      CASE WHEN NOT refund_ok THEN 'REFUND_PROJECTION_INVALID' END],NULL) AS issues,
      money_ok AND time_ok AND refund_ok AS valid FROM checked
  )`;
}

export function financialSummary(
  storeId: number | null,
  range: Range,
  asOf: Date,
) {
  const bucket = range.bucket;
  return Prisma.sql`${financialOrders(storeId, range, asOf)}, events AS (
    SELECT "completedAt" AS at, subtotal AS gross,0::numeric AS refund,"shippingFee" AS shipping,1::bigint AS completed
      FROM financial_orders WHERE valid AND status='COMPLETED' AND "completedAt">=${range.from} AND "completedAt"<${range.to}
    UNION ALL
    SELECT a."effectiveAt",0::numeric,-a.amount,0::numeric,0::bigint
      FROM financial_orders o JOIN order_items i ON i."orderId"=o.id
      JOIN refund_records r ON r."orderItemId"=i.id JOIN revenue_adjustments a ON a."refundId"=r.id
      WHERE o.valid AND a."effectiveAt">=${range.from} AND a."effectiveAt"<${range.to}
  ), grouped AS (
    SELECT to_char(date_trunc(${bucket}::text,at+interval '7 hours'),'YYYY-MM-DD') AS period,
      round(sum(gross),2)::text AS gross,round(sum(refund),2)::text AS refund,
      round(sum(gross-refund),2)::text AS net,round(sum(shipping),2)::text AS shipping,
      sum(completed)::text AS completed FROM events GROUP BY 1
  ) SELECT jsonb_build_object(
    'totals',(SELECT jsonb_build_object('gross',round(coalesce(sum(gross),0),2)::text,
      'refund',round(coalesce(sum(refund),0),2)::text,'net',round(coalesce(sum(gross-refund),0),2)::text,
      'shipping',round(coalesce(sum(shipping),0),2)::text,'completed',coalesce(sum(completed),0)::text) FROM events),
    'buckets',coalesce((SELECT jsonb_agg(to_jsonb(grouped) ORDER BY period) FROM grouped),'[]'::jsonb),
    'pending',(SELECT round(coalesce(sum(pending),0),2)::text FROM financial_orders WHERE valid),
    'invalidCount',(SELECT count(*)::text FROM financial_orders WHERE NOT valid)
  ) AS data`;
}
