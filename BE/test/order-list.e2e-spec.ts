import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import request, { type Response as TestResponse } from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { OrderListService } from '../src/order/order-list.service.js';
import { OrderListRateGuard } from '../src/order/order-list-rate.guard.js';

describe('Buyer/Seller Order lists (real PostgreSQL, read-only fixtures)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyer: { id: number; token: string };
  let buyer2: { id: number; token: string };
  let seller: { id: number; token: string };
  let seller2: { id: number; token: string };
  let admin: { id: number; token: string };
  let storeId: number;
  let otherStoreId: number;
  let serial = 0;
  const marker = `order-list-${Date.now()}`;
  const orderIds: number[] = [];
  const checkoutIds: number[] = [];
  const userIds: number[] = [];
  const http = () => request(app.getHttpServer());
  const get = (url = '/orders', token = buyer.token) =>
    http().get(url).set('Authorization', token);

  async function actor(role: Role) {
    const user = await prisma.user.create({
      data: {
        email: `${marker}-${serial++}@example.com`,
        passwordHash: 'fixture-only',
        role,
      },
    });
    userIds.push(user.id);
    const config = app.get(ConfigService);
    const token = app.get(JwtService).sign(
      { sub: user.id, email: user.email, role, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { id: user.id, token: `Bearer ${token}` };
  }
  // These are controlled read-model fixtures, not evidence that checkout ran.
  // Legacy Checkout has no v1 receipt; no Product/stock/Cart mutation is needed.
  async function order(
    buyerId: number,
    store = storeId,
    status: OrderStatus = 'PENDING_CONFIRMATION',
    withPayment = true,
  ) {
    const checkout = await prisma.checkout.create({
      data: {
        buyerId,
        requestHash: 'legacy-fixture',
        idempotencyKey: `${marker}-${serial++}`,
      },
    });
    checkoutIds.push(checkout.id);
    const record = await prisma.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId,
        storeId: store,
        status,
        orderNumber: `${marker}-${serial++}`,
        recipientNameSnapshot: 'Private recipient',
        phoneSnapshot: '0901234567',
        provinceSnapshot: 'Province',
        districtSnapshot: null,
        wardSnapshot: 'Ward',
        addressLineSnapshot: 'Private address',
        deliveryNoteSnapshot: 'Private note',
        subtotal: '999999999999.00',
        shippingFee: 0,
        discountTotal: 0,
        total: '999999999999.00',
      },
    });
    orderIds.push(record.id);
    if (withPayment)
      await prisma.payment.create({
        data: { orderId: record.id, provider: 'COD', amount: record.total },
      });
    return record;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    buyer = await actor(Role.USER);
    buyer2 = await actor(Role.USER);
    seller = await actor(Role.SELLER);
    seller2 = await actor(Role.SELLER);
    admin = await actor(Role.ADMIN);
    storeId = (
      await prisma.store.create({
        data: { sellerId: seller.id, name: `${marker}-A`, status: 'ACTIVE' },
      })
    ).id;
    otherStoreId = (
      await prisma.store.create({
        data: { sellerId: seller2.id, name: `${marker}-B`, status: 'ACTIVE' },
      })
    ).id;
    await order(buyer.id);
    await order(buyer2.id, storeId, 'CONFIRMED');
    await order(buyer.id, otherStoreId, 'DELIVERED');
    await order(buyer2.id, otherStoreId, 'CANCELLED');
    await order(buyer.id, storeId, 'COMPLETED');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (prisma) {
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.checkout.deleteMany({ where: { id: { in: checkoutIds } } });
      await prisma.store.deleteMany({
        where: { id: { in: [storeId, otherStoreId].filter(Boolean) } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('Buyer sees only own Orders across Stores, newest ID first, no fake total count', async () => {
    const response = await get().expect(200);
    const expected = await prisma.order.findMany({
      where: { buyerId: buyer.id },
      orderBy: { id: 'desc' },
    });
    expect(response.body.items.map((row: { id: number }) => row.id)).toEqual(
      expected.map((row) => row.id),
    );
    expect(Object.keys(response.body).sort()).toEqual(['items', 'nextCursor']);
    expect(response.body.nextCursor).toBeNull();
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('Seller sees only own Store Orders across Buyers', async () => {
    const response = await get('/seller/orders', seller.token).expect(200);
    expect(response.body.items).toHaveLength(3);
    expect(
      response.body.items.every(
        (row: { store: { id: number } }) => row.store.id === storeId,
      ),
    ).toBe(true);
    const other = await get('/seller/orders', seller2.token).expect(200);
    expect(other.body.items).toHaveLength(2);
    expect(
      other.body.items.every(
        (row: { store: { id: number } }) => row.store.id === otherStoreId,
      ),
    ).toBe(true);
  });
  it('returns empty for an actor without Orders or a Store', async () => {
    const emptyBuyer = await actor(Role.USER);
    const emptySeller = await actor(Role.SELLER);
    expect((await get('/orders', emptyBuyer.token).expect(200)).body).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(
      (await get('/seller/orders', emptySeller.token).expect(200)).body,
    ).toEqual({ items: [], nextCursor: null });
  });
  it('filters status within ownership on both routes', async () => {
    expect(
      (await get('/orders?status=CONFIRMED').expect(200)).body.items,
    ).toEqual([]);
    const response = await get(
      '/seller/orders?status=CONFIRMED',
      seller.token,
    ).expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].status).toBe('CONFIRMED');
  });
  it('cursor visits each own Order once; exact final page has null cursor', async () => {
    const expected = await prisma.order.findMany({
      where: { buyerId: buyer.id },
      orderBy: { id: 'desc' },
    });
    const seen: number[] = [];
    let cursor: number | null = null;
    for (let index = 0; index < expected.length; index++) {
      const response: TestResponse = await get(
        `/orders?limit=1${cursor ? `&afterId=${cursor}` : ''}`,
      ).expect(200);
      seen.push(response.body.items[0].id);
      cursor = response.body.nextCursor;
      expect(cursor).toBe(
        index === expected.length - 1 ? null : seen[seen.length - 1],
      );
    }
    expect(seen).toEqual(expected.map((row) => row.id));
  });
  it('cursor is a boundary, not an unscoped lookup or authorization token', async () => {
    const otherId = (
      await prisma.order.findFirstOrThrow({ where: { buyerId: buyer2.id } })
    ).id;
    const expected = await prisma.order.findMany({
      where: { buyerId: buyer.id, id: { lt: otherId } },
      orderBy: { id: 'desc' },
    });
    const response = await get(`/orders?afterId=${otherId}`).expect(200);
    expect(response.body.items.map((row: { id: number }) => row.id)).toEqual(
      expected.map((row) => row.id),
    );
    expect((await get('/orders?afterId=1').expect(200)).body).toEqual({
      items: [],
      nextCursor: null,
    });
  });
  it('newer inserts do not duplicate previous page items', async () => {
    const first = await get('/orders?limit=1').expect(200);
    const newer = await order(buyer.id);
    const rest = await get(`/orders?afterId=${first.body.nextCursor}`).expect(
      200,
    );
    expect(rest.body.items.map((row: { id: number }) => row.id)).not.toContain(
      newer.id,
    );
    expect(rest.body.items.map((row: { id: number }) => row.id)).not.toContain(
      first.body.items[0].id,
    );
  });
  it('returns allowlisted summary fields and exact Decimal strings, never PII/key/hash', async () => {
    const response = await get().expect(200);
    const row = response.body.items[0];
    expect(Object.keys(row).sort()).toEqual([
      'createdAt',
      'id',
      'orderNumber',
      'payment',
      'status',
      'store',
      'total',
      'updatedAt',
    ]);
    expect(Object.keys(row.store).sort()).toEqual(['id', 'name']);
    expect(Object.keys(row.payment).sort()).toEqual([
      'amount',
      'currency',
      'paidAt',
      'provider',
      'status',
    ]);
    expect(row.total).toBe('999999999999.00');
    expect(row.payment.amount).toBe('999999999999.00');
    expect(JSON.stringify(response.body)).not.toMatch(
      /Private recipient|0901234567|Private address|legacy-fixture|passwordHash|idempotencyKey|buyerId|checkoutId/,
    );
  });
  it('shows current Order/Payment state, not a checkout receipt or a public catalog decision', async () => {
    const record = await order(buyer.id);
    await prisma.order.update({
      where: { id: record.id },
      data: { status: 'DELIVERED' },
    });
    await prisma.payment.update({
      where: { orderId: record.id },
      data: { status: 'PAID', paidAt: new Date('2026-10-08T10:00:00Z') },
    });
    const response = await get('/orders?status=DELIVERED').expect(200);
    const row = response.body.items.find(
      (value: { id: number }) => value.id === record.id,
    );
    expect(row.status).toBe('DELIVERED');
    expect(row.payment.status).toBe('PAID');
    expect(row.payment.paidAt).toBe('2026-10-08T10:00:00.000Z');
  });
  it('does not invent Payment for a legacy Order without one', async () => {
    const record = await order(
      buyer.id,
      storeId,
      'PENDING_CONFIRMATION',
      false,
    );
    const response = await get().expect(200);
    expect(
      response.body.items.find((row: { id: number }) => row.id === record.id)
        .payment,
    ).toBeNull();
  });
  it('defaults to 20, permits 50, and bounds every page before returning a cursor', async () => {
    const pagedBuyer = await actor(Role.USER);
    for (let index = 0; index < 51; index++) await order(pagedBuyer.id);
    const defaultPage = await get('/orders', pagedBuyer.token).expect(200);
    expect(defaultPage.body.items).toHaveLength(20);
    expect(defaultPage.body.nextCursor).toBe(defaultPage.body.items[19].id);
    const maximumPage = await get('/orders?limit=50', pagedBuyer.token).expect(
      200,
    );
    expect(maximumPage.body.items).toHaveLength(50);
    expect(maximumPage.body.nextCursor).toBe(maximumPage.body.items[49].id);
    const last = await get(
      `/orders?limit=50&afterId=${maximumPage.body.nextCursor}`,
      pagedBuyer.token,
    ).expect(200);
    expect(last.body.items).toHaveLength(1);
    expect(last.body.nextCursor).toBeNull();
  });
  it('inactive Store does not erase Seller access to existing Orders', async () => {
    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'SUSPENDED' },
    });
    try {
      await get('/seller/orders', seller.token).expect(200);
    } finally {
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'ACTIVE' },
      });
    }
  });
  it('returns 401/403 with no-store and safe error envelope', async () => {
    for (const [url, token, status, code] of [
      ['/orders', '', 401, 'UNAUTHORIZED'],
      ['/orders', seller.token, 403, 'FORBIDDEN'],
      ['/orders', admin.token, 403, 'FORBIDDEN'],
      ['/seller/orders', buyer.token, 403, 'FORBIDDEN'],
      ['/seller/orders', admin.token, 403, 'FORBIDDEN'],
    ] as const) {
      const response = await get(url, token).expect(status);
      expect(response.body.code).toBe(code);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
  it('checks active account and current DB role rather than the token claim', async () => {
    const actorBefore = await actor(Role.USER);
    await prisma.user.update({
      where: { id: actorBefore.id },
      data: { isActive: false },
    });
    await get('/orders', actorBefore.token).expect(401);
    await prisma.user.update({
      where: { id: actorBefore.id },
      data: { isActive: true, role: Role.SELLER },
    });
    await get('/orders', actorBefore.token).expect(403);
  });
  it('rechecks actor active/role inside the read transaction', async () => {
    await expect(
      app.get(OrderListService).list(admin.id, 'USER', {}),
    ).rejects.toMatchObject({ status: 403 });
    const inactive = await actor(Role.USER);
    await prisma.user.update({
      where: { id: inactive.id },
      data: { isActive: false },
    });
    await expect(
      app.get(OrderListService).list(inactive.id, 'USER', {}),
    ).rejects.toMatchObject({ status: 401 });
  });
  it.each([
    'limit=0',
    'limit=51',
    'limit=1e1',
    'limit=1&limit=2',
    'afterId=-1',
    'afterId=2147483648',
    'status=ALL',
    'status=',
    'buyerId=1',
    'storeId=1',
    'offset=1',
  ])('rejects invalid query %s on both routes', async (query) => {
    for (const [url, token] of [
      ['/orders', buyer.token],
      ['/seller/orders', seller.token],
    ]) {
      const response = await get(`${url}?${query}`, token).expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
  it('rejects GET bodies before JSON parsing, including invalid JSON and route aliases', async () => {
    for (const url of ['/orders', '/seller/orders', '/ORDERS/']) {
      const response = await http()
        .get(url)
        .set('Content-Type', 'application/json')
        .send('{bad')
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
  it('safe database failures do not expose SQL or credentials', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
      new Error('private SQL diagnostic must not reach response'),
    );
    const response = await get().expect(500);
    expect(response.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Không thể đọc đơn hàng.',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('performs no mutation after repeated GETs', async () => {
    const before = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { payment: true },
    });
    await get().expect(200);
    await get('/seller/orders', seller.token).expect(200);
    expect(
      await prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { payment: true },
      }),
    ).toEqual(before);
  });
  it('PostgreSQL reports READ ONLY and rejects an injected write in the real service transaction', async () => {
    let readOnly = '';
    const wrapped = {
      $transaction: (
        run: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: {
          isolationLevel: Prisma.TransactionIsolationLevel;
          maxWait: number;
          timeout: number;
        },
      ) =>
        prisma.$transaction(async (tx) => {
          await run(tx);
          const [state] = await tx.$queryRaw<
            { read_only: string }[]
          >`SELECT current_setting('transaction_read_only') AS read_only`;
          readOnly = state.read_only;
          await tx.$executeRaw`UPDATE orders SET "orderNumber" = "orderNumber" WHERE id = ${orderIds[0]}`;
        }, options),
    };
    const service = new OrderListService(wrapped as unknown as PrismaService);
    await expect(service.list(buyer.id, 'USER', {})).rejects.toMatchObject({
      code: 'P2010',
    });
    expect(readOnly).toBe('on');
  });
  it('has Swagger for list and detail APIs, not unimplemented commands', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(document.paths['/orders']?.get?.responses['200']).toBeDefined();
    expect(document.paths['/seller/orders']?.get?.security).toEqual([
      { bearer: [] },
    ]);
    expect(document.paths['/orders/{orderId}']?.get).toBeDefined();
    expect(document.paths['/orders/{orderId}/cancel']).toBeUndefined();
  });
  it('rate limit includes Retry-After and per-actor isolation', async () => {
    const guard = new OrderListRateGuard(
      new ConfigService({ ORDER_LIST_RATE_PER_MINUTE: '1' }),
    );
    vi.spyOn(app.get(OrderListRateGuard), 'canActivate').mockImplementation(
      (context) => guard.canActivate(context),
    );
    await get().expect(200);
    const response = await get().expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('60');
    await get('/orders', buyer2.token).expect(200);
  });
});
