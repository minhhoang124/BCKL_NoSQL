import { Prisma, Role } from '@prisma/client';
import { vi } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import { OrderDetailService } from './order-detail.service.js';
import {
  buildOrderItemSummaries,
  loadOrderItemPreviewRows,
  ORDER_ITEM_PREVIEW_LIMIT,
  type OrderItemPreviewRow,
} from './order-item-preview.js';
import { OrderListService } from './order-list.service.js';

function line(
  orderId: number,
  id: number,
  extra: Partial<OrderItemPreviewRow> = {},
): OrderItemPreviewRow {
  return {
    id,
    orderId,
    productId: 100 + id,
    variantId: 200 + id,
    productNameSnapshot: `Snapshot ${id}`,
    optionSnapshot: [
      { groupId: 1, groupName: 'Color', valueId: 2, value: 'Black', x: 'hide' },
    ],
    unitPrice: new Prisma.Decimal('1000'),
    quantity: 2,
    lineTotal: new Prisma.Decimal('2000'),
    lineCount: 1,
    totalQuantity: 2,
    ...extra,
  };
}

describe('buildOrderItemSummaries', () => {
  it('keeps snapshot name/options/prices, ascending order and limit 3 with hasMoreItems', () => {
    const rows = [3, 1, 2].map((id) =>
      line(10, id, { lineCount: 5, totalQuantity: 9 }),
    );
    const images = new Map<number, string | null>([
      [101, '/uploads/1.jpg'],
      [102, null],
    ]);
    const summary = buildOrderItemSummaries([10], rows, images).get(10)!;
    expect(summary.itemCount).toBe(5);
    expect(summary.totalQuantity).toBe(9);
    expect(summary.hasMoreItems).toBe(true);
    expect(summary.itemPreview.map((item) => item.orderItemId)).toEqual([
      1, 2, 3,
    ]);
    expect(summary.itemPreview[0]).toEqual({
      orderItemId: 1,
      productId: 101,
      variantId: 201,
      productName: 'Snapshot 1',
      options: ['Black'],
      quantity: 2,
      unitPrice: '1000.00',
      lineTotal: '2000.00',
      imageUrl: '/uploads/1.jpg',
    });
    expect(summary.itemPreview[1]!.imageUrl).toBeNull();
    expect(summary.itemPreview[2]!.imageUrl).toBeNull();
    expect(JSON.stringify(summary)).not.toContain('hide');
  });
  it('never exceeds the limit even if more rows arrive', () => {
    const rows = [1, 2, 3, 4, 5].map((id) =>
      line(10, id, { lineCount: 5, totalQuantity: 10 }),
    );
    const summary = buildOrderItemSummaries([10], rows, new Map()).get(10)!;
    expect(summary.itemPreview).toHaveLength(ORDER_ITEM_PREVIEW_LIMIT);
  });
  it('single line has no more items; legacy order without lines is empty', () => {
    const result = buildOrderItemSummaries([10, 11], [line(10, 1)], new Map());
    expect(result.get(10)).toMatchObject({
      itemCount: 1,
      totalQuantity: 2,
      hasMoreItems: false,
    });
    expect(result.get(11)).toEqual({
      itemPreview: [],
      itemCount: 0,
      totalQuantity: 0,
      hasMoreItems: false,
    });
  });
  it('drops rows of orders outside the authorized page', () => {
    const result = buildOrderItemSummaries([10], [line(99, 1)], new Map());
    expect([...result.keys()]).toEqual([10]);
    expect(result.get(10)!.itemPreview).toEqual([]);
  });
  it('accepts bigint aggregates safely and rejects invalid ones', () => {
    const ok = buildOrderItemSummaries(
      [10],
      [
        line(10, 1, {
          lineCount: 2n as unknown as number,
          totalQuantity: 3n as unknown as number,
        }),
      ],
      new Map(),
    ).get(10)!;
    expect(ok.itemCount).toBe(2);
    expect(ok.totalQuantity).toBe(3);
    expect(() =>
      buildOrderItemSummaries(
        [10],
        [line(10, 1, { lineCount: -1 })],
        new Map(),
      ),
    ).toThrow('Invalid order item aggregate');
  });
  it('unreadable option snapshot nulls only that line options, without leaking JSON or breaking other lines', () => {
    const summary = buildOrderItemSummaries(
      [10],
      [
        line(10, 1, {
          optionSnapshot: { private: 'broken-private-json' },
          lineCount: 2,
          totalQuantity: 4,
        }),
        line(10, 2, { lineCount: 2, totalQuantity: 4 }),
      ],
      new Map(),
    ).get(10)!;
    expect(summary.itemPreview.map((item) => item.options)).toEqual([
      null,
      ['Black'],
    ]);
    expect(summary.itemPreview[0]!.productName).toBe('Snapshot 1');
    expect(summary.itemPreview[0]!.unitPrice).toBe('1000.00');
    expect(JSON.stringify(summary)).not.toContain('broken-private-json');
  });
});

