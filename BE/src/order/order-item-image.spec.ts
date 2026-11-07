import { vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  loadOrderItemImages,
  pickOrderItemImage,
  safeDisplayImageUrl,
  type OrderImageProduct,
} from './order-item-image.js';

const SELLER_ID = 7;
function product(
  overrides: Partial<{
    sellerStatus: OrderImageProduct['sellerStatus'];
    moderationStatus: OrderImageProduct['moderationStatus'];
    storeStatus: OrderImageProduct['store']['status'];
    sellerActive: boolean;
    sellerId: number;
    url: string | null;
  }> = {},
): OrderImageProduct {
  const url = overrides.url === undefined ? '/uploads/a.jpg' : overrides.url;
  return {
    id: 1,
    sellerStatus: overrides.sellerStatus ?? 'ACTIVE',
    moderationStatus: overrides.moderationStatus ?? 'APPROVED',
    store: {
      status: overrides.storeStatus ?? 'ACTIVE',
      sellerId: overrides.sellerId ?? SELLER_ID,
      seller: { isActive: overrides.sellerActive ?? true },
    },
    images: url === null ? [] : [{ url }],
  };
}

describe('safeDisplayImageUrl (reuses Search URL policy, returns stored bytes)', () => {
  it.each([
    '/uploads/a.jpg',
    '/uploads/products/12/a%20b.webp',
    'https://cdn.example.com/x.jpg',
  ])('keeps valid %s unchanged', (url) =>
    expect(safeDisplayImageUrl(url)).toBe(url),
  );
  it.each([
    '',
    null,
    undefined,
    42,
    '/etc/passwd',
    '/uploads/../secret',
    '/uploads/%2e%2e/secret',
    '/uploads/a.jpg?token=1',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://user:pass@example.com/a.jpg',
    'uploads/a.jpg',
    '/uploads/a b.jpg',
    'x'.repeat(2049),
  ])('returns null for invalid %j', (url) =>
    expect(safeDisplayImageUrl(url)).toBeNull(),
  );
});

describe('pickOrderItemImage', () => {
  it('BUYER scope: public product returns primary image', () => {
    expect(pickOrderItemImage(product(), 'BUYER', 99)).toBe('/uploads/a.jpg');
  });
  it.each([
    { sellerStatus: 'HIDDEN' as const },
    { sellerStatus: 'DRAFT' as const },
    { moderationStatus: 'REJECTED' as const },
    { moderationStatus: 'FROZEN' as const },
    { moderationStatus: 'PENDING' as const },
    { storeStatus: 'SUSPENDED' as const },
    { storeStatus: 'CLOSED' as const },
    { sellerActive: false },
    { url: null },
    { url: '/not-managed.jpg' },
  ])('BUYER scope: unavailable product/image %j gives null', (overrides) => {
    expect(pickOrderItemImage(product(overrides), 'BUYER', 99)).toBeNull();
  });
  it('missing product gives null for both scopes', () => {
    expect(pickOrderItemImage(undefined, 'BUYER', 99)).toBeNull();
    expect(pickOrderItemImage(undefined, 'SELLER', SELLER_ID)).toBeNull();
  });
  it('SELLER scope: own hidden/rejected product still shows its image', () => {
    expect(
      pickOrderItemImage(
        product({ sellerStatus: 'HIDDEN', moderationStatus: 'REJECTED' }),
        'SELLER',
        SELLER_ID,
      ),
    ).toBe('/uploads/a.jpg');
  });
  it('SELLER scope: never another Store product', () => {
    expect(pickOrderItemImage(product(), 'SELLER', 8)).toBeNull();
  });
  it('scope, not account role: a seller account in BUYER scope gets BUYER rules even for its own hidden product', () => {
    expect(
      pickOrderItemImage(
        product({ sellerStatus: 'HIDDEN' }),
        'BUYER',
        SELLER_ID,
      ),
    ).toBeNull();
  });
});

describe('loadOrderItemImages', () => {
  const tx = (rows: OrderImageProduct[]) => {
    const findMany = vi.fn().mockResolvedValue(rows);
    return {
      findMany,
      tx: { product: { findMany } } as unknown as Prisma.TransactionClient,
    };
  };
  it('does not query when there are no products', async () => {
    const { tx: client, findMany } = tx([]);
    expect((await loadOrderItemImages(client, [], 'BUYER', 1)).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('one deduplicated query; BUYER has no Store filter; missing products map to null', async () => {
    const { tx: client, findMany } = tx([product()]);
    const result = await loadOrderItemImages(client, [1, 1, 2], 'BUYER', 99);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0].where).toEqual({ id: { in: [1, 2] } });
    expect([...result]).toEqual([
      [1, '/uploads/a.jpg'],
      [2, null],
    ]);
  });
  it('SELLER filters by the owning seller in SQL', async () => {
    const { tx: client, findMany } = tx([]);
    await loadOrderItemImages(client, [1], 'SELLER', SELLER_ID);
    expect(findMany.mock.calls[0]![0].where).toEqual({
      id: { in: [1] },
      store: { sellerId: SELLER_ID },
    });
  });
  it('selects no private Product fields', async () => {
    const { tx: client, findMany } = tx([]);
    await loadOrderItemImages(client, [1], 'BUYER', 1);
    const select = findMany.mock.calls[0]![0].select;
    expect(Object.keys(select).sort()).toEqual(
      ['id', 'images', 'moderationStatus', 'sellerStatus', 'store'].sort(),
    );
    expect(select.images.where).toEqual({ isPrimary: true });
  });
});
