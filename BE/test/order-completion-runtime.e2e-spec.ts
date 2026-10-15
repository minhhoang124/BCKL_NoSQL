import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OrderCompletionService } from '../src/order/order-completion.service.js';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Role, type OrderStatus } from '@prisma/client';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Buyer completion / durable D07 runtime — real PostgreSQL', () => {
  let app: INestApplication, other: INestApplication, prisma: PrismaService;
  let admin: { id: number; token: string },
    buyer: { id: number; token: string },
    seller: { id: number; token: string };
  let storeId: number,
    orderId: number,
    productId: number,
    variantId: number,
    categoryId: number;
  let serial = 0;
  const marker = 'delivery-command-' + Date.now();
  const orders: number[] = [],
    checkouts: number[] = [],
    addresses: number[] = [],
    carts: number[] = [],
    users: number[] = [];
  const previousRate = process.env.ORDER_COMMAND_RATE_PER_MINUTE;
  const key = () => marker + '-key-' + serial++;
  const runtimes: INestApplication[] = [];
  const oldEnabled = process.env.ORDER_AUTO_COMPLETE_ENABLED;
  const post = (
    command = 'complete',
    body: unknown = {},
    k = key(),
    instance = app,
    token = buyer.token,
    id = orderId,
  ) =>
    request(instance.getHttpServer())
      .post('/orders/' + id + '/' + command)
      .set('Authorization', token)
      .set('Idempotency-Key', k)
      .send(body as object);
  async function start() {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const instance = module.createNestApplication();
    configureApp(instance);
    await instance.listen(0, '127.0.0.1');
    return instance;
  }
  async function actor(role: Role) {
    const user = await prisma.user.create({
      data: {
        email: marker + serial++ + '@example.test',
        role,
        passwordHash: 'fixture-only',
      },
    });
    users.push(user.id);
    const config = app.get(ConfigService);
    const jwt = app.get(JwtService).sign(
      { sub: user.id, role, email: user.email, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { id: user.id, token: 'Bearer ' + jwt };
  }
  // Controlled DELIVERED/paid fixture; separate integration cases below create
  // their own Order, ledger and delivery history through real HTTP.
  async function fixture(
    status: OrderStatus = 'DELIVERED',
    ageMs = 4 * 86400000,
  ) {
    const checkout = await prisma.checkout.create({
      data: {
        buyerId: buyer.id,
        idempotencyKey: key(),
        requestHash: 'legacy-controlled-fixture',
      },
    });
    checkouts.push(checkout.id);
    const order = await prisma.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId,
        status,
        deliveredAt:
          status === 'DELIVERED' ? new Date(Date.now() - ageMs) : null,
        orderNumber: key(),
        recipientNameSnapshot: 'Private recipient',
        phoneSnapshot: '0901234567',
        provinceSnapshot: 'Province',
        wardSnapshot: 'Ward',
        addressLineSnapshot: 'Private address',
        subtotal: '10000.00',
        total: '10000.00',
        shippingFee: 0,
        discountTotal: 0,
        payment: {
          create: {
            provider: 'COD',
            amount: '10000.00',
            status: 'PAID',
            paidAt: new Date(Date.now() - ageMs),
          },
        },
        items: {
          create: {
            productId,
            variantId,
            productNameSnapshot: 'Original',
            skuSnapshot: 'Original-SKU',
            optionSnapshot: {},
            unitPrice: '10000.00',
            quantity: 1,
            lineTotal: '10000.00',
          },
        },
      },
    });
    orders.push(order.id);
    return order.id;
  }
  async function state(id = orderId) {
    return {
      job: await prisma.orderCompletionJob.findUnique({
        where: { orderId: id },
      }),
      order: await prisma.order.findUnique({ where: { id } }),
      items: await prisma.orderItem.findMany({
        where: { orderId: id },
        orderBy: { id: 'asc' },
      }),
      payment: await prisma.payment.findUnique({ where: { orderId: id } }),
      commands: await prisma.orderCommand.findMany({
        where: { orderId: id },
        orderBy: { id: 'asc' },
      }),
      history: await prisma.orderStatusHistory.findMany({
        where: { orderId: id },
        orderBy: { id: 'asc' },
      }),
      attempts: await prisma.deliveryAttempt.findMany({
        where: { orderId: id },
        orderBy: { deliveryAttempt: 'asc' },
      }),
      product: await prisma.product.findUnique({ where: { id: productId } }),
      variant: await prisma.productVariant.findUnique({
        where: { id: variantId },
      }),
      movements: await prisma.stockMovement.findMany({ where: { variantId } }),
      outbox: await prisma.searchOutbox.findMany({ where: { productId } }),
    };
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        url.pathname.startsWith('/bckl_') ||
        (process.env.GITHUB_ACTIONS === 'true' &&
          url.pathname === '/klcn_ecommerce')
      )
    )
      throw new Error('Dedicated test database required');
    process.env.ORDER_COMMAND_RATE_PER_MINUTE = '60000';
    app = await start();
    other = await start();
    prisma = app.get(PrismaService);
    buyer = await actor('USER');
    seller = await actor('SELLER');
    admin = await actor('ADMIN');
    storeId = (
      await prisma.store.create({
        data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
      })
    ).id;
    categoryId = (
      await prisma.category.create({ data: { name: marker, slug: marker } })
    ).id;
    productId = (
      await prisma.product.create({
        data: { storeId, categoryId, name: marker },
      })
    ).id;
    variantId = (
      await prisma.productVariant.create({
        data: {
          storeId,
          productId,
          skuCode: marker,
          price: '10000.00',
          stock: 7,
          optionSignature: 'default',
        },
      })
    ).id;
  });
  beforeEach(async () => {
    await prisma.user.update({
      where: { id: admin.id },
      data: { isActive: true, role: 'ADMIN' },
    });
    orderId = await fixture();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (prisma) {
      await prisma.$transaction(async (tx) => {
        await tx.stockMovement.deleteMany({
          where: { orderItem: { orderId: { in: orders } } },
        });
        await tx.orderCompletionJob.deleteMany({
          where: { orderId: { in: orders } },
        });
        await tx.orderStatusHistory.deleteMany({
          where: { orderId: { in: orders } },
        });
        await tx.orderCommand.deleteMany({
          where: { orderId: { in: orders } },
        });
        await tx.payment.deleteMany({ where: { orderId: { in: orders } } });
        await tx.orderItem.deleteMany({ where: { orderId: { in: orders } } });
        await tx.deliveryAttempt.deleteMany({
          where: { orderId: { in: orders } },
        });
        await tx.order.deleteMany({ where: { id: { in: orders } } });
      });
      await prisma.checkout.deleteMany({ where: { id: { in: checkouts } } });
      await prisma.cartItem.deleteMany({ where: { cartId: { in: carts } } });
      await prisma.cart.deleteMany({ where: { id: { in: carts } } });
      await prisma.userAddress.deleteMany({ where: { id: { in: addresses } } });
      await prisma.searchOutbox.deleteMany({ where: { productId } });
      await prisma.productVariant.deleteMany({ where: { id: variantId } });
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.category.deleteMany({ where: { id: categoryId } });
      await prisma.store.deleteMany({ where: { id: storeId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    for (const instance of runtimes) await instance.close();
    if (oldEnabled === undefined)
      delete process.env.ORDER_AUTO_COMPLETE_ENABLED;
    else process.env.ORDER_AUTO_COMPLETE_ENABLED = oldEnabled;
    await other?.close();
    await app?.close();
    if (previousRate === undefined)
      delete process.env.ORDER_COMMAND_RATE_PER_MINUTE;
    else process.env.ORDER_COMMAND_RATE_PER_MINUTE = previousRate;
  });

  async function runtime(delaySeconds?: string) {
    const previousDelay = process.env.ORDER_AUTO_COMPLETE_DELAY_SECONDS;
    if (delaySeconds !== undefined)
      process.env.ORDER_AUTO_COMPLETE_DELAY_SECONDS = delaySeconds;
    process.env.ORDER_AUTO_COMPLETE_ENABLED = 'true';
    let instance: INestApplication;
    try {
      instance = await start();
    } finally {
      process.env.ORDER_AUTO_COMPLETE_ENABLED = 'false';
      if (previousDelay === undefined)
        delete process.env.ORDER_AUTO_COMPLETE_DELAY_SECONDS;
      else process.env.ORDER_AUTO_COMPLETE_DELAY_SECONDS = previousDelay;
    }
    runtimes.push(instance);
    process.env.ORDER_AUTO_COMPLETE_ENABLED = 'false';
    // Most tests invoke the REGISTERED cron callback explicitly for determinism;
    // the last test also waits for the real wall-clock scheduler.
    instance
      .get(SchedulerRegistry)
      .getCronJob('order-auto-complete-d07')
      .stop();
    return instance;
  }
  async function checkoutAndDeliver() {
    // Only catalog/address are fixtures. No SQL writes to Order/Payment/history.
    const image = await prisma.productImage.findFirst({
      where: { productId, isPrimary: true },
    });
    await prisma.product.update({
      where: { id: productId },
      data: {
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        ...(!image
          ? {
              images: {
                create: {
                  url: '/uploads/completion-integration-fixture.jpg',
                  isPrimary: true,
                },
              },
            }
          : {}),
        shippingProfile: {
          upsert: {
            create: { packageWeightGrams: 100 },
            update: { packageWeightGrams: 100 },
          },
        },
      },
    });
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: 5, price: '10000.00' },
    });
    const address = await prisma.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: 'Original completion recipient',
        phone: '0901234567',
        province: 'Province',
        ward: 'Ward',
        addressLine: 'Original completion address',
      },
    });
    addresses.push(address.id);
    await request(app.getHttpServer())
      .put(`/cart/items/${variantId}`)
      .set('Authorization', buyer.token)
      .send({ quantity: 2 })
      .expect(200);
    const cart = await prisma.cart.findUniqueOrThrow({
      where: { userId: buyer.id },
    });
    if (!carts.includes(cart.id)) carts.push(cart.id);
    const checkoutKey = key();
    const payload = {
      addressId: address.id,
      paymentProvider: 'COD',
      items: [{ variantId, quantity: 2, expectedUnitPrice: '10000.00' }],
    };
    const created = await request(app.getHttpServer())
      .post('/checkouts')
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', checkoutKey)
      .send(payload)
      .expect(201);
    checkouts.push(created.body.checkoutId);
    const id = created.body.orders[0].id as number;
    orders.push(id);
    for (const command of ['confirm', 'start-packing', 'ready-to-ship'])
      await request(other.getHttpServer())
        .post(`/seller/orders/${id}/${command}`)
        .set('Authorization', seller.token)
        .set('Idempotency-Key', key())
        .send({})
        .expect(200);
    const trackingReference = key();
    await request(app.getHttpServer())
      .post(`/admin/orders/${id}/ship`)
      .set('Authorization', admin.token)
      .set('Idempotency-Key', key())
      .send({ trackingReference })
      .expect(200);
    await request(other.getHttpServer())
      .post(`/admin/orders/${id}/mark-delivered`)
      .set('Authorization', admin.token)
      .set('Idempotency-Key', key())
      .send({ deliveryAttempt: 1, trackingReference })
      .expect(200);
    const delivered = await state(id);
    expect(delivered.order?.status).toBe('DELIVERED');
    expect(delivered.payment).toMatchObject({
      status: 'PAID',
      paidAt: delivered.order!.deliveredAt,
    });
    expect(delivered.variant?.stock).toBe(3);
    expect(
      delivered.movements.filter(
        (m) => m.orderItemId === delivered.items[0]!.id,
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'CHECKOUT_DECREMENT',
        quantityDelta: -2,
        balanceAfter: 3,
      }),
    ]);
    return {
      id,
      delivered,
      checkoutKey,
      payload,
      receipt: created.body,
      addressId: address.id,
    };
  }
  function expectCompletionOnly(
    before: Awaited<ReturnType<typeof state>>,
    after: Awaited<ReturnType<typeof state>>,
  ) {
    expect(after.order).toMatchObject({
      status: 'COMPLETED',
      deliveredAt: before.order!.deliveredAt,
    });
    expect(after.order!.completedAt).toBeInstanceOf(Date);
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.commands).toHaveLength(before.commands.length + 1);
    expect(after.history.at(-1)).toMatchObject({
      fromStatus: 'DELIVERED',
      toStatus: 'COMPLETED',
      commandId: after.commands.at(-1)!.id,
    });
    for (const field of [
      'payment',
      'items',
      'attempts',
      'product',
      'variant',
      'movements',
      'outbox',
    ] as const)
      expect(after[field]).toEqual(before[field]);
  }
  async function fire(instance: INestApplication) {
    await instance
      .get(SchedulerRegistry)
      .getCronJob('order-auto-complete-d07')
      .fireOnTick();
  }
  async function queue(id = orderId, delayMs = 3 * 86400000) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    return prisma.orderCompletionJob.create({
      data: {
        orderId: id,
        deliveredAt: o.deliveredAt!,
        dueAt: new Date(o.deliveredAt!.getTime() + delayMs),
      },
    });
  }
  it('Buyer completes atomically; another instance replays original receipt; stock/payment/snapshots unchanged', async () => {
    const before = await state(),
      k = key(),
      first = await post('complete', {}, k);
    expect(first.status).toBe(200);
    expect(first.body.result.status).toBe('COMPLETED');
    const after = await state();
    expect(after.order?.status).toBe('COMPLETED');
    expect(after.order?.recipientNameSnapshot).toBe(
      before.order?.recipientNameSnapshot,
    );
    expect(after.payment).toEqual(before.payment);
    expect(after.product).toEqual(before.product);
    expect(after.variant).toEqual(before.variant);
    expect(after.outbox).toEqual(before.outbox);
    expect(after.movements).toEqual(before.movements);
    expect(after.history).toHaveLength(1);
    expect(after.history[0]?.actorType).toBe('BUYER');
    const replay = await post('complete', {}, k, other);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...first.body, replayed: true });
    expect(await state()).toEqual(after);
    expect((await post()).status).toBe(409);
  });
  it('ownership/role/inactive enforced even on replay; no Seller/Admin complete', async () => {
    const stranger = await actor('USER');
    expect(
      (await post('complete', {}, key(), app, stranger.token)).status,
    ).toBe(404);
    expect((await post('complete', {}, key(), app, seller.token)).status).toBe(
      403,
    );
    expect((await post('complete', {}, key(), app, admin.token)).status).toBe(
      403,
    );
    const k = key();
    expect((await post('complete', {}, k)).status).toBe(200);
    await prisma.user.update({
      where: { id: buyer.id },
      data: { isActive: false },
    });
    try {
      expect((await post('complete', {}, k)).status).toBe(401);
    } finally {
      await prisma.user.update({
        where: { id: buyer.id },
        data: { isActive: true },
      });
    }
  });
  it('two instances same key complete once', async () => {
    const k = key(),
      rs = await Promise.all([
        post('complete', {}, k),
        post('complete', {}, k, other),
      ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(rs.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    expect((await state()).history).toHaveLength(1);
  });
  it('wrong source/payment/extra body fail closed', async () => {
    const before = await state();
    expect((await post('complete', { actorType: 'SYSTEM' })).status).toBe(400);
    await prisma.payment.update({
      where: { orderId },
      data: { status: 'UNPAID', paidAt: null },
    });
    const unpaid = await state();
    expect((await post()).status).toBe(409);
    expect(await state()).toEqual(unpaid);
    const id = await fixture('SHIPPING');
    expect(
      (await post('complete', {}, key(), app, buyer.token, id)).status,
    ).toBe(409);
    expect(before.order?.status).toBe('DELIVERED');
  });
  it('registered runtime discovers due Order, completes with SYSTEM receipt; second tick no duplicate', async () => {
    const rt = await runtime();
    await fire(rt);
    const s = await state();
    expect(s.order?.status).toBe('COMPLETED');
    expect(s.job?.status).toBe('SUCCEEDED');
    expect(s.history[0]).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
      toStatus: 'COMPLETED',
    });
    expect(s.commands[0]).toMatchObject({
      actorScope: 'SYSTEM:ORDER_AUTO_COMPLETE',
      actorId: null,
      command: 'complete',
    });
    await fire(rt);
    expect(await state()).toEqual(s);
    await expect(
      rt.get(OrderCompletionService).completeJob(s.job!.id, 'stale-token'),
    ).rejects.toThrow();
  });
  it('not yet 3 days is not discovered, Buyer may complete before deadline', async () => {
    const id = await fixture('DELIVERED', 2 * 86400000),
      rt = await runtime();
    await fire(rt);
    expect((await state(id)).job).toBeNull();
    expect((await state(id)).order?.status).toBe('DELIVERED');
    expect(
      (await post('complete', {}, key(), app, buyer.token, id)).status,
    ).toBe(200);
  });
  it('Buyer races runtime across apps: one history/receipt; job succeeds or skips', async () => {
    const rt = await runtime();
    await queue();
    const [buyerResult] = await Promise.all([post(), fire(rt)]);
    expect([200, 409]).toContain(buyerResult.status);
    const s = await state();
    expect(s.order?.status).toBe('COMPLETED');
    expect(s.history).toHaveLength(1);
    expect(s.commands).toHaveLength(1);
    expect(['SUCCEEDED', 'SKIPPED']).toContain(s.job?.status);
  });
  it('partial failure persists retry; other Order completes; new application resumes after fixing payment', async () => {
    const bad = orderId,
      good = await fixture();
    await prisma.payment.update({
      where: { orderId: bad },
      data: { status: 'UNPAID', paidAt: null },
    });
    const rt = await runtime();
    await fire(rt);
    const b = await state(bad);
    expect(b.order?.status).toBe('DELIVERED');
    expect(b.job?.status).toBe('RETRY');
    expect(b.job?.lastError).toBe('PAYMENT_STATE_CONFLICT');
    expect(b.commands).toHaveLength(0);
    expect((await state(good)).order?.status).toBe('COMPLETED');
    await prisma.payment.update({
      where: { orderId: bad },
      data: { status: 'PAID', paidAt: b.order!.deliveredAt },
    });
    await prisma.orderCompletionJob.update({
      where: { orderId: bad },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await rt.close();
    const restart = await runtime();
    await fire(restart);
    expect((await state(bad)).job).toMatchObject({
      status: 'SUCCEEDED',
      attemptCount: 2,
    });
  });
  it('expired lease after process crash reclaimed; stale token fenced', async () => {
    const j = await queue();
    await prisma.orderCompletionJob.update({
      where: { id: j.id },
      data: {
        status: 'RUNNING',
        attemptCount: 1,
        leaseToken: '00000000-0000-0000-0000-000000000001',
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const rt = await runtime();
    await fire(rt);
    expect((await state()).job).toMatchObject({
      status: 'SUCCEEDED',
      attemptCount: 2,
    });
    await expect(
      rt
        .get(OrderCompletionService)
        .completeJob(j.id, '00000000-0000-0000-0000-000000000001'),
    ).rejects.toThrow();
    expect((await state()).history).toHaveLength(1);
  });
  it('six failures terminal; later tick does not infinite-retry', async () => {
    await prisma.payment.update({
      where: { orderId },
      data: { status: 'UNPAID', paidAt: null },
    });
    await queue();
    const rt = await runtime();
    for (let n = 1; n <= 6; n++) {
      await prisma.orderCompletionJob.update({
        where: { orderId },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await fire(rt);
      expect((await state()).job?.attemptCount).toBe(n);
    }
    const failed = await state();
    expect(failed.job?.status).toBe('FAILED');
    await fire(rt);
    expect(await state()).toEqual(failed);
  });
  it('SQL fault at receipt finalize rolls back complete/history; durable job retries', async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION completion_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."orderId"=${orderId} AND NEW.status='SUCCEEDED' THEN RAISE EXCEPTION 'fixture fault'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER completion_test_fault BEFORE UPDATE ON order_commands FOR EACH ROW EXECUTE FUNCTION completion_test_fault()',
    );
    const rt = await runtime();
    try {
      await fire(rt);
      const s = await state();
      expect(s.order?.status).toBe('DELIVERED');
      expect(s.commands).toHaveLength(0);
      expect(s.history).toHaveLength(0);
      expect(s.job?.status).toBe('RETRY');
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER completion_test_fault ON order_commands',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION completion_test_fault()');
    }
    await prisma.orderCompletionJob.update({
      where: { orderId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await fire(rt);
    expect((await state()).order?.status).toBe('COMPLETED');
  });
  it('two runtime instances claim the same durable work without duplicate completion', async () => {
    const a = await runtime(),
      b = await runtime();
    await Promise.all([fire(a), fire(b)]);
    const s = await state();
    expect(s.order?.status).toBe('COMPLETED');
    expect(s.commands).toHaveLength(1);
    expect(s.history).toHaveLength(1);
    expect(s.job?.status).toBe('SUCCEEDED');
  });
  it('queued work rereads canonical Order after Buyer already completed', async () => {
    await queue();
    expect((await post()).status).toBe(200);
    const rt = await runtime();
    await fire(rt);
    const s = await state();
    expect(s.job?.status).toBe('SKIPPED');
    expect(s.commands).toHaveLength(1);
    expect(s.history).toHaveLength(1);
  });
  it('process crash on final attempt terminates after lease expiry', async () => {
    const j = await queue();
    await prisma.orderCompletionJob.update({
      where: { id: j.id },
      data: {
        status: 'RUNNING',
        attemptCount: 6,
        leaseToken: '00000000-0000-0000-0000-000000000002',
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const rt = await runtime();
    await fire(rt);
    expect((await state()).job).toMatchObject({
      status: 'FAILED',
      attemptCount: 6,
      lastError: 'LEASE_EXHAUSTED',
    });
    expect((await state()).order?.status).toBe('DELIVERED');
  });
  it('real COD → preparation → delivery → Buyer complete keeps payment/stock/snapshots and replays across apps', async () => {
    const { id, delivered, checkoutKey, payload, receipt, addressId } =
      await checkoutAndDeliver();
    const read = (actor = buyer) =>
      request(other.getHttpServer())
        .get(`${actor === seller ? '/seller' : ''}/orders/${id}`)
        .set('Authorization', actor.token);
    const original = (await read().expect(200)).body;
    await prisma.userAddress.update({
      where: { id: addressId },
      data: { recipientName: 'Changed after purchase' },
    });
    const k = key();
    const first = await post('complete', {}, k, app, buyer.token, id).expect(
      200,
    );
    const after = await state(id);
    expectCompletionOnly(delivered, after);
    expect(after.history.at(-1)).toMatchObject({
      actorType: 'BUYER',
      actorId: buyer.id,
    });
    for (const actor of [buyer, seller]) {
      const detail = (await read(actor).expect(200)).body;
      expect(detail.status).toBe('COMPLETED');
      expect(detail.items).toEqual(original.items);
      expect(detail.shippingAddress).toEqual(original.shippingAddress);
      expect(
        detail.timeline.map((h: { toStatus: string }) => h.toStatus),
      ).toEqual([
        'PENDING_CONFIRMATION',
        'CONFIRMED',
        'PACKING',
        'READY_TO_SHIP',
        'SHIPPING',
        'DELIVERED',
        'COMPLETED',
      ]);
      for (const field of ['commands', 'requestHash', 'idempotencyKey'])
        expect(detail).not.toHaveProperty(field);
    }
    expect(
      (await post('complete', {}, k, other, buyer.token, id).expect(200)).body,
    ).toEqual({ ...first.body, replayed: true });
    await post('complete', {}, key(), app, buyer.token, id).expect(409);
    for (const actor of [seller, admin])
      await post('complete', {}, key(), app, actor.token, id).expect(403);
    const replay = await request(other.getHttpServer())
      .post('/checkouts')
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', checkoutKey)
      .send(payload)
      .expect(200);
    expect(replay.body.checkoutId).toBe(receipt.checkoutId);
    expect(await state(id)).toEqual(after);
  });
  it('real delivered Order is discovered by registered D07 runtime; repeated tick does not complete twice', async () => {
    const { id, delivered } = await checkoutAndDeliver();
    const rt = await runtime('1'); // Explicit isolated demo delay, no backdating business rows.
    await prisma.$queryRaw`SELECT 1 AS ready FROM pg_sleep(1.1)`;
    await fire(rt);
    const after = await state(id);
    expectCompletionOnly(delivered, after);
    expect(after.history.at(-1)).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
    });
    expect(after.job).toMatchObject({
      status: 'SUCCEEDED',
      attemptCount: 1,
      deliveredAt: delivered.order!.deliveredAt,
    });
    expect(after.job!.dueAt.getTime() - after.job!.deliveredAt.getTime()).toBe(
      1000,
    );
    await fire(rt);
    await post('complete', {}, key(), other, buyer.token, id).expect(409);
    expect(await state(id)).toEqual(after);
  });
  it('real delivery Buyer-vs-D07 race commits exactly one completion and preserves financial/inventory rows', async () => {
    const { id, delivered } = await checkoutAndDeliver();
    const rt = await runtime('1');
    await prisma.$queryRaw`SELECT 1 AS ready FROM pg_sleep(1.1)`;
    // Queue boundary only: keep both competitors eligible before dispatch.
    // Business state/deliveredAt/Payment still come from real HTTP.
    await queue(id, 1000);
    const k = key();
    const [response] = await Promise.all([
      post('complete', {}, k, other, buyer.token, id),
      fire(rt),
    ]);
    expect([200, 409]).toContain(response.status);
    const after = await state(id);
    expectCompletionOnly(delivered, after);
    expect(
      after.history.filter((h) => h.toStatus === 'COMPLETED'),
    ).toHaveLength(1);
    expect(['BUYER', 'SYSTEM']).toContain(after.history.at(-1)!.actorType);
    if (response.status === 200) {
      expect(after.history.at(-1)!.actorType).toBe('BUYER');
      expect(
        (await post('complete', {}, k, app, buyer.token, id).expect(200)).body,
      ).toEqual({ ...response.body, replayed: true });
    } else {
      expect(response.body.code).toBe('INVALID_ORDER_TRANSITION');
      expect(after.history.at(-1)!.actorType).toBe('SYSTEM');
    }
    expect(['SUCCEEDED', 'SKIPPED']).toContain(after.job?.status);
    await fire(rt);
    expect(await state(id)).toEqual(after);
  });
  it('real wall-clock cron completes due Order without calling service/worker from test', async () => {
    const rt = await runtime();
    const cron = rt
      .get(SchedulerRegistry)
      .getCronJob('order-auto-complete-d07');
    cron.start();
    const until = Date.now() + 18000;
    while (Date.now() < until) {
      if (
        (await prisma.order.findUnique({ where: { id: orderId } }))?.status ===
        'COMPLETED'
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    cron.stop();
    expect((await state()).order?.status).toBe('COMPLETED');
    expect((await state()).job?.status).toBe('SUCCEEDED');
    expect(
      SwaggerModule.createDocument(app, new DocumentBuilder().build()).paths[
        '/orders/{orderId}/complete'
      ],
    ).toBeDefined();
  }, 25000);
});
