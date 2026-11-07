import { Prisma } from '@prisma/client';
import { readOrderOptions } from './order-detail.service.js';

export const ORDER_ITEM_PREVIEW_LIMIT = 3;

export interface OrderItemPreviewRow {
  id: number;
  orderId: number;
  productId: number;
  variantId: number;
  productNameSnapshot: string;
  optionSnapshot: Prisma.JsonValue;
  unitPrice: Prisma.Decimal;
  quantity: number;
  lineTotal: Prisma.Decimal;
  lineCount: number;
  totalQuantity: number;
}

export interface OrderItemPreview {
  orderItemId: number;
  productId: number;
  variantId: number;
  productName: string;
  /** null = saved snapshot unreadable; never replaced by live catalog data. */
  options: string[] | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  imageUrl: string | null;
}

export interface OrderItemSummary {
  itemPreview: OrderItemPreview[];
  itemCount: number;
  totalQuantity: number;
  hasMoreItems: boolean;
}

/**
 * Bounded preview for the page's orders only: at most LIMIT rows per order,
 * counts computed over every line before the cut. All values are bound
 * parameters; window aggregates are cast to int in SQL (≤ 50 lines × 99 units
 * per order) so the driver never returns bigint.
 */
export function loadOrderItemPreviewRows(
  tx: Prisma.TransactionClient,
  orderIds: number[],
): Promise<OrderItemPreviewRow[]> {
  if (!orderIds.length) return Promise.resolve([]);
  return tx.$queryRaw<OrderItemPreviewRow[]>(Prisma.sql`
    SELECT "id", "orderId", "productId", "variantId", "productNameSnapshot",
           "optionSnapshot", "unitPrice", "quantity", "lineTotal",
           "lineCount", "totalQuantity"
    FROM (
      SELECT oi."id", oi."orderId", oi."productId", oi."variantId",
             oi."productNameSnapshot", oi."optionSnapshot", oi."unitPrice",
             oi."quantity", oi."lineTotal",
             (COUNT(*) OVER w)::int AS "lineCount",
             (SUM(oi."quantity") OVER w)::int AS "totalQuantity",
             ROW_NUMBER() OVER (w ORDER BY oi."id") AS "position"
      FROM "order_items" oi
      WHERE oi."orderId" IN (${Prisma.join(orderIds)})
      WINDOW w AS (PARTITION BY oi."orderId")
    ) ranked
    WHERE ranked."position" <= ${ORDER_ITEM_PREVIEW_LIMIT}
    ORDER BY "orderId" ASC, "id" ASC
  `);
}

// One malformed legacy line must not make the whole order list unreadable.
// Detail keeps failing closed for that order; the list only drops options.
function previewOptions(snapshot: Prisma.JsonValue): string[] | null {
  try {
    return readOrderOptions(snapshot);
  } catch {
    return null;
  }
}

function count(value: unknown): number {
  const result = typeof value === 'bigint' ? Number(value) : value;
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0)
    throw new Error('Invalid order item aggregate');
  return result;
}

/** Pure projection: snapshot name/options/prices; image is current-only. */
export function buildOrderItemSummaries(
  orderIds: number[],
  rows: OrderItemPreviewRow[],
  images: Map<number, string | null>,
): Map<number, OrderItemSummary> {
  const summaries = new Map<number, OrderItemSummary>(
    orderIds.map((id) => [
      id,
      { itemPreview: [], itemCount: 0, totalQuantity: 0, hasMoreItems: false },
    ]),
  );
  const sorted = [...rows].sort((a, b) => a.orderId - b.orderId || a.id - b.id);
  for (const row of sorted) {
    const summary = summaries.get(row.orderId);
    // Never project rows for an order outside the authorized page.
    if (!summary || summary.itemPreview.length >= ORDER_ITEM_PREVIEW_LIMIT)
      continue;
    summary.itemCount = count(row.lineCount);
    summary.totalQuantity = count(row.totalQuantity);
    summary.itemPreview.push({
      orderItemId: row.id,
      productId: row.productId,
      variantId: row.variantId,
      productName: row.productNameSnapshot,
      options: previewOptions(row.optionSnapshot),
      quantity: row.quantity,
      unitPrice: new Prisma.Decimal(row.unitPrice).toFixed(2),
      lineTotal: new Prisma.Decimal(row.lineTotal).toFixed(2),
      imageUrl: images.get(row.productId) ?? null,
    });
  }
  for (const summary of summaries.values())
    summary.hasMoreItems = summary.itemCount > summary.itemPreview.length;
  return summaries;
}