describe('loadOrderItemPreviewRows SQL', () => {
  it('skips the query for an empty page', async () => {
    const queryRaw = vi.fn();
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;
    expect(await loadOrderItemPreviewRows(tx, [])).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it('binds every order ID and the limit as parameters and casts aggregates to int', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;
    await loadOrderItemPreviewRows(tx, [5, 4]);
    const sql = queryRaw.mock.calls[0]![0] as Prisma.Sql;
    expect(sql.values).toEqual([5, 4, ORDER_ITEM_PREVIEW_LIMIT]);
    expect(sql.sql).not.toMatch(/\b5\b|\b4\b/);
    expect(sql.sql).toContain('(COUNT(*) OVER w)::int');
    expect(sql.sql).toContain('(SUM(oi."quantity") OVER w)::int');
  });
});

// Service-level wiring with an in-memory transaction double. It proves query
// shape/scope; it is not PostgreSQL evidence (see e2e specs).
type Call = { kind: string; arg?: unknown };
function fakePrisma(options: {
  role: Role;
  orders?: { id: number }[];
  previewRows?: OrderItemPreviewRow[];
  products?: unknown[];
  detail?: unknown;
}) {
  const calls: Call[] = [];
  const isSql = (value: unknown): value is Prisma.Sql =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'values' in value &&
    'strings' in value;
  const write = (name: string) =>
    vi.fn(() => {
      throw new Error(`unexpected write ${name}`);
    });
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (arg: unknown) => {
      if (isSql(arg)) {
        calls.push({ kind: 'preview', arg });
        return options.previewRows ?? [];
      }
      return [];
    }),
    user: {
      findUnique: vi.fn(async () => ({ isActive: true, role: options.role })),
    },
    order: {
      findMany: vi.fn(async (arg: unknown) => {
        calls.push({ kind: 'orders', arg });
        return (options.orders ?? []).map((order) => ({
          id: order.id,
          orderNumber: `ORD-${order.id}`,
          status: 'CONFIRMED',
          total: new Prisma.Decimal('2000'),
          createdAt: new Date('2026-10-31T00:00:00Z'),
          updatedAt: new Date('2026-10-31T00:00:00Z'),
          store: { id: 1, name: 'Store' },
          payment: null,
        }));
      }),
      findFirst: vi.fn(async () => options.detail ?? null),
      update: write('order.update'),
      updateMany: write('order.updateMany'),
    },
    product: {
      findMany: vi.fn(async (arg: unknown) => {
        calls.push({ kind: 'products', arg });
        return options.products ?? [];
      }),
      update: write('product.update'),
    },
    productVariant: { update: write('variant.update') },
    payment: { update: write('payment.update') },
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  } as unknown as PrismaService;
  return { prisma, calls, tx };
}

const publicProduct = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  sellerStatus: 'ACTIVE',
  moderationStatus: 'APPROVED',
  store: { status: 'ACTIVE', sellerId: 7, seller: { isActive: true } },
  images: [{ url: `/uploads/${id}.jpg` }],
  ...overrides,
});

describe('OrderListService preview wiring', () => {
  const previous = process.env.ACCOUNT_BUYER_ACCESS_ENABLED;
  afterEach(() => {
    if (previous === undefined) delete process.env.ACCOUNT_BUYER_ACCESS_ENABLED;
    else process.env.ACCOUNT_BUYER_ACCESS_ENABLED = previous;
  });

  it('uses only returned page IDs (not the +1 probe) and one product query for many orders', async () => {
    const { prisma, calls } = fakePrisma({
      role: Role.USER,
      orders: [{ id: 30 }, { id: 20 }, { id: 10 }],
      previewRows: [line(30, 1), line(20, 2), line(20, 3)],
      products: [publicProduct(101), publicProduct(102), publicProduct(103)],
    });
    const result = await new OrderListService(prisma).list(5, 'USER', {
      limit: '2',
    });
    const preview = calls.filter((call) => call.kind === 'preview');
    const products = calls.filter((call) => call.kind === 'products');
    expect(preview).toHaveLength(1);
    expect((preview[0]!.arg as Prisma.Sql).values).toEqual([
      30,
      20,
      ORDER_ITEM_PREVIEW_LIMIT,
    ]);
    expect(products).toHaveLength(1);
    expect(result.nextCursor).toBe(20);
    expect(result.items.map((item) => item.itemCount)).toEqual([1, 1]);
    expect(result.items[0]!.itemPreview[0]!.imageUrl).toBe('/uploads/101.jpg');
  });

  it('a SELLER account on /orders (BUYER scope) gets BUYER image rules, no Store filter', async () => {
    process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
    const { prisma, calls } = fakePrisma({
      role: Role.SELLER,
      orders: [{ id: 30 }],
      previewRows: [line(30, 1)],
      // Purchased from another Store, now hidden: Buyer must see null.
      products: [publicProduct(101, { sellerStatus: 'HIDDEN' })],
    });
    const result = await new OrderListService(prisma).list(7, 'USER', {});
    const orderWhere = (calls.find((call) => call.kind === 'orders')!.arg as {
      where: Record<string, unknown>;
    }).where;
    expect(orderWhere).toMatchObject({ buyerId: 7 });
    const productWhere = (calls.find((call) => call.kind === 'products')!
      .arg as { where: Record<string, unknown> }).where;
    expect(productWhere).toEqual({ id: { in: [101] } });
    expect(result.items[0]!.itemPreview[0]!.imageUrl).toBeNull();
  });

  it('/seller/orders uses SELLER policy restricted to the owning seller', async () => {
    const { prisma, calls } = fakePrisma({
      role: Role.SELLER,
      orders: [{ id: 30 }],
      previewRows: [line(30, 1)],
      products: [publicProduct(101, { sellerStatus: 'HIDDEN' })],
    });
    const result = await new OrderListService(prisma).list(7, 'SELLER', {});
    const productWhere = (calls.find((call) => call.kind === 'products')!
      .arg as { where: Record<string, unknown> }).where;
    expect(productWhere).toEqual({
      id: { in: [101] },
      store: { sellerId: 7 },
    });
    expect(result.items[0]!.itemPreview[0]!.imageUrl).toBe('/uploads/101.jpg');
  });

  it('empty page issues no preview/product queries', async () => {
    const { prisma, calls } = fakePrisma({ role: Role.USER, orders: [] });
    expect(await new OrderListService(prisma).list(5, 'USER', {})).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(calls.map((call) => call.kind)).toEqual(['orders']);
  });
});

