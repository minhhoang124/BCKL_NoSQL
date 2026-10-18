import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { prepareOrderCommand } from '../src/order/order-command-request.js';

describe('C3 cancellation — real Checkout, PostgreSQL and two HTTP applications', () => {
  let app: INestApplication;
  let second: INestApplication;
  let prisma: PrismaService;
  let otherPrisma: PrismaService;
  let buyer: { id: number; token: string };
  let seller: { id: number; token: string };
  let outsider: { id: number; token: string };
  let admin: { id: number; token: string };
  let storeId: number;
  let categoryId: number;
  let orderId: number;
  let productId: number;
  let variantIds: number[];
  let checkoutId: number;
  const marker = `cancel-e2e-${Date.now()}`;
  let serial = 0;
  const key = () => `cancel_request_key_${serial++}`;
  const body = { reasonCode: 'CHANGED_MIND', reasonText: 'Không cần nữa' };
  const sellerBody = {
    reasonCode: 'CANNOT_FULFIL',
    reasonText: 'Không thể xử lý',
  };
  const post = (
    header = key(),
    instance = app,
    actor = buyer,
    payload: unknown = body,
    id = orderId,
  ) =>
    request(instance.getHttpServer())
      .post(`${actor === seller ? '/seller' : ''}/orders/${id}/cancel`)
      .set('Authorization', actor.token)
      .set('Idempotency-Key', header)
      .send(payload as object);
  async function start() {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const instance = module.createNestApplication();
    configureApp(instance);
    await instance.listen(0, '127.0.0.1');
    return instance;
  }
  async function user(role: Role) {
    const row = await prisma.user.create({
      data: {
        email: `${marker}-${serial++}@example.com`,
        passwordHash: 'fixture',
        role,
      },
    });
    const config = app.get(ConfigService);
    const token = app.get(JwtService).sign(
      { sub: row.id, role, email: row.email, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { id: row.id, token: `Bearer ${token}` };
  }
  async function state() {
    return {
      order: await prisma.order.findUnique({ where: { id: orderId } }),
      payment: await prisma.payment.findUnique({ where: { orderId } }),
      items: await prisma.orderItem.findMany({
        where: { orderId },
        orderBy: { id: 'asc' },
      }),
      variants: await prisma.productVariant.findMany({
        where: { productId },
        orderBy: { id: 'asc' },
      }),
      product: await prisma.product.findUnique({ where: { id: productId } }),
      movements: await prisma.stockMovement.findMany({
        where: { orderItem: { orderId } },
        orderBy: { id: 'asc' },
      }),
      commands: await prisma.orderCommand.findMany({
        where: { orderId },
        orderBy: { id: 'asc' },
      }),
      history: await prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { id: 'asc' },
      }),
      outbox: await prisma.searchOutbox.findMany({
        where: { productId },
        orderBy: { id: 'asc' },
      }),
      checkout: await prisma.checkout.findUnique({ where: { id: checkoutId } }),
      cart: await prisma.cartItem.findMany({
        where: { cart: { userId: buyer.id } },
      }),
    };
  }
  const preparation = (
    command = 'confirm',
    header = key(),
    instance = second,
  ) =>
    request(instance.getHttpServer())
      .post(`/seller/orders/${orderId}/${command}`)
      .set('Authorization', seller.token)
      .set('Idempotency-Key', header)
      .send({});

  async function assertCommandRace(
    before: Awaited<ReturnType<typeof state>>,
    preparationWon: boolean,
    cancelActor: 'BUYER' | 'SELLER' = 'BUYER',
  ) {
    const after = await state();
    const status = preparationWon
      ? before.order!.status === 'PENDING_CONFIRMATION'
        ? 'CONFIRMED'
        : 'PACKING'
      : 'CANCELLED';
    const actorType = preparationWon ? 'SELLER' : cancelActor;
    const actorId = actorType === 'SELLER' ? seller.id : buyer.id;
    expect(after.order!.status).toBe(status);
    expect(after.commands).toHaveLength(before.commands.length + 1);
    expect(after.commands.at(-1)).toMatchObject({
      status: 'SUCCEEDED',
      actorId,
      actorType,
    });
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.history.at(-1)).toMatchObject({
      fromStatus: before.order!.status,
      toStatus: status,
      actorId,
      actorType,
      commandId: after.commands.at(-1)!.id,
    });
    expect(after.product!.moderationStatus).toBe('APPROVED');
    expect(after.items).toEqual(before.items);
    expect(after.checkout).toEqual(before.checkout);
    expect(after.cart).toEqual(before.cart);
    if (preparationWon) {
      expect(after.payment).toEqual(before.payment);
      expect(after.variants).toEqual(before.variants);
      expect(after.product).toEqual(before.product);
      expect(after.movements).toEqual(before.movements);
      expect(after.outbox).toEqual(before.outbox);
    } else {
      expect(after.payment).toMatchObject({
        provider: 'COD',
        status: 'CANCELLED',
        amount: before.payment!.amount,
      });
      expect(after.variants.map((v) => v.stock)).toEqual([2, 2]);
      const restores = after.movements.filter(
        (m) => m.type === 'CANCELLATION_RESTORE',
      );
      expect(restores).toHaveLength(2);
      for (const item of before.items)
        expect(restores.find((m) => m.orderItemId === item.id)).toMatchObject({
          variantId: item.variantId,
          quantityDelta: item.quantity,
          balanceAfter: 2,
        });
      expect(after.product!.version).toBe(before.product!.version + 1);
      expect(after.outbox).toHaveLength(before.outbox.length + 1);
      const category = await prisma.category.findUniqueOrThrow({
        where: { id: categoryId },
      });
      expect(after.outbox.at(-1)).toMatchObject({
        operation: 'UPSERT',
        productId,
        version: before.product!.version + 1,
      });
      expect(after.outbox.at(-1)!.payload).toEqual({
        productId,
        version: before.product!.version + 1,
        name: 'Original product',
        description: '',
        categoryId,
        categoryName: 'Cancellation leaf',
        categoryPathIds:
          category.parentId === null
            ? [categoryId]
            : [category.parentId, categoryId],
        brandId: null,
        brandName: null,
        attributes: {},
        imageUrls: ['/uploads/cancellation-fixture.jpg'],
        minPrice: '10000',
        maxPrice: '10000',
        inStock: true,
      });
    }
    for (const actor of [buyer, seller]) {
      const read = await request(app.getHttpServer())
        .get(`${actor === seller ? '/seller' : ''}/orders/${orderId}`)
        .set('Authorization', actor.token)
        .expect(200);
      expect(read.headers['cache-control']).toBe('no-store');
      expect(read.body.status).toBe(status);
      expect(
        read.body.items.map(
          (item: {
            productName: string;
            unitPrice: string;
            quantity: number;
          }) => ({
            name: item.productName,
            price: item.unitPrice,
            quantity: item.quantity,
          }),
        ),
      ).toEqual(
        before.items.map((item) => ({
          name: item.productNameSnapshot,
          price: item.unitPrice.toFixed(2),
          quantity: item.quantity,
        })),
      );
      expect(read.body.shippingAddress).toMatchObject({
        recipientName: before.order!.recipientNameSnapshot,
        addressLine: before.order!.addressLineSnapshot,
      });
      expect(read.body.payment.status).toBe(
        preparationWon ? 'UNPAID' : 'CANCELLED',
      );
      expect(read.body.timeline.at(-1)).toMatchObject({
        fromStatus: before.order!.status,
        toStatus: status,
        actorType,
        actorId: actorType === 'SELLER' && actor === buyer ? null : actorId,
      });
      expect(read.body.timeline).toHaveLength(after.history.length);
    }
    return after;
  }
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !(
        target.pathname.startsWith('/bckl_') ||
        (process.env.GITHUB_ACTIONS === 'true' &&
          target.pathname === '/klcn_ecommerce')
      )
    )
      throw new Error('Dedicated test database required');
    app = await start();
    second = await start();
    prisma = app.get(PrismaService);
    otherPrisma = second.get(PrismaService);
    outsider = await user('USER');
    admin = await user('ADMIN');
    categoryId = (
      await prisma.category.create({
        data: { name: 'Cancellation leaf', slug: marker },
      })
    ).id;
  });
  beforeEach(async () => {
    seller = await user('SELLER');
    buyer = await user('USER');
    storeId = (
      await prisma.store.create({
        data: {
          name: `${marker}-${serial++}`,
          sellerId: seller.id,
          status: 'ACTIVE',
        },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: {
          storeId,
          categoryId,
          name: 'Original product',
          sellerStatus: 'ACTIVE',
          moderationStatus: 'APPROVED',
          images: {
            create: {
              url: '/uploads/cancellation-fixture.jpg',
              isPrimary: true,
            },
          },
          shippingProfile: { create: { packageWeightGrams: 100 } },
        },
      })
    ).id;
    variantIds = [];
    for (let i = 0; i < 2; i++)
      variantIds.push(
        (
          await prisma.productVariant.create({
            data: {
              productId,
              storeId,
              skuCode: `${marker}-${serial++}`,
              optionSignature: `sample-${i}`,
              stock: 2,
              price: '10000',
            },
          })
        ).id,
      );
    const address = await prisma.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: 'Original name',
        phone: '0901234567',
        province: 'Province',
        ward: 'Ward',
        addressLine: 'Original address',
      },
    });
    const cart = await prisma.cart.create({ data: { userId: buyer.id } });
    for (const variantId of variantIds)
      await prisma.cartItem.create({
        data: { cartId: cart.id, variantId, quantity: 2 },
      });
    const created = await request(app.getHttpServer())
      .post('/checkouts')
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', key())
      .send({
        addressId: address.id,
        paymentProvider: 'COD',
        items: variantIds.map((variantId) => ({
          variantId,
          quantity: 2,
          expectedUnitPrice: '10000',
        })),
      })
      .expect(201);
    checkoutId = created.body.checkoutId;
    orderId = created.body.orders[0].id;
  });
  afterAll(async () => {
    try {
      if (prisma) {
        const owned = { buyer: { email: { startsWith: marker } } };
        await prisma.stockMovement.deleteMany({
          where: { orderItem: { order: owned } },
        });
        await prisma.orderStatusHistory.deleteMany({ where: { order: owned } });
        await prisma.orderCommand.deleteMany({ where: { order: owned } });
        await prisma.payment.deleteMany({ where: { order: owned } });
        await prisma.orderItem.deleteMany({ where: { order: owned } });
        await prisma.order.deleteMany({ where: owned });
        await prisma.checkout.deleteMany({ where: owned });
        await prisma.cartItem.deleteMany({
          where: { cart: { user: { email: { startsWith: marker } } } },
        });
        await prisma.searchOutbox.deleteMany({
          where: { product: { store: { name: { startsWith: marker } } } },
        });
        await prisma.product.deleteMany({
          where: { store: { name: { startsWith: marker } } },
        });
        await prisma.store.deleteMany({
          where: { name: { startsWith: marker } },
        });
        await prisma.category.deleteMany({
          where: { slug: { startsWith: marker } },
        });
        await prisma.brand.deleteMany({
          where: { slug: { startsWith: marker } },
        });
        await prisma.user.deleteMany({
          where: { email: { startsWith: marker } },
        });
      }
    } finally {
      await second?.close();
      await app?.close();
    }
  });
  it('cancels real COD checkout atomically; restores two variants but only one Product version/outbox', async () => {
    // Distinct prices, a parent category, brand and ordered images prevent a
    // truncated/default payload from passing. Expected values are independent
    // of the production payload builder; historical Order prices stay intact.
    const parent = await prisma.category.create({
      data: { name: 'Cancellation parent', slug: `${marker}-parent` },
    });
    await prisma.category.update({
      where: { id: categoryId },
      data: { parentId: parent.id },
    });
    const brand = await prisma.brand.create({
      data: { name: 'Cancellation brand', slug: `${marker}-brand` },
    });
    await prisma.product.update({
      where: { id: productId },
      data: { brandId: brand.id, description: 'Current catalog description' },
    });
    await prisma.productVariant.update({
      where: { id: variantIds[1] },
      data: { price: '20000' },
    });
    await prisma.productImage.updateMany({
      where: { productId, isPrimary: true },
      data: { sortOrder: 2 },
    });
    await prisma.productImage.create({
      data: {
        productId,
        url: '/uploads/cancellation-secondary.jpg',
        sortOrder: 0,
      },
    });
    const detail = (actor = buyer) =>
      request(app.getHttpServer())
        .get(`${actor === seller ? '/seller' : ''}/orders/${orderId}`)
        .set('Authorization', actor.token);
    const detailBefore = await detail().expect(200);
    const before = await state();
    const header = key();
    const first = await post(header).expect(200);
    const after = await state();
    expect(first.body).toMatchObject({
      orderId,
      command: 'cancel',
      replayed: false,
      result: {
        status: 'CANCELLED',
        payment: { amount: '40000.00', status: 'CANCELLED' },
        cancellation: { cancelledBy: { id: buyer.id, type: 'BUYER' }, ...body },
      },
    });
    expect(first.headers['cache-control']).toBe('no-store');
    expect(after.variants.map((v) => v.stock)).toEqual([2, 2]);
    expect(
      after.movements.filter((m) => m.type === 'CANCELLATION_RESTORE'),
    ).toHaveLength(2);
    expect(after.product!.version).toBe(before.product!.version + 1);
    expect(after.product!.moderationStatus).toBe('APPROVED');
    expect(after.outbox).toHaveLength(before.outbox.length + 1);
    expect(after.outbox.at(-1)).toMatchObject({
      operation: 'UPSERT',
      productId,
      version: before.product!.version + 1,
    });
    expect(after.outbox.at(-1)!.payload).toEqual({
      productId,
      version: before.product!.version + 1,
      name: 'Original product',
      description: 'Current catalog description',
      categoryId,
      categoryName: 'Cancellation leaf',
      categoryPathIds: [parent.id, categoryId],
      brandId: brand.id,
      brandName: 'Cancellation brand',
      attributes: {},
      imageUrls: [
        '/uploads/cancellation-fixture.jpg',
        '/uploads/cancellation-secondary.jpg',
      ],
      minPrice: '10000',
      maxPrice: '20000',
      inStock: true,
    });
    expect(after.checkout).toEqual(before.checkout);
    expect(after.items).toEqual(before.items);
    expect(after.cart).toEqual([]);
    for (const actor of [buyer, seller]) {
      const read = await detail(actor).expect(200);
      expect(read.headers['cache-control']).toBe('no-store');
      expect(read.body.items).toEqual(detailBefore.body.items);
      expect(read.body.shippingAddress).toEqual(
        detailBefore.body.shippingAddress,
      );
      expect(read.body.total).toBe(detailBefore.body.total);
      expect(read.body.payment).toMatchObject({
        provider: 'COD',
        status: 'CANCELLED',
        amount: '40000.00',
      });
      expect(read.body.cancellation).toMatchObject({
        cancelledBy: { type: 'BUYER', id: buyer.id },
        reasonCode: body.reasonCode,
        reasonText: body.reasonText,
      });
      expect(read.body.timeline.at(-1)).toMatchObject({
        fromStatus: 'PENDING_CONFIRMATION',
        toStatus: 'CANCELLED',
        actorType: 'BUYER',
        actorId: buyer.id,
      });
      expect(read.body).not.toHaveProperty('idempotencyKey');
      expect(read.body).not.toHaveProperty('requestHash');
      expect(read.body).not.toHaveProperty('receipt');
    }
    const replay = await post(header, second).expect(200);
    expect(replay.body.result).toEqual(first.body.result);
    expect(replay.body.replayed).toBe(true);
    expect(await state()).toEqual(after);
    await post(key())
      .expect(409)
      .expect(({ body: response }) =>
        expect(response.code).toBe('ORDER_CANNOT_CANCEL'),
      );
    await post(header, app, buyer, { ...body, reasonText: 'Khác' })
      .expect(409)
      .expect(({ body: response }) =>
        expect(response.code).toBe('IDEMPOTENCY_CONFLICT'),
      );
    const restarted = await start();
    try {
      await post(header, restarted)
        .expect(200)
        .expect(({ body: response }) =>
          expect(response.result).toEqual(first.body.result),
        );
    } finally {
      await restarted.close();
    }
  });
  it.each([false, true])(
    'real confirm vs Buyer cancel race, reversed app assignment=%s',
    async (reverse) => {
      const before = await state();
      const confirmKey = key(),
        cancelKey = key();
      const [confirm, cancel] = await Promise.all([
        preparation('confirm', confirmKey, reverse ? app : second),
        post(cancelKey, reverse ? second : app),
      ]);
      expect([confirm.status, cancel.status].sort()).toEqual([200, 409]);
      const confirmed = confirm.status === 200;
      expect(confirmed ? cancel.body.code : confirm.body.code).toBe(
        confirmed ? 'ORDER_CANNOT_CANCEL' : 'INVALID_ORDER_TRANSITION',
      );
      const after = await assertCommandRace(before, confirmed);
      const replay = confirmed
        ? await preparation('confirm', confirmKey, app).expect(200)
        : await post(cancelKey, second).expect(200);
      expect(replay.body.result).toEqual(
        (confirmed ? confirm : cancel).body.result,
      );
      expect(replay.body.replayed).toBe(true);
      if (confirmed) await post(cancelKey, second).expect(409);
      else await preparation('confirm', confirmKey, app).expect(409);
      expect(await state()).toEqual(after);
    },
  );
  it.each(['confirm', 'cancel'] as const)(
    'real competing requests observe canonical state when %s wins',
    async (winner) => {
      const before = await state();
      const confirmKey = key(),
        cancelKey = key();
      const delayedActor = winner === 'confirm' ? buyer.id : seller.id;
      let release!: () => void, ready!: (pid: number) => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const holding = otherPrisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${delayedActor} FOR UPDATE`;
          const rows = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          ready(rows[0]!.pid);
          await gate;
        },
        { timeout: 10000 },
      );
      const blockerPid = await locked;
      const pending = (
        winner === 'confirm'
          ? post(cancelKey)
          : preparation('confirm', confirmKey)
      ).then((response) => response);
      let winningResponse;
      try {
        let waiting = 0;
        for (let attempt = 0; attempt < 30; attempt++) {
          const rows = await prisma.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND ${blockerPid} = ANY(pg_blocking_pids(pid))`;
          waiting = Number(rows[0]!.count);
          if (waiting > 0) break;
          await delay(10);
        }
        expect(waiting).toBeGreaterThan(0);
        winningResponse =
          winner === 'confirm'
            ? await preparation('confirm', confirmKey, app).expect(200)
            : await post(cancelKey, app).expect(200);
      } finally {
        release();
        await holding;
        await pending;
      }
      const losingResponse = await pending;
      expect(losingResponse.status).toBe(409);
      expect(losingResponse.body.code).toBe(
        winner === 'confirm'
          ? 'ORDER_CANNOT_CANCEL'
          : 'INVALID_ORDER_TRANSITION',
      );
      const after = await assertCommandRace(before, winner === 'confirm');
      const replay =
        winner === 'confirm'
          ? await preparation('confirm', confirmKey, second).expect(200)
          : await post(cancelKey, second).expect(200);
      expect(replay.body.result).toEqual(winningResponse!.body.result);
      expect(replay.body.replayed).toBe(true);
      expect(await state()).toEqual(after);
    },
  );
  it('real start-packing vs Seller cancel serializes a CONFIRMED order; replay confirmation remains immutable', async () => {
    const confirmKey = key();
    const confirmed = await preparation('confirm', confirmKey).expect(200);
    const before = await state();
    const packingKey = key(),
      cancelKey = key();
    const [packing, cancel] = await Promise.all([
      preparation('start-packing', packingKey, second),
      post(cancelKey, app, seller, sellerBody),
    ]);
    expect([packing.status, cancel.status].sort()).toEqual([200, 409]);
    expect(packing.status === 200 ? cancel.body.code : packing.body.code).toBe(
      packing.status === 200
        ? 'ORDER_CANNOT_CANCEL'
        : 'INVALID_ORDER_TRANSITION',
    );
    const after = await assertCommandRace(
      before,
      packing.status === 200,
      'SELLER',
    );
    const replay = await preparation('confirm', confirmKey, app).expect(200);
    expect(replay.body.result).toEqual(confirmed.body.result);
    const winnerReplay =
      packing.status === 200
        ? await preparation('start-packing', packingKey, app).expect(200)
        : await post(cancelKey, second, seller, sellerBody).expect(200);
    expect(winnerReplay.body.result).toEqual(
      (packing.status === 200 ? packing : cancel).body.result,
    );
    expect(await state()).toEqual(after);
  });
  it.each(['PENDING_CONFIRMATION', 'CONFIRMED'] as const)(
    'Seller cancels %s with structured audit',
    async (status) => {
      await prisma.order.update({ where: { id: orderId }, data: { status } });
      await post(key(), app, seller, sellerBody).expect(200);
      const after = await state();
      expect(after.order).toMatchObject({
        status: 'CANCELLED',
        cancelledByType: 'SELLER',
        cancelledById: seller.id,
        cancellationReasonCode: sellerBody.reasonCode,
      });
      expect(after.history.at(-1)).toMatchObject({
        fromStatus: status,
        actorType: 'SELLER',
        reasonText: sellerBody.reasonText,
      });
    },
  );
  it.each([
    'CONFIRMED',
    'PACKING',
    'READY_TO_SHIP',
    'SHIPPING',
    'DELIVERED',
    'DELIVERY_FAILED',
    'COMPLETED',
  ] as const)('Buyer rejects state %s without mutation', async (status) => {
    await prisma.order.update({ where: { id: orderId }, data: { status } });
    const before = await state();
    await post()
      .expect(409)
      .expect(({ body: response }) =>
        expect(response.code).toBe('ORDER_CANNOT_CANCEL'),
      );
    expect(await state()).toEqual(before);
  });
  it.each(['PACKING', 'READY_TO_SHIP', 'SHIPPING', 'DELIVERY_FAILED'] as const)(
    'Seller rejects %s without restoring shipped stock',
    async (status) => {
      await prisma.order.update({ where: { id: orderId }, data: { status } });
      const before = await state();
      await post(key(), app, seller, sellerBody).expect(409);
      expect(await state()).toEqual(before);
    },
  );
  it('hides Order existence from other Buyer and from Seller on Buyer route', async () => {
    const before = await state();
    await post(key(), app, outsider).expect(404);
    await post(key(), app, buyer, body, 2147483647).expect(404);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', seller.token)
      .set('Idempotency-Key', key())
      .send(body)
      .expect(403);
    await post(key(), app, admin).expect(403);
    const otherSeller = await user('SELLER');
    await request(second.getHttpServer())
      .post(`/seller/orders/${orderId}/cancel`)
      .set('Authorization', otherSeller.token)
      .set('Idempotency-Key', key())
      .send(sellerBody)
      .expect(404);
    expect(await state()).toEqual(before);
  });
  it('rejects missing authentication/key and invalid Order ID', async () => {
    const before = await state();
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', buyer.token)
      .send(body)
      .expect(400)
      .expect(({ body: response }) =>
        expect(response.code).toBe('IDEMPOTENCY_KEY_REQUIRED'),
      );
    await request(app.getHttpServer())
      .post('/orders/1.1/cancel')
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', key())
      .send(body)
      .expect(400);
    expect(await state()).toEqual(before);
  });
  it('ingress quota counts invalid commands; rejects request 21 without changing inventory', async () => {
    const before = await state();
    for (let i = 0; i < 20; i++) await post(key(), app, buyer, {}).expect(400);
    const response = await post().expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(await state()).toEqual(before);
  });
  it.each([
    { secret: 'must not leak' },
    { status: 'CANCELLED', payment: null },
  ])(
    'corrupt durable receipt fails safely before any mutation %#',
    async (result) => {
      const header = key();
      const input = prepareOrderCommand({
        actorId: buyer.id,
        actorType: 'BUYER',
        orderId,
        command: 'cancel',
        idempotencyKey: header,
        body,
      });
      await prisma.$transaction(
        (tx) =>
          tx.orderCommand.create({
            data: {
              orderId,
              actorId: buyer.id,
              actorType: 'BUYER',
              actorScope: input.actorScope,
              idempotencyKey: header,
              command: 'cancel',
              requestHash: input.requestHash,
              hashVersion: 1,
              status: 'SUCCEEDED',
              responseStatus: 200,
              resultSnapshot: result as Prisma.InputJsonObject,
              createdAt: new Date(0),
              completedAt: new Date(),
            },
          }),
        { isolationLevel: 'Serializable' },
      );
      const before = await state();
      const response = await post(header, second).expect(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('must not leak');
      expect(await state()).toEqual(before);
    },
  );
  it.each([
    {},
    { ...body, actorId: 1 },
    { ...body, restockable: true },
    { ...body, reasonText: ' ' },
    { ...body, reasonCode: 'OUT_OF_STOCK' },
    { ...body, reasonText: 'x'.repeat(501) },
    [],
  ])('rejects invalid DTO %#', async (payload) => {
    const before = await state();
    await post(key(), app, buyer, payload).expect(400);
    expect(await state()).toEqual(before);
  });
  it('trims reason, rejects queries, malformed JSON and oversized JSON', async () => {
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel?status=CANCELLED`)
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', key())
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', buyer.token)
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    await post(key(), app, buyer, {
      ...body,
      reasonText: 'x'.repeat(9000),
    }).expect(413);
    await post(key(), app, buyer, { ...body, reasonText: '  Trimmed  ' })
      .expect(200)
      .expect(({ body: response }) =>
        expect(response.result.cancellation.reasonText).toBe('Trimmed'),
      );
  });
  it.each(['SUSPENDED'] as const)(
    'Seller can cancel old order in %s Store; public index receives DELETE',
    async (status) => {
      await prisma.store.update({ where: { id: storeId }, data: { status } });
      const before = await state();
      const header = key();
      await post(header, app, seller, sellerBody).expect(200);
      const after = await state();
      expect(after.product!.version).toBe(before.product!.version + 1);
      expect(after.outbox).toHaveLength(before.outbox.length + 1);
      expect(after.outbox.at(-1)).toMatchObject({
        operation: 'DELETE',
        productId,
        version: before.product!.version + 1,
      });
      expect(after.outbox.at(-1)!.payload).toEqual({
        productId,
        version: before.product!.version + 1,
      });
      expect(after.product!.moderationStatus).toBe('APPROVED');
      await post(header, second, seller, sellerBody).expect(200);
      expect(await state()).toEqual(after);
    },
  );
  it('Buyer cancellation is allowed even when Store CLOSED; Seller new command is blocked', async () => {
    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'CLOSED' },
    });
    await post(key(), app, seller, sellerBody).expect(409);
    const before = await state();
    await post().expect(200);
    const after = await state();
    expect(after.product!.version).toBe(before.product!.version + 1);
    expect(after.outbox).toHaveLength(before.outbox.length + 1);
    expect(after.outbox.at(-1)).toMatchObject({
      operation: 'DELETE',
      productId,
      version: before.product!.version + 1,
    });
    expect(after.outbox.at(-1)!.payload).toEqual({
      productId,
      version: before.product!.version + 1,
    });
  });
  it('disabled actor cannot replay; later price/name edits do not change snapshots', async () => {
    await prisma.product.update({
      where: { id: productId },
      data: { name: 'Changed now' },
    });
    await prisma.productVariant.updateMany({
      where: { productId },
      data: { price: 30000 },
    });
    const before = await state();
    const header = key();
    await post(header).expect(200);
    expect((await state()).items).toEqual(before.items);
    await prisma.user.update({
      where: { id: buyer.id },
      data: { isActive: false },
    });
    await post(header, second).expect(401);
  });
  it.each([
    'missing-decrement',
    'wrong-quantity',
    'existing-restore',
    'overflow',
    'version-overflow',
    'missing-payment',
    'paid-cod',
    'sandbox-paid',
  ] as const)('fails closed for %s', async (failure) => {
    const item = (await state()).items[0]!;
    if (failure === 'missing-decrement')
      await prisma.stockMovement.deleteMany({
        where: { orderItemId: item.id },
      });
    if (failure === 'wrong-quantity')
      await prisma.stockMovement.updateMany({
        where: { orderItemId: item.id },
        data: { quantityDelta: -1 },
      });
    if (failure === 'existing-restore')
      await prisma.stockMovement.create({
        data: {
          variantId: item.variantId,
          orderItemId: item.id,
          type: 'RETURN_RESTORE',
          quantityDelta: 2,
          balanceAfter: 2,
          idempotencyKey: key(),
        },
      });
    if (failure === 'overflow')
      await prisma.productVariant.update({
        where: { id: variantIds[1] },
        data: { stock: 2147483647 },
      });
    if (failure === 'version-overflow')
      await prisma.product.update({
        where: { id: productId },
        data: { version: 2147483647 },
      });
    if (failure === 'missing-payment')
      await prisma.payment.delete({ where: { orderId } });
    if (failure === 'paid-cod' || failure === 'sandbox-paid')
      await prisma.payment.update({
        where: { orderId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          provider: failure === 'paid-cod' ? 'COD' : 'MOMO',
        },
      });
    const before = await state();
    await post().expect(409);
    expect(await state()).toEqual(before);
  });
  it('same key and different keys race across two processes restore only once', async () => {
    const header = key();
    const responses = await Promise.all([
      post(header),
      post(header, second),
      post(key(), second, seller, sellerBody),
    ]);
    expect(
      responses.filter((r) => r.status === 200).length,
    ).toBeGreaterThanOrEqual(1);
    expect(responses.every((r) => [200, 409].includes(r.status))).toBe(true);
    const after = await state();
    expect(after.commands).toHaveLength(1);
    expect(
      after.movements.filter((m) => m.type === 'CANCELLATION_RESTORE'),
    ).toHaveLength(2);
    expect(after.variants.map((v) => v.stock)).toEqual([2, 2]);
    expect(after.outbox).toHaveLength(2);
  });
  it('same key for a different owned Order is a conflict, not replay', async () => {
    const header = key();
    await post(header).expect(200);
    const original = (await state()).order!;
    const other = await prisma.order.create({
      data: {
        checkoutId: original.checkoutId,
        buyerId: buyer.id,
        storeId: (
          await prisma.store.create({
            data: {
              sellerId: (await user('SELLER')).id,
              name: `${marker}-${serial++}`,
              status: 'ACTIVE',
            },
          })
        ).id,
        orderNumber: `${marker}-${serial++}`,
        recipientNameSnapshot: 'Name',
        phoneSnapshot: '0901234567',
        provinceSnapshot: 'Province',
        wardSnapshot: 'Ward',
        addressLineSnapshot: 'Address',
        subtotal: 0,
        shippingFee: 0,
        total: 0,
      },
    });
    await post(header, second, buyer, body, other.id)
      .expect(409)
      .expect(({ body: response }) =>
        expect(response.code).toBe('IDEMPOTENCY_CONFLICT'),
      );
    expect(
      await prisma.orderCommand.count({ where: { orderId: other.id } }),
    ).toBe(0);
  });
  it.each([
    'stock_movements',
    'search_outbox',
    'order_status_history',
    'order_commands',
    'payments',
  ] as const)(
    'SQL failure at %s rolls back Order/Payment/stock/version/outbox/receipt together',
    async (table) => {
      const trigger = `cancel_failure_${serial++}`;
      const before = await state();
      // Identifiers are generated solely from fixed test constants, never client data.
      const event = ['order_commands', 'payments'].includes(table)
        ? 'UPDATE'
        : 'INSERT';
      const predicate =
        table === 'search_outbox'
          ? `NEW."productId" = ${productId}`
          : table === 'stock_movements'
            ? `NEW."variantId" = ${variantIds[1]} AND NEW."type" = 'CANCELLATION_RESTORE'`
            : `NEW."orderId" = ${orderId}`;
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'isolated cancellation test failure'; END IF; RETURN NEW; END $$`,
      );
      try {
        await prisma.$executeRawUnsafe(
          `CREATE TRIGGER "${trigger}" BEFORE ${event} ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
        );
        await post().expect(500);
        expect(await state()).toEqual(before);
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`,
        );
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "${trigger}"()`,
        );
      }
      await post().expect(200);
    },
  );
  it('bounded Order lock timeout returns retryable response then same key succeeds', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const locked = new Promise<void>((resolve) => (ready = resolve));
    const holding = otherPrisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await locked;
    const header = key();
    try {
      const response = await post(header).expect(409);
      expect(response.body.code).toBe('ORDER_COMMAND_IN_PROGRESS');
      expect(response.headers['retry-after']).toBe('1');
    } finally {
      release();
      await holding;
    }
    await post(header).expect(200);
  });
  it('competing real Checkout uses restored inventory without lost increments', async () => {
    const competitor = await user('USER');
    const address = await prisma.userAddress.create({
      data: {
        userId: competitor.id,
        recipientName: 'Other Buyer',
        phone: '0901234567',
        province: 'Province',
        ward: 'Ward',
        addressLine: 'Other address',
      },
    });
    const cart = await prisma.cart.create({ data: { userId: competitor.id } });
    await prisma.cartItem.create({
      data: { cartId: cart.id, variantId: variantIds[0]!, quantity: 1 },
    });
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const locked = new Promise<void>((r) => (ready = r));
    const holding = otherPrisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await locked;
    const buyKey = key();
    const purchase = () =>
      request(second.getHttpServer())
        .post('/checkouts')
        .set('Authorization', competitor.token)
        .set('Idempotency-Key', buyKey)
        .send({
          addressId: address.id,
          paymentProvider: 'COD',
          items: [
            {
              variantId: variantIds[0],
              quantity: 1,
              expectedUnitPrice: '10000',
            },
          ],
        });
    const cancel = post().then((response) => response);
    const buy = purchase().then((response) => response);
    try {
      let waiting = 0;
      for (let i = 0; i < 30; i++) {
        const rows = await prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%products%FOR UPDATE%'`;
        waiting = Number(rows[0]!.count);
        if (waiting >= 2) break;
        await delay(15);
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      release();
      await holding;
    }
    const [cancelResponse, buyResponse] = await Promise.all([cancel, buy]);
    expect(cancelResponse.status).toBe(200);
    expect([201, 409]).toContain(buyResponse.status);
    if (buyResponse.status === 409) await purchase().expect(201);
    const current = await state();
    expect(current.variants.map((v) => v.stock)).toEqual([1, 2]);
    expect(current.product!.version).toBe(4);
    expect(current.outbox).toHaveLength(3);
    expect(
      await prisma.order.count({ where: { buyerId: competitor.id } }),
    ).toBe(1);
  });
  it('same-key requests genuinely overlap on actor DB lock and replay exactly once', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const locked = new Promise<void>((r) => (ready = r));
    const holding = otherPrisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${buyer.id} FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 10000 },
    );
    await locked;
    const header = key();
    const left = post(header).then((r) => r);
    const right = post(header, second).then((r) => r);
    try {
      let waiting = 0;
      for (let i = 0; i < 30; i++) {
        const rows = await prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%users%FOR UPDATE%'`;
        waiting = Number(rows[0]!.count);
        if (waiting >= 2) break;
        await delay(15);
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      release();
      await holding;
    }
    const responses = await Promise.all([left, right]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    expect(responses[0]!.body.result).toEqual(responses[1]!.body.result);
    expect((await state()).commands).toHaveLength(1);
  });
  it('latest state is re-read after concurrent writer commits, not the request start state', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const locked = new Promise<void>((r) => (ready = r));
    const holding = otherPrisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
        await tx.order.update({
          where: { id: orderId },
          data: { status: 'CONFIRMED' },
        });
        ready();
        await gate;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    );
    await locked;
    const pending = post().then((response) => response);
    try {
      await delay(150);
      release();
      await holding;
      const response = await pending;
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_CANNOT_CANCEL');
    } finally {
      release();
    }
    expect(
      (await state()).movements.filter(
        (m) => m.type === 'CANCELLATION_RESTORE',
      ),
    ).toHaveLength(0);
  });
});
