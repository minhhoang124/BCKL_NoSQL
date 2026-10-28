import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';

// Historical financial snapshots are synthetic fixtures, not proof of checkout.
// Retain every row: no reset, deletion, demo connection or dotenv loading.
describe('Dashboard shared revenue/refund HTTP and PostgreSQL', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    passwordHash: string;
  const password = 'Synthetic-dashboard-QA-only-2026';
  const mark = () => 'dashboard-' + randomUUID();
  const jan = '?from=2026-01-01&to=2026-02-01';
  const feb = '?from=2026-02-01&to=2026-03-01';
  const date = (value: string) => new Date(value);
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const local =
      url.hostname === '127.0.0.1' &&
      url.port === '5549' &&
      ['/bckl_order_resolution_test_attributes_20261019_v951','/bckl_order_resolution_test_attributes_20261019_v953', '/bckl_order_resolution_test_attributes_20261019_v955', '/bckl_order_resolution_test_attributes_20261019_v957', '/bckl_order_resolution_test_attributes_20261019_v959', '/bckl_order_resolution_test_attributes_20261019_v961', '/bckl_order_resolution_test_attributes_20261019_v965', '/bckl_order_resolution_test_attributes_20261019_v967', '/bckl_order_resolution_test_attributes_20261019_v971', '/bckl_order_resolution_test_attributes_20261019_v973'].includes(url.pathname);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      ((url.pathname === '/klcn_ecommerce' &&
        ['', '5432'].includes(url.port)) ||
        (url.pathname === '/bckl_order_resolution_test_attributes_20261019' &&
          url.port === '5549'));
    if (
      (!local && !ci) ||
      url.protocol !== 'postgresql:' ||
      url.hash ||
      [...url.searchParams].some(
        ([k, v]) => k !== 'schema' || v !== 'public',
      ) ||
      url.searchParams.getAll('schema').length > 1
    )
      throw Error('Exact isolated Dashboard QA required');
    passwordHash = await hash(password, 4);
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
  });
  afterAll(async () => {
    await app?.close();
  });
  async function actor(role: Role = 'USER') {
    const user = await db.user.create({
      data: { email: mark() + '@example.invalid', passwordHash, role },
    });
    return {
      ...user,
      token: (await auth.login({ email: user.email, password })).accessToken,
    };
  }
  async function fixture(status: 'ACTIVE' | 'CLOSED' = 'ACTIVE') {
    const seller = await actor('SELLER'),
      buyer = await actor();
    const store = await db.store.create({
      data: { sellerId: seller.id, name: mark(), status },
    });
    const category = await db.category.create({
      data: { name: mark(), slug: mark() },
    });
    const product = await db.product.create({
      data: { storeId: store.id, categoryId: category.id, name: mark() },
    });
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        storeId: store.id,
        skuCode: mark(),
        optionSignature: '[]',
        price: '100000.00',
        stock: 10,
      },
    });
    return { seller, buyer, store, product, variant };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function order(
    f: Fixture,
    amount = '100000.00',
    completedAt: Date | null = date('2026-01-31T16:59:59.999Z'),
    shipping = '20000.00',
  ) {
    const checkout = await db.checkout.create({
      data: {
        buyerId: f.buyer.id,
        idempotencyKey: mark(),
        requestHash: 'synthetic-dashboard-snapshot',
      },
    });
    const total = (
      BigInt(amount.replace('.', '')) + BigInt(shipping.replace('.', ''))
    )
      .toString()
      .padStart(3, '0');
    const totalMoney = total.slice(0, -2) + '.' + total.slice(-2);
    return db.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: f.buyer.id,
        storeId: f.store.id,
        orderNumber: mark(),
        status: completedAt ? 'COMPLETED' : 'DELIVERED',
        createdAt: date('2026-01-01T00:00:00Z'),
        deliveredAt: date('2026-01-15T00:00:00Z'),
        completedAt,
        recipientNameSnapshot: 'Synthetic QA',
        phoneSnapshot: '0000000000',
        provinceSnapshot: 'QA',
        wardSnapshot: 'QA',
        addressLineSnapshot: 'Private QA',
        subtotal: amount,
        shippingFee: shipping,
        total: totalMoney,
        payment: {
          create: {
            provider: 'COD',
            status: 'PAID',
            amount: totalMoney,
            paidAt: date('2026-01-15T00:00:00Z'),
          },
        },
        items: {
          create: {
            productId: f.product.id,
            variantId: f.variant.id,
            quantity: 1,
            unitPrice: amount,
            lineTotal: amount,
            productNameSnapshot: 'Synthetic historical item',
            skuSnapshot: f.variant.skuCode,
            optionSnapshot: {},
          },
        },
      },
      include: { items: true, payment: true },
    });
  }
  async function refund(
    o: Awaited<ReturnType<typeof order>>,
    missingAdjustment = false,
  ) {
    const succeededAt = date('2026-02-03T00:00:00Z');
    const q = await db.aftersaleRequest.create({
      data: {
        orderItemId: o.items[0]!.id,
        kind: 'REFUND_ONLY',
        state: 'REFUNDED',
        reasonCode: 'DAMAGED',
        description: 'Synthetic historical refund',
        createdAt: succeededAt,
        deadlineAt: succeededAt,
      },
    });
    const r = await db.refundRecord.create({
      data: {
        requestId: q.id,
        orderItemId: o.items[0]!.id,
        paymentId: o.payment!.id,
        amount: o.subtotal,
        succeededAt,
      },
    });
    if (!missingAdjustment)
      await db.revenueAdjustment.create({
        data: {
          refundId: r.id,
          amount: '-' + o.subtotal.toFixed(2),
          effectiveAt: o.completedAt
            ? new Date(Math.max(o.completedAt.getTime(), succeededAt.getTime()))
            : null,
        },
      });
  }
  const get = (token: string, query = jan, route = '/seller/dashboard') =>
    http()
      .get(route + query)
      .auth(token, { type: 'bearer' });
  it('attributes gross to completion and refund to its own period; shipping excluded', async () => {
    const f = await fixture('CLOSED'),
      o = await order(f);
    await refund(o);
    const a = (
      await get(f.seller.token).expect(200).expect('Cache-Control', 'no-store')
    ).body;
    expect(a.totals).toEqual({
      completedOrderCount: 1,
      grossMerchandise: '100000.00',
      effectiveRefundMerchandise: '0.00',
      netMerchandise: '100000.00',
      completedShipping: '20000.00',
    });
    expect(a.buckets).toHaveLength(31);
    expect(a.buckets[30].grossMerchandise).toBe('100000.00');
    expect(a.store.status).toBe('CLOSED');
    const b = (await get(f.seller.token, feb).expect(200)).body;
    expect(b.totals.netMerchandise).toBe('-100000.00');
    expect(b.totals.completedOrderCount).toBe(0);
    expect(b.totals.effectiveRefundMerchandise).toBe('100000.00');
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: o.payment!.id } }))
        .status,
    ).toBe('PAID');
  });
  it('reports pending refunds separately without premature negative revenue', async () => {
    const f = await fixture(),
      o = await order(f, '100000.00', null);
    await refund(o);
    const a = (await get(f.seller.token).expect(200)).body;
    expect(a.pendingRefundMerchandise).toBe('100000.00');
    expect(a.pendingRefundScope).toBe('LIFETIME_AS_OF');
    expect(a.totals.netMerchandise).toBe('0.00');
    expect(a.totals.completedOrderCount).toBe(0);
    const key = randomUUID();
    await http()
      .post(`/orders/${o.id}/complete`)
      .auth(f.buyer.token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({})
      .expect(200);
    // Replay the real completion: pending activation and gross remain single.
    await http()
      .post(`/orders/${o.id}/complete`)
      .auth(f.buyer.token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({})
      .expect(200);
    const completed = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    const local = new Date(completed.completedAt!.getTime() + 7 * 3600000);
    const start = local.toISOString().slice(0, 10);
    local.setUTCDate(local.getUTCDate() + 1);
    const b = (
      await get(
        f.seller.token,
        `?from=${start}&to=${local.toISOString().slice(0, 10)}`,
      ).expect(200)
    ).body;
    expect(b.pendingRefundMerchandise).toBe('0.00');
    expect(b.totals).toEqual({
      completedOrderCount: 1,
      grossMerchandise: '100000.00',
      effectiveRefundMerchandise: '100000.00',
      netMerchandise: '0.00',
      completedShipping: '20000.00',
    });
  });
  it('counts a multi-item order once while aggregating multiple refunds', async () => {
    const f = await fixture(),
      o = await order(f);
    await db.orderItem.update({
      where: { id: o.items[0]!.id },
      data: { unitPrice: '50000.00', lineTotal: '50000.00' },
    });
    const second = await db.orderItem.create({
      data: {
        orderId: o.id,
        storeId: f.store.id,
        productId: f.product.id,
        variantId: f.variant.id,
        quantity: 1,
        unitPrice: '50000.00',
        lineTotal: '50000.00',
        productNameSnapshot: 'Second synthetic line',
        skuSnapshot: f.variant.skuCode,
        optionSnapshot: {},
      },
    });
    const first = await db.orderItem.findUniqueOrThrow({
      where: { id: o.items[0]!.id },
    });
    for (const item of [first, second])
      await refund({ ...o, subtotal: item.lineTotal, items: [item] });
    const a = (await get(f.seller.token).expect(200)).body;
    expect(a.totals.completedOrderCount).toBe(1);
    expect(a.totals.grossMerchandise).toBe('100000.00');
    expect(
      (await get(f.seller.token, feb).expect(200)).body.totals
        .effectiveRefundMerchandise,
    ).toBe('100000.00');
  });
  it('uses exclusive quality cursors and never exposes another store', async () => {
    const f = await fixture(),
      foreign = await fixture();
    await order(f, '7.00', undefined, '0.00');
    await order(foreign, '9000.00', undefined, '0.00');
    expect(
      (await get(f.seller.token).expect(200)).body.totals.grossMerchandise,
    ).toBe('7.00');
    const ids: number[] = [];
    for (const target of [f, f, foreign]) {
      const o = await order(target);
      await refund(o, true);
      if (target === f) ids.push(o.id);
    }
    const route = '/seller/dashboard/data-quality';
    const a = (await get(f.seller.token, jan + '&limit=1', route).expect(200))
      .body;
    expect(a.items.map((i: { orderId: number }) => i.orderId)).toEqual([
      ids[1],
    ]);
    expect(a.nextBeforeId).toBe(ids[1]);
    const b = (
      await get(
        f.seller.token,
        jan + '&limit=1&beforeId=' + a.nextBeforeId,
        route,
      ).expect(200)
    ).body;
    expect(b.items.map((i: { orderId: number }) => i.orderId)).toEqual([
      ids[0],
    ]);
    expect(b.nextBeforeId).toBeNull();
    expect(Object.keys(b.items[0]).sort()).toEqual([
      'issues',
      'orderId',
      'storeId',
    ]);
  });
  it('aligns actual SQL day/month/quarter events with local half-open boundaries', async () => {
    const f = await fixture();
    await order(f, '7.00', date('2026-01-31T16:59:59.999Z'), '0.00');
    await order(f, '9.00', date('2026-01-31T17:00:00.000Z'), '0.00');
    expect(
      (await get(f.seller.token).expect(200)).body.totals.grossMerchandise,
    ).toBe('7.00');
    expect(
      (await get(f.seller.token, feb).expect(200)).body.buckets[0]
        .grossMerchandise,
    ).toBe('9.00');
    const query = '?from=2026-01-15&to=2026-02-15&bucket=';
    const month = (await get(f.seller.token, query + 'month').expect(200)).body;
    expect(
      month.buckets.map(
        (v: { grossMerchandise: string }) => v.grossMerchandise,
      ),
    ).toEqual(['7.00', '9.00']);
    expect(month.buckets.map((v: { partial: boolean }) => v.partial)).toEqual([
      true,
      true,
    ]);
    const quarter = (await get(f.seller.token, query + 'quarter').expect(200))
      .body;
    expect(quarter.buckets).toHaveLength(1);
    expect(quarter.buckets[0]).toMatchObject({
      periodStart: '2026-01-01',
      from: '2026-01-15',
      to: '2026-02-15',
      partial: true,
      grossMerchandise: '16.00',
    });
  });
  it('excludes invalid legacy discounts from both gross and refund and reports bounded details', async () => {
    const f = await fixture(),
      o = await order(f);
    await refund(o);
    await db.order.update({
      where: { id: o.id },
      data: { discountTotal: '1000.00', total: '119000.00' },
    });
    await db.payment.update({
      where: { id: o.payment!.id },
      data: { amount: '119000.00' },
    });
    for (const range of [jan, feb]) {
      const a = (await get(f.seller.token, range).expect(200)).body;
      expect(a.totals.netMerchandise).toBe('0.00');
      expect(a.totals.grossMerchandise).toBe('0.00');
      expect(a.totals.effectiveRefundMerchandise).toBe('0.00');
      expect(a.dataQuality.invalidSnapshotOrderCount).toBe(1);
    }
    const quality = (
      await get(
        f.seller.token,
        jan + '&limit=1',
        '/seller/dashboard/data-quality',
      ).expect(200)
    ).body;
    expect(quality.items).toEqual([
      {
        orderId: o.id,
        storeId: f.store.id,
        issues: ['MONEY_SNAPSHOT_INVALID'],
      },
    ]);
    expect(quality.nextBeforeId).toBeNull();
  });
  it('rejects a missing refund projection rather than counting only the positive side', async () => {
    const f = await fixture(),
      o = await order(f);
    await refund(o, true);
    const a = (await get(f.seller.token).expect(200)).body;
    expect(a.totals.grossMerchandise).toBe('0.00');
    expect(a.dataQuality.invalidSnapshotOrderCount).toBe(1);
  });
  it('handles numeric NaN as a quality issue with no NaN money output', async () => {
    const f = await fixture(),
      o = await order(f);
    await db.$executeRaw`UPDATE orders SET subtotal='NaN'::numeric,total='NaN'::numeric WHERE id=${o.id}`;
    const a = (await get(f.seller.token).expect(200)).body;
    expect(a.totals.grossMerchandise).toBe('0.00');
    expect(a.dataQuality.invalidSnapshotOrderCount).toBe(1);
  });
  it('sums more than fifty orders, without top-N truncation', async () => {
    const f = await fixture();
    for (let i = 0; i < 51; i++) await order(f, '1.00', undefined, '0.00');
    const a = (await get(f.seller.token).expect(200)).body;
    expect(a.totals.completedOrderCount).toBe(51);
    expect(a.totals.grossMerchandise).toBe('51.00');
  });
  it('preserves exact whole-VND money when the aggregate exceeds the per-order decimal bound', async () => {
    const f = await fixture();
    await order(f, '999999999999.00', undefined, '0.00');
    await order(f, '999999999999.00', undefined, '0.00');
    expect(
      (await get(f.seller.token).expect(200)).body.totals.netMerchandise,
    ).toBe('1999999999998.00');
  });
  it('enforces canonical ownership, role and current account state', async () => {
    const f = await fixture(),
      user = await actor(),
      admin = await actor('ADMIN');
    await http()
      .get('/admin/dashboard' + jan)
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await get(user.token, jan, '/admin/dashboard').expect(403);
    await get(f.seller.token, jan, '/admin/dashboard').expect(403);
    await get(admin.token).expect(403);
    await get(f.seller.token, jan + '&storeId=1').expect(400);
    const counts = (await get(admin.token, jan, '/admin/dashboard').expect(200))
      .body;
    expect(counts.currentStoreCountsByStatus).toHaveProperty('CLOSED');
    await db.user.update({
      where: { id: admin.id },
      data: { isActive: false },
    });
    await get(admin.token, jan, '/admin/dashboard').expect(401);
    await db.user.update({
      where: { id: f.seller.id },
      data: { credentialVersion: { increment: 1 } },
    });
    await get(f.seller.token).expect(401);
    const noStore = await actor('SELLER');
    await get(noStore.token).expect(404);
  });
  it.each([
    '&from=2026-01-01',
    '&q[]=x',
    '&bucket=week',
    '&limit=1',
    '&bucket=day%27%3Bselect%201',
  ])('rejects ambiguous/unsupported query %s', async (extra) => {
    const f = await fixture();
    await get(f.seller.token, jan + extra)
      .expect(400)
      .expect('Cache-Control', 'no-store');
  });
  it('rejects GET payloads before parsers and preserves no-store for HEAD/errors', async () => {
    const f = await fixture();
    await get(f.seller.token)
      .send({ unsafe: true })
      .expect(400)
      .expect('Cache-Control', 'no-store');
    await http()
      .head('/ADMIN/DASHBOARD/' + jan)
      .expect(401)
      .expect('Cache-Control', 'no-store');
  });
  it('does not mutate source orders, money, audits, inventory or Search queues', async () => {
    const f = await fixture(),
      o = await order(f);
    await refund(o);
    const snapshot = async () => ({
      order: await db.order.findUnique({ where: { id: o.id } }),
      payment: await db.payment.findUnique({ where: { id: o.payment!.id } }),
      seller: await db.user.findUnique({ where: { id: f.seller.id } }),
      variant: await db.productVariant.findUnique({
        where: { id: f.variant.id },
      }),
      refunds: await db.refundRecord.findMany({
        where: { orderItemId: o.items[0]!.id },
      }),
      adjustments: await db.revenueAdjustment.findMany({
        where: { refund: { orderItemId: o.items[0]!.id } },
      }),
      audit: await db.aftersaleHistory.count(),
      stock: await db.stockMovement.count(),
      outbox: await db.searchOutbox.count(),
      jobs: await db.searchReconciliationJob.count(),
    });
    const before = await snapshot();
    await get(f.seller.token).expect(200);
    await get(f.seller.token, feb).expect(200);
    await get(f.seller.token, jan, '/seller/dashboard/data-quality').expect(
      200,
    );
    expect(await snapshot()).toEqual(before);
  });
});