describe('OrderDetailService image wiring', () => {
  const detailRow = {
    id: 1,
    orderNumber: 'ORD-1',
    status: 'CONFIRMED',
    buyerId: 5,
    store: { id: 1, name: 'Store' },
    recipientNameSnapshot: 'R',
    phoneSnapshot: '0900000000',
    provinceSnapshot: 'P',
    districtSnapshot: null,
    wardSnapshot: 'W',
    addressLineSnapshot: 'A',
    postalCodeSnapshot: null,
    deliveryNoteSnapshot: null,
    subtotal: new Prisma.Decimal('2000'),
    shippingFee: new Prisma.Decimal('0'),
    discountTotal: new Prisma.Decimal('0'),
    total: new Prisma.Decimal('2000'),
    cancelledByType: null,
    cancelledById: null,
    cancellationReasonCode: null,
    cancellationReasonText: null,
    cancelledAt: null,
    createdAt: new Date('2026-10-31T00:00:00Z'),
    updatedAt: new Date('2026-10-31T00:00:00Z'),
    items: [
      {
        id: 11,
        productId: 101,
        variantId: 201,
        productNameSnapshot: 'Purchased name',
        skuSnapshot: 'SKU-AT-PURCHASE',
        optionSnapshot: ['Black'],
        unitPrice: new Prisma.Decimal('1000'),
        quantity: 2,
        lineTotal: new Prisma.Decimal('2000'),
      },
      {
        id: 12,
        productId: 102,
        variantId: 202,
        productNameSnapshot: 'Second',
        skuSnapshot: 'SKU-2',
        optionSnapshot: [],
        unitPrice: new Prisma.Decimal('0'),
        quantity: 1,
        lineTotal: new Prisma.Decimal('0'),
      },
    ],
    payment: null,
    statusHistory: [],
  };

  it('adds current image or null without touching snapshot fields', async () => {
    const { prisma, calls } = fakePrisma({
      role: Role.USER,
      detail: detailRow,
      products: [publicProduct(101, { name: 'Renamed' })],
    });
    const result = await new OrderDetailService(prisma).detail(
      5,
      'USER',
      '1',
      {},
    );
    expect(calls.filter((call) => call.kind === 'products')).toHaveLength(1);
    expect(result.items).toEqual([
      {
        id: 11,
        productId: 101,
        variantId: 201,
        productName: 'Purchased name',
        sku: 'SKU-AT-PURCHASE',
        options: ['Black'],
        unitPrice: '1000.00',
        quantity: 2,
        lineTotal: '2000.00',
        imageUrl: '/uploads/101.jpg',
      },
      expect.objectContaining({ id: 12, imageUrl: null }),
    ]);
  });

  it('seller detail route filters products by the owning seller', async () => {
    const { prisma, calls } = fakePrisma({
      role: Role.SELLER,
      detail: detailRow,
      products: [],
    });
    const result = await new OrderDetailService(prisma).detail(
      7,
      'SELLER',
      '1',
      {},
    );
    expect(
      (calls.find((call) => call.kind === 'products')!.arg as {
        where: unknown;
      }).where,
    ).toEqual({ id: { in: [101, 102] }, store: { sellerId: 7 } });
    expect(result.items.map((item) => item.imageUrl)).toEqual([null, null]);
  });
});
