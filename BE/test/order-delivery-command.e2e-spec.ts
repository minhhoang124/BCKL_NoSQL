import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Role, type OrderStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { request as nodeRequest } from 'node:http';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { createFaultDdl } from './helpers/qa-fault-ddl.js';

describe('Admin delivery commands — real HTTP/PostgreSQL, two instances', () => {
  let app: INestApplication, other: INestApplication, prisma: PrismaService;
  let admin: { id: number; token: string },
    admin2: { id: number; token: string },
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
  const tracking = { trackingReference: 'SAME-WAYBILL' };
  const failed = (n = 1) => ({
    ...tracking,
    deliveryAttempt: n,
    reasonCode: 'OTHER',
    reasonText: 'No recipient',
  });
  const delivered = (n = 1) => ({ ...tracking, deliveryAttempt: n });
  const post = (
    command = 'ship',
    body: unknown = tracking,
    k = key(),
    instance = app,
    token = admin.token,
    id = orderId,
  ) =>
    request(instance.getHttpServer())
      .post('/admin/orders/' + id + '/' + command)
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
  // Controlled READY_TO_SHIP fixture for isolated delivery cases. The separate
  // integration cases below create COD orders and run the merged Seller APIs.
  async function fixture(status: OrderStatus = 'READY_TO_SHIP') {
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
        payment: { create: { provider: 'COD', amount: '10000.00' } },
        items: {
          create: {
            productId,
            variantId,
            productNameSnapshot: 'Original',
            skuSnapshot: 'Original-SKU',
            optionSnapshot: [],
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
      order: await prisma.order.findUnique({ where: { id } }),
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
  async function checkoutAndPrepare() {
    // Only catalog/address are fixtures. Order, stock ledger and preparation
    // history are created through real HTTP, not SQL state writers.
    const image = await prisma.productImage.findFirst({
      where: { productId, isPrimary: true },
    });
    await prisma.product.update({
      where: { id: productId },
      data: {
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        name: 'Purchased delivery snapshot',
        ...(!image
          ? {
              images: {
                create: {
                  url: '/uploads/delivery-integration-fixture.jpg',
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
      data: { price: '10000.00', stock: 5 },
    });
    const address = await prisma.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: 'Original delivery recipient',
        phone: '0901234567',
        province: 'Province',
        ward: 'Ward',
        addressLine: 'Original delivery address',
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
    orderId = created.body.orders[0].id as number;
    orders.push(orderId);
    const initial = await state();
    expect(initial.order?.status).toBe('PENDING_CONFIRMATION');
    expect(initial.variant?.stock).toBe(3);
    const items = await prisma.orderItem.findMany({ where: { orderId } });
    expect(
      initial.movements.filter((m) =>
        items.some((item) => item.id === m.orderItemId),
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'CHECKOUT_DECREMENT',
        quantityDelta: -2,
        balanceAfter: 3,
      }),
    ]);
    const preparationKeys = [key(), key(), key()];
    const statuses = ['CONFIRMED', 'PACKING', 'READY_TO_SHIP'];
    for (const [index, command] of [
      'confirm',
      'start-packing',
      'ready-to-ship',
    ].entries()) {
      const result = await request((index % 2 ? other : app).getHttpServer())
        .post(`/seller/orders/${orderId}/${command}`)
        .set('Authorization', seller.token)
        .set('Idempotency-Key', preparationKeys[index])
        .send({})
        .expect(200);
      expect(result.body.result.status).toBe(statuses[index]);
    }
    const prepared = await state();
    expect(prepared.history.map((h) => h.toStatus)).toEqual([
      'PENDING_CONFIRMATION',
      ...statuses,
    ]);
    expect(prepared.history.map((h) => h.actorType)).toEqual([
      'BUYER',
      'SELLER',
      'SELLER',
      'SELLER',
    ]);
    for (const field of [
      'product',
      'variant',
      'movements',
      'outbox',
      'payment',
    ] as const)
      expect(prepared[field]).toEqual(initial[field]);
    return { checkoutKey, payload, preparationKeys };
  }
  // Fixture-only DDL channel; the runtime role stays DML-only.
  const ddl = createFaultDdl();
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
    admin2 = await actor('ADMIN');
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
    await ddl.close();
    if (prisma) {
      await prisma.$transaction(async (tx) => {
        await tx.stockMovement.deleteMany({
          where: { orderItem: { orderId: { in: orders } } },
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
    await other?.close();
    await app?.close();
    if (previousRate === undefined)
      delete process.env.ORDER_COMMAND_RATE_PER_MINUTE;
    else process.env.ORDER_COMMAND_RATE_PER_MINUTE = previousRate;
  });
  it('ship → failed → retry → delivered, COD/history/identity commit atomically; no stock/index mutation', async () => {
    const detail = (actor = buyer, instance = app) =>
      request(instance.getHttpServer())
        .get(`${actor === seller ? '/seller' : ''}/orders/${orderId}`)
        .set('Authorization', actor.token);
    const initialDetail = await detail().expect(200);
    await prisma.product.update({
      where: { id: productId },
      data: { name: 'Changed catalog, not Order snapshot' },
    });
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { price: '12000' },
    });
    const before = await state();
    const assertDetail = async (
      status: OrderStatus,
      attempt: number,
      historyCount: number,
      paymentStatus: string,
    ) => {
      for (const actor of [buyer, seller]) {
        const response = await detail(actor).expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body.status).toBe(status);
        expect(response.body.items).toEqual(initialDetail.body.items);
        expect(response.body.shippingAddress).toEqual(
          initialDetail.body.shippingAddress,
        );
        expect(response.body.total).toBe('10000.00');
        expect(response.body.payment).toMatchObject({
          provider: 'COD',
          status: paymentStatus,
          amount: '10000.00',
        });
        expect(response.body.timeline).toHaveLength(historyCount);
        expect(response.body.timeline.at(-1)).toMatchObject({
          toStatus: status,
          actorType: 'ADMIN',
          actorId: actor === buyer ? null : admin.id,
          deliveryAttempt: attempt,
          trackingReference: tracking.trackingReference,
        });
        expect(response.body).not.toHaveProperty('requestHash');
        expect(response.body).not.toHaveProperty('idempotencyKey');
        expect(response.body).not.toHaveProperty('receipt');
      }
    };
    const shipKey = key();
    const ship = await post('ship', tracking, shipKey).expect(200);
    await assertDetail('SHIPPING', 1, 1, 'UNPAID');
    const failure = await post('delivery-failed', failed()).expect(200);
    await assertDetail('DELIVERY_FAILED', 1, 2, 'UNPAID');
    expect(failure.body.result.timeline[0]).toMatchObject({
      reasonCode: 'OTHER',
      reasonText: 'No recipient',
    });
    let current = await state();
    expect(current.payment?.status).toBe('UNPAID');
    expect(current.variant).toEqual(before.variant);
    expect(current.product).toEqual(before.product);
    expect(current.movements).toEqual(before.movements);
    expect(current.outbox).toEqual(before.outbox);
    await post('retry-delivery').expect(200);
    await assertDetail('SHIPPING', 2, 3, 'UNPAID');
    const success = await post('mark-delivered', delivered(2)).expect(200);
    await assertDetail('DELIVERED', 2, 4, 'PAID');
    current = await state();
    expect(current.order).toMatchObject({
      status: 'DELIVERED',
      currentDeliveryAttempt: 2,
      retryCount: 1,
      completedAt: null,
    });
    expect(current.payment).toMatchObject({
      status: 'PAID',
      amount: new Prisma.Decimal('10000.00'),
    });
    expect(current.payment?.paidAt).toEqual(current.order?.deliveredAt);
    expect(current.attempts.map((a) => a.deliveryAttempt)).toEqual([1, 2]);
    expect(current.commands).toHaveLength(4);
    expect(current.history).toHaveLength(4);
    expect(current.commands.every((c) => c.status === 'SUCCEEDED')).toBe(true);
    expect(
      current.history.every(
        (h) =>
          h.actorType === 'ADMIN' &&
          h.actorId === admin.id &&
          h.commandId !== null &&
          h.trackingReference === tracking.trackingReference,
      ),
    ).toBe(true);
    expect(success.body.result.payment.amount).toBe('10000.00');
    expect(current.variant).toEqual(before.variant);
    expect(current.product).toEqual(before.product);
    expect(current.movements).toEqual(before.movements);
    expect(current.outbox).toEqual(before.outbox);
    const replay = await post('ship', tracking, shipKey, other).expect(200);
    expect(replay.body).toEqual({ ...ship.body, replayed: true });
    expect(await state()).toEqual(current);
    expect((await detail(buyer, other).expect(200)).body.status).toBe(
      'DELIVERED',
    );
    expect(JSON.stringify(success.body)).not.toMatch(
      /requestHash|idempotencyKey|Private recipient|Private address/,
    );
  });
  it('allows 4 total attempts / 3 retries, same tracking allowed, retry 4 rejected', async () => {
    await post().expect(200);
    for (let n = 1; n <= 4; n++) {
      await post('delivery-failed', failed(n)).expect(200);
      if (n < 4) await post('retry-delivery').expect(200);
    }
    const before = await state();
    expect((await post('retry-delivery').expect(409)).body.code).toBe(
      'DELIVERY_ATTEMPT_LIMIT',
    );
    expect(await state()).toEqual(before);
    expect(before.attempts).toHaveLength(4);
  });
  it('replay after a later retry uses original receipt; new key old callback is stale', async () => {
    await post().expect(200);
    const k = key(),
      first = await post('delivery-failed', failed(), k).expect(200);
    await post('retry-delivery').expect(200);
    const before = await state();
    const replay = await post('delivery-failed', failed(), k, other).expect(
      200,
    );
    expect(replay.body).toEqual({ ...first.body, replayed: true });
    for (const c of ['delivery-failed', 'mark-delivered'])
      expect(
        (
          await post(
            c,
            c === 'delivery-failed' ? failed() : delivered(),
          ).expect(409)
        ).body.code,
      ).toBe('STALE_DELIVERY_ATTEMPT');
    expect(
      (
        await post('mark-delivered', {
          ...delivered(2),
          trackingReference: 'WRONG',
        }).expect(409)
      ).body.code,
    ).toBe('STALE_DELIVERY_ATTEMPT');
    expect(await state()).toEqual(before);
  });
  it('concurrent same key across two apps creates exactly one attempt/history/receipt', async () => {
    const k = key(),
      result = await Promise.all([
        post('ship', tracking, k),
        post('ship', tracking, k, other),
      ]);
    expect(result.map((r) => r.status)).toEqual([200, 200]);
    expect(result.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    expect(result[0].body.commandId).toBe(result[1].body.commandId);
    const current = await state();
    expect(current.attempts).toHaveLength(1);
    expect(current.history).toHaveLength(1);
    expect(current.commands).toHaveLength(1);
  });
  it('two Admins race delivered vs failed: one transition, payment matches winner', async () => {
    await post().expect(200);
    const result = await Promise.all([
      post('mark-delivered', delivered()),
      post('delivery-failed', failed(), key(), other, admin2.token),
    ]);
    expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = await state();
    expect(current.commands).toHaveLength(2);
    expect(current.history).toHaveLength(2);
    expect(current.attempts).toHaveLength(1);
    expect(current.payment?.status).toBe(
      current.order?.status === 'DELIVERED' ? 'PAID' : 'UNPAID',
    );
  });
  it('concurrent retry advances once, no skipped or duplicate attempt', async () => {
    await post().expect(200);
    await post('delivery-failed', failed()).expect(200);
    const results = await Promise.all([
      post('retry-delivery'),
      post('retry-delivery', tracking, key(), other, admin2.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await state()).attempts.map((a) => a.deliveryAttempt)).toEqual([
      1, 2,
    ]);
  });
  it('same scope/key conflicts across payload/order/command; normalized replay succeeds', async () => {
    const k = key();
    await post('ship', tracking, k).expect(200);
    const before = await state();
    expect(
      (await post('ship', { trackingReference: 'DIFFERENT' }, k).expect(409))
        .body.code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      (await post('mark-delivered', delivered(), k).expect(409)).body.code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    const second = await fixture();
    expect(
      (await post('ship', tracking, k, app, admin.token, second).expect(409))
        .body.code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    await post(
      'ship',
      { trackingReference: ' SAME-WAYBILL ' },
      k,
      other,
    ).expect(200);
    expect(await state()).toEqual(before);
  });
  it('authorization before new command and replay: anonymous/Buyer/Seller/inactive/stale JWT role', async () => {
    await request(app.getHttpServer())
      .post('/admin/orders/' + orderId + '/ship')
      .send(tracking)
      .expect(401);
    for (const token of [buyer.token, seller.token])
      await post('ship', tracking, key(), app, token).expect(403);
    await post('ship', tracking, key(), app, 'Bearer invalid').expect(401);
    const k = key();
    await post('ship', tracking, k).expect(200);
    const before = await state();
    await prisma.user.update({
      where: { id: admin.id },
      data: { isActive: false },
    });
    await post('ship', tracking, k).expect(401);
    await prisma.user.update({
      where: { id: admin.id },
      data: { isActive: true, role: 'USER' },
    });
    await post('ship', tracking, k).expect(403);
    expect(await state()).toEqual(before);
  });
  it('legacy SHIPPING/FAILED without canonical identity fail closed', async () => {
    for (const status of ['SHIPPING', 'DELIVERY_FAILED'] as const) {
      const id = await fixture(status),
        before = await state(id);
      const c = status === 'SHIPPING' ? 'mark-delivered' : 'retry-delivery';
      expect(
        (
          await post(
            c,
            c === 'mark-delivered' ? delivered() : tracking,
            key(),
            app,
            admin.token,
            id,
          ).expect(409)
        ).body.code,
      ).toBe('DELIVERY_STATE_CONFLICT');
      expect(await state(id)).toEqual(before);
    }
  });
  it('Admin can handle already-existing delivery in suspended Store without re-opening sales', async () => {
    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'SUSPENDED' },
    });
    try {
      await post().expect(200);
      await post('mark-delivered', delivered()).expect(200);
    } finally {
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'ACTIVE' },
      });
    }
  });
  it.each([
    { status: 'CANCELLED' as const },
    { status: 'PAID' as const },
    { amount: '9999.00' },
    { provider: 'MOMO' as const, status: 'PENDING' as const },
  ])('rejects incompatible Payment %# without mutation', async (data) => {
    await prisma.payment.update({ where: { orderId }, data });
    const before = await state();
    expect((await post().expect(409)).body.code).toBe('PAYMENT_STATE_CONFLICT');
    expect(await state()).toEqual(before);
  });
  it('missing Payment is not fabricated; prepaid sandbox retains original paidAt', async () => {
    await prisma.payment.delete({ where: { orderId } });
    expect((await post().expect(409)).body.code).toBe('PAYMENT_STATE_CONFLICT');
    const id = await fixture();
    const paidAt = new Date('2026-10-01T00:00:00.000Z');
    await prisma.payment.update({
      where: { orderId: id },
      data: { provider: 'MOMO', status: 'PAID', paidAt },
    });
    await post('ship', tracking, key(), app, admin.token, id).expect(200);
    await post(
      'mark-delivered',
      delivered(),
      key(),
      app,
      admin.token,
      id,
    ).expect(200);
    expect((await state(id)).payment?.paidAt).toEqual(paidAt);
  });
  it('rollback after payment/order/attempt writes and before receipt completion; retry can commit', async () => {
    await post().expect(200);
    const before = await state(),
      k = key();
    await ddl.exec(
      `CREATE FUNCTION delivery_command_test_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'Controlled receipt failure'; END $fn$`,
    );
    try {
      await ddl.exec(
        `CREATE TRIGGER delivery_command_test_failure BEFORE UPDATE ON order_commands FOR EACH ROW WHEN (NEW."orderId" = ${orderId}) EXECUTE FUNCTION delivery_command_test_failure()`,
      );
      await post('mark-delivered', delivered(), k).expect(500);
    } finally {
      await ddl.exec(
        'DROP TRIGGER IF EXISTS delivery_command_test_failure ON order_commands',
      );
      await ddl.exec(
        'DROP FUNCTION delivery_command_test_failure()',
      );
    }
    expect(await state()).toEqual(before);
    await post('mark-delivered', delivered(), k).expect(200);
  });
  it('validates ID/query/body/key/content type and inflated size before mutation', async () => {
    const before = await state();
    await request(app.getHttpServer())
      .post('/admin/orders/01/ship')
      .set('Authorization', admin.token)
      .set('Idempotency-Key', key())
      .send(tracking)
      .expect(400);
    await request(app.getHttpServer())
      .post('/admin/orders/' + orderId + '/ship?actorId=1')
      .set('Authorization', admin.token)
      .set('Idempotency-Key', key())
      .send(tracking)
      .expect(400);
    await post('ship', { ...tracking, status: 'SHIPPING' }).expect(400);
    await post('ship', tracking, 'short').expect(400);
    await request(app.getHttpServer())
      .post('/admin/orders/' + orderId + '/ship')
      .set('Authorization', admin.token)
      .send(tracking)
      .expect(400);
    await request(app.getHttpServer())
      .post('/admin/orders/' + orderId + '/ship')
      .set('Authorization', admin.token)
      .set('Idempotency-Key', key())
      .set('Content-Type', 'text/plain')
      .send('bad')
      .expect(400);
    await request(app.getHttpServer())
      .post('/admin/orders/' + orderId + '/ship')
      .set('Authorization', admin.token)
      .set('Idempotency-Key', key())
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    const compressed = gzipSync(
      JSON.stringify({ trackingReference: 'x'.repeat(9000) }),
    );
    const base = await app.getUrl();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = nodeRequest(
        new URL('/admin/orders/' + orderId + '/ship', base),
        {
          method: 'POST',
          headers: {
            Authorization: admin.token,
            'Idempotency-Key': key(),
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
            'Content-Length': compressed.length,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.setTimeout(3000, () =>
        req.destroy(new Error('Test request timeout')),
      );
      req.on('error', reject);
      req.end(compressed);
    });
    expect(status).toBe(413);
    expect(await state()).toEqual(before);
  });
  it('replay survives application restart and delivered receipt stays original', async () => {
    await post().expect(200);
    const k = key(),
      original = await post('mark-delivered', delivered(), k).expect(200);
    const before = await state();
    const restarted = await start();
    try {
      const replay = await post(
        'mark-delivered',
        delivered(),
        k,
        restarted,
      ).expect(200);
      expect(replay.body).toEqual({ ...original.body, replayed: true });
      expect(await state()).toEqual(before);
    } finally {
      await restarted.close();
    }
  });
  it('finalize failure during ship rolls back new attempt/counter/history/claim', async () => {
    const before = await state(),
      k = key();
    await ddl.exec(
      `CREATE FUNCTION delivery_command_test_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'Controlled receipt failure'; END $fn$`,
    );
    try {
      await ddl.exec(
        `CREATE TRIGGER delivery_command_test_failure BEFORE UPDATE ON order_commands FOR EACH ROW WHEN (NEW."orderId" = ${orderId}) EXECUTE FUNCTION delivery_command_test_failure()`,
      );
      await post('ship', tracking, k).expect(500);
    } finally {
      await ddl.exec(
        'DROP TRIGGER IF EXISTS delivery_command_test_failure ON order_commands',
      );
      await ddl.exec(
        'DROP FUNCTION delivery_command_test_failure()',
      );
    }
    expect(await state()).toEqual(before);
    await post('ship', tracking, k).expect(200);
  });
  it('retry-delivery finalize failure rolls back attempt/counter/history/claim; same key retries exactly once', async () => {
    await post().expect(200);
    await post('delivery-failed', failed()).expect(200);
    const before = await state();
    const k = key();
    await ddl.exec(
      `CREATE FUNCTION delivery_retry_test_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'Controlled retry receipt failure'; END $fn$`,
    );
    try {
      await ddl.exec(
        `CREATE TRIGGER delivery_retry_test_failure BEFORE UPDATE ON order_commands FOR EACH ROW WHEN (NEW."orderId" = ${orderId} AND NEW.command = 'retry-delivery') EXECUTE FUNCTION delivery_retry_test_failure()`,
      );
      await post('retry-delivery', tracking, k).expect(500);
    } finally {
      await ddl.exec(
        'DROP TRIGGER IF EXISTS delivery_retry_test_failure ON order_commands',
      );
      await ddl.exec(
        'DROP FUNCTION delivery_retry_test_failure()',
      );
    }
    expect(await state()).toEqual(before);
    const committed = await post('retry-delivery', tracking, k, other).expect(
      200,
    );
    const after = await state();
    expect(after.order).toMatchObject({
      status: 'SHIPPING',
      currentDeliveryAttempt: 2,
      retryCount: 1,
    });
    expect(after.attempts.map((value) => value.deliveryAttempt)).toEqual([
      1, 2,
    ]);
    expect(after.commands).toHaveLength(before.commands.length + 1);
    expect(after.history).toHaveLength(before.history.length + 1);
    for (const field of [
      'payment',
      'product',
      'variant',
      'movements',
      'outbox',
    ] as const)
      expect(after[field]).toEqual(before[field]);
    const replay = await post('retry-delivery', tracking, k).expect(200);
    expect(replay.body).toEqual({ ...committed.body, replayed: true });
    expect(await state()).toEqual(after);
  });
  it('bounded DB lock wait returns retry-after rather than hanging or partial commit', async () => {
    const before = await state();
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((r) => {
        locked = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const blocker = other.get(PrismaService).$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${admin.id} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 7000 },
    );
    await ready;
    try {
      const response = await post().expect(409);
      expect(response.body.code).toBe('ORDER_COMMAND_IN_PROGRESS');
      expect(response.headers['retry-after']).toBe('1');
    } finally {
      release();
      await blocker;
    }
    expect(await state()).toEqual(before);
  });
  it('real COD checkout → Seller preparation → failed/retry/delivered keeps snapshots, stock and old receipts', async () => {
    const { checkoutKey, payload, preparationKeys } =
      await checkoutAndPrepare();
    const initial = await state();
    const detail = (actor = buyer, instance = app) =>
      request(instance.getHttpServer())
        .get(`${actor === seller ? '/seller' : ''}/orders/${orderId}`)
        .set('Authorization', actor.token);
    const original = (await detail().expect(200)).body;
    await prisma.userAddress.update({
      where: { id: payload.addressId },
      data: { recipientName: 'Changed after checkout' },
    });
    await prisma.product.update({
      where: { id: productId },
      data: { name: 'Changed catalog after checkout' },
    });
    const baseline = await state();
    const shipKey = key();
    const ship = await post('ship', tracking, shipKey, other).expect(200);
    await post('delivery-failed', failed()).expect(200);
    await post('retry-delivery', tracking, key(), other).expect(200);
    const beforeStale = await state();
    for (const command of ['delivery-failed', 'mark-delivered']) {
      const response = await post(
        command,
        command === 'delivery-failed' ? failed(1) : delivered(1),
      ).expect(409);
      expect(response.body.code).toBe('STALE_DELIVERY_ATTEMPT');
    }
    expect(await state()).toEqual(beforeStale);
    const successKey = key();
    const success = await post(
      'mark-delivered',
      delivered(2),
      successKey,
    ).expect(200);
    const after = await state();
    expect(after.order).toMatchObject({
      status: 'DELIVERED',
      currentDeliveryAttempt: 2,
      retryCount: 1,
      completedAt: null,
    });
    expect(after.order?.deliveredAt).toBeInstanceOf(Date);
    expect(after.payment).toMatchObject({
      status: 'PAID',
      paidAt: after.order!.deliveredAt,
    });
    expect(after.history.map((h) => h.toStatus)).toEqual([
      'PENDING_CONFIRMATION',
      'CONFIRMED',
      'PACKING',
      'READY_TO_SHIP',
      'SHIPPING',
      'DELIVERY_FAILED',
      'SHIPPING',
      'DELIVERED',
    ]);
    expect(after.commands).toHaveLength(7);
    expect(after.attempts.map((a) => a.deliveryAttempt)).toEqual([1, 2]);
    for (const field of ['product', 'variant', 'movements', 'outbox'] as const)
      expect(after[field]).toEqual(baseline[field]);
    for (const actor of [buyer, seller]) {
      const current = (await detail(actor, other).expect(200)).body;
      expect(current.status).toBe('DELIVERED');
      expect(current.items).toEqual(original.items);
      expect(current.shippingAddress).toEqual(original.shippingAddress);
      expect(current.total).toBe('20000.00');
      expect(
        current.timeline
          .slice(4)
          .every(
            (h: { actorId: number | null }) =>
              h.actorId === (actor === buyer ? null : admin.id),
          ),
      ).toBe(true);
      expect(
        current.timeline
          .slice(1, 4)
          .every(
            (h: { actorId: number | null }) =>
              h.actorId === (actor === buyer ? null : seller.id),
          ),
      ).toBe(true);
      for (const field of [
        'requestHash',
        'idempotencyKey',
        'receiptJson',
        'commands',
      ])
        expect(current).not.toHaveProperty(field);
    }
    // Simulate a lost response by deliberately disregarding the successful result
    // and replaying the same request on the other application (not a proxy test).
    expect(
      (
        await post('mark-delivered', delivered(2), successKey, other).expect(
          200,
        )
      ).body,
    ).toEqual({ ...success.body, replayed: true });
    expect((await post('ship', tracking, shipKey).expect(200)).body).toEqual({
      ...ship.body,
      replayed: true,
    });
    const replayPreparation = await request(other.getHttpServer())
      .post(`/seller/orders/${orderId}/confirm`)
      .set('Authorization', seller.token)
      .set('Idempotency-Key', preparationKeys[0])
      .send({})
      .expect(200);
    expect(replayPreparation.body).toMatchObject({
      replayed: true,
      result: { status: 'CONFIRMED' },
    });
    const checkoutReplay = await request(other.getHttpServer())
      .post('/checkouts')
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', checkoutKey)
      .send(payload)
      .expect(200);
    expect(checkoutReplay.body.orders[0]).toMatchObject({
      id: orderId,
      status: 'PENDING_CONFIRMATION',
    });
    expect(await state()).toEqual(after);
    expect((await detail().expect(200)).body.status).toBe('DELIVERED');
    expect(
      initial.outbox.some(
        (event) =>
          event.version === initial.product?.version &&
          event.operation === 'UPSERT',
      ),
    ).toBe(true);
  });
  it('real prepared COD rejects cancellation while Admin ships, without restoring stock or creating an extra event', async () => {
    await checkoutAndPrepare();
    const before = await state();
    const results = await Promise.all([
      post('ship', tracking, key(), other),
      request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/cancel`)
        .set('Authorization', seller.token)
        .set('Idempotency-Key', key())
        .send({
          reasonCode: 'CANNOT_FULFIL',
          reasonText: 'Too late to cancel',
        }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 409]);
    expect(results[1].body.code).toBe('ORDER_CANNOT_CANCEL');
    const after = await state();
    expect(after.order?.status).toBe('SHIPPING');
    expect(after.commands).toHaveLength(before.commands.length + 1);
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.attempts).toHaveLength(1);
    for (const field of [
      'product',
      'variant',
      'movements',
      'outbox',
      'payment',
    ] as const)
      expect(after[field]).toEqual(before[field]);
  });
  it('Swagger exposes four simulation commands plus merged detail/preparation/cancellation, not completion', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    for (const c of [
      'ship',
      'retry-delivery',
      'delivery-failed',
      'mark-delivered',
    ])
      expect(
        doc.paths['/admin/orders/{orderId}/' + c]?.post?.security,
      ).toBeDefined();
    expect(doc.paths['/admin/orders/{orderId}/complete']).toBeUndefined();
    expect(doc.paths['/orders/{orderId}']?.get).toBeDefined();
    expect(doc.paths['/seller/orders/{orderId}']?.get).toBeDefined();
    for (const command of [
      'confirm',
      'start-packing',
      'ready-to-ship',
      'cancel',
    ])
      expect(
        doc.paths[`/seller/orders/{orderId}/${command}`]?.post,
      ).toBeDefined();
    expect(doc.paths['/orders/{orderId}/cancel']?.post).toBeDefined();
  });
});
