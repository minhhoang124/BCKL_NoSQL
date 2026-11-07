// Pure planning logic for the maintenance commands in redis-cart-admin.cli.ts.
import { BIGINT_MAX } from './cart-redis-protocol.js';

const MAX = BigInt(BIGINT_MAX);

/**
 * Next value for setval(cart_line_seq, target, false): strictly above the current
 * sequence position, every fence and every Redis _hw. Never lowers the sequence.
 */
export function bumpTarget(input: {
  lastValue: string;
  fenceMax: string;
  hwMax: string;
}): string {
  const floor = [input.lastValue, input.fenceMax, input.hwMax]
    .map((value) => {
      if (!/^[0-9]+$/.test(value)) throw new Error(`Invalid bigint: ${value}`);
      return BigInt(value);
    })
    .reduce((a, b) => (a > b ? a : b));
  if (floor >= MAX)
    throw new Error(
      `cart_line_seq cannot be advanced: floor ${floor} is at bigint max ${BIGINT_MAX}`,
    );
  return (floor + 1n).toString();
}

export interface ImportItem {
  id: number;
  variantId: number;
  quantity: number;
  updatedAt: Date;
  variantExists: boolean;
}

export type SkipReason =
  | 'QUANTITY_OUT_OF_RANGE'
  | 'VARIANT_MISSING'
  | 'CONSUMED_AFTER_UPDATE';

/**
 * Keeps out-of-stock / unlisted lines (GET marks them unavailable, as today). Skips a
 * line whose fence is at least as new as the line (ties skip: conservative, may drop).
 */
export function planImport(
  items: ImportItem[],
  fences: Map<number, Date>,
  maxQuantity: number,
) {
  const lines: { variantId: number; quantity: number }[] = [];
  const skipped: { variantId: number; reason: SkipReason }[] = [];
  for (const item of [...items].sort((a, b) => a.id - b.id)) {
    const fence = fences.get(item.variantId);
    if (!item.variantExists)
      skipped.push({ variantId: item.variantId, reason: 'VARIANT_MISSING' });
    else if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > maxQuantity
    )
      skipped.push({ variantId: item.variantId, reason: 'QUANTITY_OUT_OF_RANGE' });
    else if (fence && fence.getTime() >= item.updatedAt.getTime())
      skipped.push({ variantId: item.variantId, reason: 'CONSUMED_AFTER_UPDATE' });
    else lines.push({ variantId: item.variantId, quantity: item.quantity });
  }
  return { lines, skipped };
}
