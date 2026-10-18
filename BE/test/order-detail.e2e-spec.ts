import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { OrderDetailService } from '../src/order/order-detail.service.js';
import { OrderListRateGuard } from '../src/order/order-list-rate.guard.js';

describe('Buyer/Seller Order detail HTTP + PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyer: { id: number; token: string };
  let otherBuyer: { id: number; token: string };
  let seller: { id: number; token: string };
  let otherSeller: { id: number; token: string };
  let admin: { id: number; token: string };
  let storeId: number;
  let categoryId: number;
  let productId: number;
  let variantId: number;
  let orderId: number;
  let serial = 0;
  const marker = `order-detail-${Date.now()}`;
  const userIds: number[] = [];
  const http = () => request(app.getHttpServer());
  const get = (
    id: number | string = orderId,
    token = buyer.token,
    sellerRoute = false,
    query = '',
  ) =>
    http()
      .get(`${sellerRoute ? '/seller' : ''}/orders/${id}${query}`)
      .set('Authorization', token);
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
    return {
      id: user.id,
      token: `Bearer ${app.get(JwtService).sign(
        { sub: user.id, email: user.email, role, type: 'access' },
        {
          secret: config.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '10m',
        },
      )}`,
    };
  }
  // Explicit historical fixtures; the separate POST /checkouts test below
  // proves the actual create -> detail path, not just fixture compatibility.
  async function fixture(withPayment = true) {
    const checkout = await prisma.checkout.create({
      data: {
        buyerId: buyer.id,
        requestHash: 'private-legacy-hash',
        idempotencyKey: `${marker}-${serial++}`,
      },
    });
    const row = await prisma.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId,
        orderNumber: `${marker}-${serial++}`,
        recipientNameSnapshot: 'Recipient at purchase',
        phoneSnapshot: '0901234567',
        provinceSnapshot: 'Province',
        districtSnapshot: null,
        wardSnapshot: 'Ward',
        addressLineSnapshot: 'Address at purchase',
        postalCodeSnapshot: null,
        deliveryNoteSnapshot: 'Original note',
        subtotal: '999999999999.00',
        shippingFee: 0,
        discountTotal: 0,
        total: '999999999999.00',
        items: {
          create: {
            productId,
            variantId,
            productNameSnapshot: 'Purchased name',
            skuSnapshot: 'Purchased SKU',
            optionSnapshot: [
              {
                groupId: 1,
                groupName: 'Color',
                valueId: 2,
                value: 'Black',
                private: 'hidden-json',
              },
            ],
            unitPrice: '999999999999.00',
            quantity: 1,
            lineTotal: '999999999999.00',
          },
        },
        ...(withPayment
          ? {
              payment: {
                create: { provider: 'COD', amount: '999999999999.00' },
              },
            }
          : {}),
        statusHistory: {
          create: {
            toStatus: 'PENDING_CONFIRMATION',
            actorType: 'BUYER',
            actorId: buyer.id,
          },
        },
      },
    });
    return row;
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OrderListRateGuard)
      .useValue(
        new OrderListRateGuard(
          new ConfigService({ ORDER_LIST_RATE_PER_MINUTE: '1000' }),
        ),
      )
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    buyer = await actor(Role.USER);
    otherBuyer = await actor(Role.USER);
    seller = await actor(Role.SELLER);
    otherSeller = await actor(Role.SELLER);
    admin = await actor(Role.ADMIN);
    storeId = (
      await prisma.store.create({
        data: {
          sellerId: seller.id,
          name: `${marker}-store`,
          status: 'ACTIVE',
        },
      })
    ).id;
    categoryId = (
      await prisma.category.create({ data: { name: marker, slug: marker } })
    ).id;
    productId = (
      await prisma.product.create({
        data: {
          storeId,
          categoryId,
          name: 'Current catalog name',
          sellerStatus: 'ACTIVE',
          moderationStatus: 'APPROVED',
          images: {
            create: { url: '/uploads/detail-fixture.jpg', isPrimary: true },
          },
          shippingProfile: { create: { packageWeightGrams: 100 } },
        },
      })
    ).id;
    variantId = (
      await prisma.productVariant.create({
        data: {
          productId,
          storeId,
          skuCode: marker,
          price: '10000',
          stock: 5,
          optionSignature: 'default',
        },
      })
    ).id;
    orderId = (await fixture()).id;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) {
      const owned = { buyerId: { in: userIds } };
      await prisma.stockMovement.deleteMany({
        where: { orderItem: { order: owned } },
      });
      await prisma.orderStatusHistory.deleteMany({ where: { order: owned } });
      await prisma.orderCommand.deleteMany({ where: { order: owned } });
      await prisma.payment.deleteMany({ where: { order: owned } });
      await prisma.orderItem.deleteMany({ where: { order: owned } });
      await prisma.order.deleteMany({ where: owned });
      await prisma.checkout.deleteMany({ where: { buyerId: { in: userIds } } });
      await prisma.cartItem.deleteMany({
        where: { cart: { userId: { in: userIds } } },
      });
      // A failed beforeAll must never turn an undefined ID into a broad delete.
      if (productId) {
        await prisma.searchOutbox.deleteMany({ where: { productId } });
        await prisma.product.deleteMany({ where: { id: productId } });
      }
      if (storeId) await prisma.store.deleteMany({ where: { id: storeId } });
      if (categoryId)
        await prisma.category.deleteMany({ where: { id: categoryId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });
  it('returns exact purchase snapshots and Decimal strings to both owners', async () => {
    const result = (await get().expect(200)).body;
    expect(result.items[0]).toEqual({
      id: expect.any(Number),
      productId,
      variantId,
      productName: 'Purchased name',
      sku: 'Purchased SKU',
      options: ['Black'],
      unitPrice: '999999999999.00',
      quantity: 1,
      lineTotal: '999999999999.00',
    });
    expect(result.shippingAddress).toEqual({
      recipientName: 'Recipient at purchase',
      phone: '0901234567',
      province: 'Province',
      district: null,
      ward: 'Ward',
      addressLine: 'Address at purchase',
      postalCode: null,
      deliveryNote: 'Original note',
    });
    expect(result.total).toBe('999999999999.00');
    expect(result.payment).toEqual({
      provider: 'COD',
      status: 'UNPAID',
      amount: '999999999999.00',
      currency: 'VND',
      paidAt: null,
    });
    expect((await get(orderId, seller.token, true).expect(200)).body).toEqual(
      result,
    );
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'orderNumber',
        'status',
        'store',
        'shippingAddress',
        'items',
        'subtotal',
        'shippingFee',
        'discountTotal',
        'total',
        'payment',
        'cancellation',
        'timeline',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /private-legacy-hash|hidden-json|checkoutId|buyerId|commandId|requestHash|idempotencyKey|passwordHash/,
    );
  });
  it('wrong ownership and absent IDs return exactly the same safe 404 on both routes', async () => {
    for (const [token, sellerRoute] of [
      [otherBuyer.token, false],
      [otherSeller.token, true],
    ] as const) {
      const foreign = await get(orderId, token, sellerRoute).expect(404);
      const absent = await get(2147483647, token, sellerRoute).expect(404);
      expect(foreign.body).toEqual(absent.body);
      expect(absent.body.code).toBe('ORDER_NOT_FOUND');
      expect(foreign.headers['cache-control']).toBe('no-store');
    }
  });
  it('rejects no token, expired token and wrong roles without leaking order existence', async () => {
    const expired = app.get(JwtService).sign(
      { sub: buyer.id, type: 'access' },
      {
        secret: app.get(ConfigService).getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: -1,
      },
    );
    for (const [token, sellerRoute, status] of [
      ['', false, 401],
      [`Bearer ${expired}`, false, 401],
      [seller.token, false, 403],
      [buyer.token, true, 403],
      [admin.token, false, 403],
      [admin.token, true, 403],
    ] as const) {
      const response = await get(orderId, token, sellerRoute).expect(status);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
  it('uses current account eligibility and role, while a SUSPENDED Store can read history', async () => {
    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'SUSPENDED' },
    });
    try {
      await get(orderId, seller.token, true).expect(200);
    } finally {
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'ACTIVE' },
      });
    }
    await prisma.user.update({
      where: { id: seller.id },
      data: { isActive: false },
    });
    try {
      await get(orderId, seller.token, true).expect(401);
    } finally {
      await prisma.user.update({
        where: { id: seller.id },
        data: { isActive: true },
      });
    }
    await prisma.user.update({
      where: { id: otherBuyer.id },
      data: { role: Role.SELLER },
    });
    try {
      await get(orderId, otherBuyer.token).expect(403);
    } finally {
      await prisma.user.update({
        where: { id: otherBuyer.id },
        data: { role: Role.USER },
      });
    }
  });
  it('rechecks role and active account within the consistent read transaction', async () => {
    await expect(
      app.get(OrderDetailService).detail(admin.id, 'USER', String(orderId), {}),
    ).rejects.toMatchObject({ status: 403 });
    await prisma.user.update({
      where: { id: otherBuyer.id },
      data: { isActive: false },
    });
    try {
      await expect(
        app
          .get(OrderDetailService)
          .detail(otherBuyer.id, 'USER', String(orderId), {}),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      await prisma.user.update({
        where: { id: otherBuyer.id },
        data: { isActive: true },
      });
    }
  });
  it('hides Seller/Admin/unknown IDs from Buyer, allows scoped Seller audit and orders equal timestamps by history ID', async () => {
    const row = await fixture();
    const time = new Date('2026-10-01T00:00:00Z');
    for (const data of [
      { actorType: 'SELLER' as const, actorId: seller.id },
      { actorType: 'ADMIN' as const, actorId: admin.id },
      { actorType: 'SYSTEM' as const, actorId: null },
      { actorType: null, actorId: admin.id },
      { actorType: 'SELLER' as const, actorId: otherSeller.id },
    ]) {
      const command = data.actorType
        ? await prisma.$transaction(
            (tx) =>
              tx.orderCommand.create({
                data: {
                  orderId: row.id,
                  actorType: data.actorType,
                  actorId: data.actorId,
                  actorScope:
                    data.actorType === 'SYSTEM'
                      ? 'SYSTEM:ORDER_AUTO_COMPLETE'
                      : `USER:${data.actorId}`,
                  idempotencyKey: `${marker}_cmd_${serial++}`,
                  requestHash: 'a'.repeat(64),
                  hashVersion: 1,
                  command: data.actorType === 'SYSTEM' ? 'complete' : 'confirm',
                  status: 'SUCCEEDED',
                  responseStatus: 200,
                  resultSnapshot: { private: 'private-command-receipt' },
                  createdAt: time,
                  completedAt: time,
                },
              }),
            { isolationLevel: 'Serializable' },
          )
        : null;
      await prisma.orderStatusHistory.create({
        data: {
          orderId: row.id,
          fromStatus: 'PENDING_CONFIRMATION',
          toStatus: 'CONFIRMED',
          ...data,
          commandId: command?.id ?? null,
          reason: command ? null : 'Legacy audit',
          reasonCode: command ? 'OTHER' : null,
          reasonText: command ? `audit-${serial++}` : null,
          createdAt: time,
        },
      });
    }
    await prisma.order.update({
      where: { id: row.id },
      data: {
        status: 'CANCELLED',
        cancelledByType: 'SELLER',
        cancelledById: seller.id,
        cancellationReasonCode: 'OUT_OF_STOCK',
        cancellationReasonText: 'Saved reason',
        cancelledAt: time,
      },
    });
    const b = (await get(row.id).expect(200)).body;
    const s = (await get(row.id, seller.token, true).expect(200)).body;
    const orderedHistory = await prisma.orderStatusHistory.findMany({
      where: { orderId: row.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { reasonText: true },
    });
    expect(
      b.timeline.map((h: { reasonText: string | null }) => h.reasonText),
    ).toEqual(orderedHistory.map((h) => h.reasonText));
    expect(JSON.stringify(b)).not.toContain('private-command-receipt');
    expect(JSON.stringify(s)).not.toContain('private-command-receipt');
    expect(
      b.timeline.slice(0, 5).map((h: { actorId: number | null }) => h.actorId),
    ).toEqual([null, null, null, null, null]);
    expect(
      s.timeline.slice(0, 5).map((h: { actorId: number | null }) => h.actorId),
    ).toEqual([seller.id, admin.id, null, null, null]);
    expect(
      b.timeline.map((h: { reasonText: string | null }) => h.reasonText),
    ).toEqual(
      s.timeline.map((h: { reasonText: string | null }) => h.reasonText),
    );
    expect(b.cancellation).toEqual({
      cancelledBy: { type: 'SELLER', id: null },
      reasonCode: 'OUT_OF_STOCK',
      reasonText: 'Saved reason',
      cancelledAt: time.toISOString(),
    });
    expect(s.cancellation.cancelledBy.id).toBe(seller.id);
  });
  it('represents missing Payment and unknown legacy audit truthfully, with no backfill', async () => {
    const row = await fixture(false);
    await prisma.order.update({
      where: { id: row.id },
      data: {
        status: 'CANCELLED',
        cancellationReason: 'Old free text is not a canonical reason code',
      },
    });
    await prisma.orderStatusHistory.updateMany({
      where: { orderId: row.id },
      data: { actorType: null, reason: 'Old history reason' },
    });
    const response = (await get(row.id).expect(200)).body;
    expect(response.payment).toBeNull();
    expect(response.cancellation).toEqual({
      cancelledBy: { type: null, id: null },
      reasonCode: null,
      reasonText: null,
      cancelledAt: null,
    });
    expect(response.timeline[0]).toMatchObject({
      actorType: null,
      actorId: null,
      reason: 'Old history reason',
      reasonCode: null,
      reasonText: null,
    });
    expect(await prisma.payment.count({ where: { orderId: row.id } })).toBe(0);
  });
  it('returns safe 500 for malformed saved options; never substitutes live catalog', async () => {
    const row = await fixture();
    await prisma.orderItem.updateMany({
      where: { orderId: row.id },
      data: { optionSnapshot: { private: 'broken-private-json' } },
    });
    const response = await get(row.id).expect(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('broken-private-json');
  });
  it.each(['0', '-1', '01', '1e2', '1.5', '2147483648', 'nope'])(
    'rejects invalid path %s on both routes',
    async (id) => {
      for (const [token, sellerRoute] of [
        [buyer.token, false],
        [seller.token, true],
      ] as const)
        expect((await get(id, token, sellerRoute).expect(400)).body.code).toBe(
          'VALIDATION_ERROR',
        );
    },
  );
  it.each([
    '?storeId=1',
    '?buyerId=1',
    '?include=commands',
    '?status=CONFIRMED',
  ])('rejects unsupported query %s', async (query) => {
    for (const [token, sellerRoute] of [
      [buyer.token, false],
      [seller.token, true],
    ] as const)
      await get(orderId, token, sellerRoute, query).expect(400);
  });
  it('rejects malformed and empty GET bodies before the JSON parser including aliases', async () => {
    for (const url of [
      `/orders/${orderId}`,
      `/seller/orders/${orderId}`,
      `/ORDERS/${orderId}/`,
    ]) {
      for (const body of ['{bad', '{}']) {
        const response = await http()
          .get(url)
          .set('Content-Type', 'application/json')
          .send(body)
          .expect(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(response.headers['cache-control']).toBe('no-store');
      }
    }
  });
  it('returns a safe bounded database failure without SQL/PII', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
      new Error('password private SQL address'),
    );
    const response = await get().expect(500);
    expect(response.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Không thể đọc đơn hàng.',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('list/detail share one per-actor read quota with Retry-After', async () => {
    const guard = new OrderListRateGuard(
      new ConfigService({ ORDER_LIST_RATE_PER_MINUTE: '1' }),
    );
    vi.spyOn(app.get(OrderListRateGuard), 'canActivate').mockImplementation(
      (context) => guard.canActivate(context),
    );
    await http().get('/orders').set('Authorization', buyer.token).expect(200);
    const response = await get().expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('60');
    await get(orderId, seller.token, true).expect(200);
  });
  it('PostgreSQL enforces READ ONLY, RepeatableRead and statement timeout in the actual reader', async () => {
    let settings: unknown;
    const wrapped = {
      $transaction: (
        run: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: Parameters<PrismaService['$transaction']>[1],
      ) =>
        prisma.$transaction(async (tx) => {
          await run(tx);
          settings =
            await tx.$queryRaw`SELECT current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation, current_setting('statement_timeout') AS timeout`;
          await tx.$executeRaw`UPDATE orders SET "orderNumber" = "orderNumber" WHERE id = ${orderId}`;
        }, options),
    };
    await expect(
      new OrderDetailService(wrapped as unknown as PrismaService).detail(
        buyer.id,
        'USER',
        String(orderId),
        {},
      ),
    ).rejects.toMatchObject({ code: 'P2010' });
    expect(settings).toEqual([
      { read_only: 'on', isolation: 'repeatable read', timeout: '2s' },
    ]);
  });
  it('concurrent status/history writes do not tear the reader snapshot; next read sees the commit', async () => {
    const row = await fixture();
    const wrapped = {
      $transaction: (
        run: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: Parameters<PrismaService['$transaction']>[1],
      ) =>
        prisma.$transaction(async (tx) => {
          const instrumentedOrder = new Proxy(tx.order, {
            get(target, property) {
              if (property !== 'findFirst')
                return Reflect.get(target, property);
              return async (args: Prisma.OrderFindFirstArgs) => {
                // Reader already established its snapshot by reading User. A real
                // second connection commits status + legacy history atomically.
                await prisma.$transaction([
                  prisma.order.update({
                    where: { id: row.id },
                    data: { status: 'CONFIRMED' },
                  }),
                  prisma.orderStatusHistory.create({
                    data: {
                      orderId: row.id,
                      fromStatus: 'PENDING_CONFIRMATION',
                      toStatus: 'CONFIRMED',
                      actorId: seller.id,
                      reason: 'Legacy concurrent fixture',
                    },
                  }),
                ]);
                return target.findFirst(args);
              };
            },
          });
          // Instrument the boundary only; both sides still execute real SQL.
          return run(
            new Proxy(tx, {
              get(target, property) {
                return property === 'order'
                  ? instrumentedOrder
                  : Reflect.get(target, property);
              },
            }),
          );
        }, options),
    };
    const old = await new OrderDetailService(
      wrapped as unknown as PrismaService,
    ).detail(buyer.id, 'USER', String(row.id), {});
    expect(old.status).toBe('PENDING_CONFIRMATION');
    expect(old.timeline).toHaveLength(1);
    const fresh = (await get(row.id).expect(200)).body;
    expect(fresh.status).toBe('CONFIRMED');
    expect(fresh.timeline).toHaveLength(2);
  });
  it('actual PostgreSQL statement timeout stops a slow read and HTTP returns a sanitized error', async () => {
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(((
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: Parameters<PrismaService['$transaction']>[1],
    ) =>
      original(async (tx: Prisma.TransactionClient) => {
        const result = await run(tx);
        await tx.$queryRaw`SELECT pg_sleep(4)`;
        return result;
      }, options)) as typeof prisma.$transaction);
    const started = Date.now();
    const response = await get().expect(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(
      /pg_sleep|statement timeout|SQL/,
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('actual HTTP COD Checkout -> detail keeps snapshots after catalog/address edits and performs no writes on repeated GETs', async () => {
    const address = await prisma.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: 'HTTP recipient',
        phone: '0901234567',
        province: 'Province',
        ward: 'Ward',
        addressLine: 'HTTP saved address',
      },
    });
    const cart = await prisma.cart.create({ data: { userId: buyer.id } });
    await prisma.cartItem.create({
      data: { cartId: cart.id, variantId, quantity: 2 },
    });
    const created = await http()
      .post('/checkouts')
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', `${marker}_http`)
      .send({
        addressId: address.id,
        paymentProvider: 'COD',
        items: [{ variantId, quantity: 2, expectedUnitPrice: '10000' }],
      })
      .expect(201);
    const id = created.body.orders[0].id;
    const first = (await get(id).expect(200)).body;
    expect(first.items[0]).toMatchObject({
      productName: 'Current catalog name',
      options: [],
      quantity: 2,
      unitPrice: '10000.00',
      lineTotal: '20000.00',
    });
    expect(first.timeline[0]).toMatchObject({
      actorType: 'BUYER',
      actorId: buyer.id,
      toStatus: 'PENDING_CONFIRMATION',
    });
    expect(first.payment.status).toBe('UNPAID');
    await prisma.product.update({
      where: { id: productId },
      data: { name: 'Changed DRAFT name', moderationStatus: 'NOT_SUBMITTED' },
    });
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { skuCode: `${marker}-changed`, price: '90000' },
    });
    await prisma.userAddress.delete({ where: { id: address.id } });
    const before = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        payment: true,
        statusHistory: true,
        checkout: true,
        commands: true,
      },
    });
    const outboxBefore = await prisma.searchOutbox.findMany({
      where: { productId },
    });
    for (let n = 0; n < 3; n++) {
      expect((await get(id).expect(200)).body).toEqual(first);
      expect((await get(id, seller.token, true).expect(200)).body).toEqual(
        first,
      );
    }
    expect(
      await prisma.order.findUnique({
        where: { id },
        include: {
          items: true,
          payment: true,
          statusHistory: true,
          checkout: true,
          commands: true,
        },
      }),
    ).toEqual(before);
    expect(
      await prisma.searchOutbox.findMany({ where: { productId } }),
    ).toEqual(outboxBefore);
  });
  it('publishes detail alongside cancellation and merged Seller preparation', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    for (const path of ['/orders/{orderId}', '/seller/orders/{orderId}']) {
      const route = document.paths[path]?.get;
      expect(route?.security).toEqual([{ bearer: [] }]);
      expect(route?.responses['200']).toBeDefined();
      expect(route?.responses['404']).toBeDefined();
    }
    expect(document.components?.schemas?.OrderDetailResponseDto).toMatchObject({
      properties: {
        payment: { nullable: true },
        timeline: { type: 'array' },
        items: { type: 'array' },
      },
    });
    expect(document.paths['/orders/{orderId}/cancel']?.post).toBeDefined();
    expect(
      document.paths['/seller/orders/{orderId}/cancel']?.post,
    ).toBeDefined();
    for (const command of ['confirm', 'start-packing', 'ready-to-ship'])
      expect(
        document.paths[`/seller/orders/{orderId}/${command}`]?.post,
      ).toBeDefined();
  });
});
