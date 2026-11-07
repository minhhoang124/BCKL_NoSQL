import { Prisma } from '@prisma/client';
import { normalizeSearchImageUrl } from '../search/search-image-url-policy.js';

/**
 * Endpoint scope, never the caller's account role: a SELLER account buying from
 * another Store reads /orders under the BUYER policy.
 */
export type OrderImageScope = 'BUYER' | 'SELLER';

// Validation-only origin. The managed-path/http(s) rules of the Search policy
// are reused, but the stored value is returned byte-for-byte (same format as
// /cart and public Product reads). Nothing is fetched.
const VALIDATION_ORIGIN = 'http://media.invalid';

export function safeDisplayImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048)
    return null;
  try {
    normalizeSearchImageUrl(raw, VALIDATION_ORIGIN);
    return raw;
  } catch {
    return null;
  }
}

export const orderImageProductSelect = {
  id: true,
  sellerStatus: true,
  moderationStatus: true,
  store: {
    select: { status: true, sellerId: true, seller: { select: { isActive: true } } },
  },
  images: {
    where: { isPrimary: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: 1,
    select: { url: true },
  },
} satisfies Prisma.ProductSelect;

export type OrderImageProduct = Prisma.ProductGetPayload<{
  select: typeof orderImageProductSelect;
}>;

/**
 * Current illustrative image only; never a historical snapshot. Order name,
 * options and prices always come from OrderItem snapshots.
 */
export function pickOrderItemImage(
  product: OrderImageProduct | undefined,
  scope: OrderImageScope,
  actorId: number,
): string | null {
  if (!product) return null;
  if (scope === 'SELLER') {
    // Own Store only, whatever the listing state.
    if (product.store.sellerId !== actorId) return null;
  } else if (
    product.sellerStatus !== 'ACTIVE' ||
    product.moderationStatus !== 'APPROVED' ||
    product.store.status !== 'ACTIVE' ||
    !product.store.seller.isActive
  )
    return null;
  return safeDisplayImageUrl(product.images[0]?.url);
}

/** One batched query for every product of the already-authorized page. */
export async function loadOrderItemImages(
  tx: Prisma.TransactionClient,
  productIds: number[],
  scope: OrderImageScope,
  actorId: number,
): Promise<Map<number, string | null>> {
  const ids = [...new Set(productIds)];
  const images = new Map<number, string | null>();
  if (!ids.length) return images;
  const products = await tx.product.findMany({
    where: {
      id: { in: ids },
      ...(scope === 'SELLER' ? { store: { sellerId: actorId } } : {}),
    },
    select: orderImageProductSelect,
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const id of ids)
    images.set(id, pickOrderItemImage(byId.get(id), scope, actorId));
  return images;
}
