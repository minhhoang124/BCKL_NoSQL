import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Role } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { CheckoutCreateService } from '../src/checkout/checkout-create.service.js';
import { SellerOrderCommandService } from '../src/order/seller-order-command.service.js';
import { OrderCancellationService } from '../src/order/order-cancellation.service.js';
import { OrderDeliveryService } from '../src/order/order-delivery.service.js';
import { OrderCompletionService } from '../src/order/order-completion.service.js';
import { OrderCommandResolutionService } from '../src/order/order-command-resolution.service.js';
import { SellerCloseResolutionService } from '../src/order/seller-close-resolution.service.js';
import { BuyerCommandResolutionService } from '../src/order/buyer-command-resolution.service.js';
import { prepareOrderCommand } from '../src/order/order-command-request.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';
import { isFinalDayQaTarget } from './helpers/final-day-qa-target.js';

// Timing oracle only: spy pauses AFTER real JWT/role guards but forwards every
// original argument into the real business service. No business mutation mock,
// DDL, deletes, providers, dotenv or demo connection. Keep fixtures for evidence.
describe('Auth write epoch — CV revoked between guard and real transaction', () => {
  let app: INestApplication, db: PrismaService;
  const marker = 'write-epoch-' + randomUUID();
  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    const target = new URL(process.env.DATABASE_URL!);
    const canonicalCi =
      process.env.GITHUB_ACTIONS === 'true' &&
      ['localhost', '127.0.0.1'].includes(target.hostname) &&
      target.port === '5432' &&
      target.pathname === '/klcn_ecommerce';
    if (!isFinalDayQaTarget(target) && !canonicalCi)
      throw new Error(
        'Auth write epoch requires explicit final-day QA or canonical isolated CI',
      );
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  async function actor(role: Role) {
    const row = await db.user.create({
      data: {
        email: 'we-' + randomUUID() + '@example.test',
        role,
        passwordHash: 'NOT_A_LOGIN_FIXTURE',
        emailVerifiedAt: new Date(),
      },
    });
    const config = app.get(ConfigService);
    const token = app.get(JwtService).sign(
      {
        sub: row.id,
        email: row.email,
        role,
        type: 'access',
        cv: row.credentialVersion,
      },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { ...row, token };
  }
  async function fixture() {
    const buyer = await actor('USER'),
      seller = await actor('SELLER');
    const store = await db.store.create({
      data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
    });
    const category = await db.category.create({
      data: { name: 'Write epoch fixture', slug: randomUUID() },
    });
    const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: 'Synthetic write epoch SKU',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: { url: '/uploads/write-epoch-qa.jpg', isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        storeId: store.id,
        skuCode: randomUUID(),
        optionSignature: 'default',
        price: '10000.00',
        stock: 5,
      },
    });
    const address = await db.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: 'Synthetic epoch Buyer',
        phone: '0901234567',
        province: 'QA',
        ward: 'QA',
        addressLine: 'Synthetic QA address',
        isDefault: false,
      },
    });
    const cart = await db.cart.create({
      data: {
        userId: buyer.id,
        items: { create: { variantId: variant.id, quantity: 2 } },
      },
    });
    const body = {
      addressId: address.id,
      paymentProvider: 'COD',
      items: [
        { variantId: variant.id, quantity: 2, expectedUnitPrice: '10000.00' },
      ],
    };
    return { buyer, seller, store, product, variant, cart, body };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const checkout = (f: Fixture) =>
    request(app.getHttpServer())
      .post('/checkouts')
      .set('Authorization', 'Bearer ' + f.buyer.token)
      .set('Idempotency-Key', randomUUID())
      .send(f.body);
  async function orderFromCheckout(f: Fixture) {
    const created = await checkout(f).expect(201);
    const id = created.body.orders[0].id as number;
    expect(Number.isInteger(id) && id > 0).toBe(true);
    return id;
  }
  async function readyToShip(f: Fixture, orderId: number) {
    for (const command of ['confirm', 'start-packing', 'ready-to-ship']) {
      await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/${command}`)
        .set('Authorization', 'Bearer ' + f.seller.token)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(200);
    }
  }
  async function snapshot(f: Fixture) {
    const [
      checkouts,
      orders,
      items,
      payments,
      movements,
      outbox,
      commands,
      resolutions,
      history,
      product,
      variant,
      cartItems,
    ] = await Promise.all([
      db.checkout.findMany({
        where: { buyerId: f.buyer.id },
        orderBy: { id: 'asc' },
      }),
      db.order.findMany({
        where: { buyerId: f.buyer.id },
        orderBy: { id: 'asc' },
      }),
      db.orderItem.findMany({
        where: { order: { buyerId: f.buyer.id } },
        orderBy: { id: 'asc' },
      }),
      db.payment.findMany({
        where: { order: { buyerId: f.buyer.id } },
        orderBy: { id: 'asc' },
      }),
      db.stockMovement.findMany({
        where: { variantId: f.variant.id },
        orderBy: { id: 'asc' },
      }),
      db.searchOutbox.findMany({
        where: { productId: f.product.id },
        orderBy: { id: 'asc' },
      }),
      db.orderCommand.findMany({
        where: { order: { buyerId: f.buyer.id } },
        orderBy: { id: 'asc' },
      }),
      db.orderCommandResolution.findMany({
        where: { order: { buyerId: f.buyer.id } },
        orderBy: { id: 'asc' },
      }),
      db.orderStatusHistory.findMany({
        where: { order: { buyerId: f.buyer.id } },
        orderBy: { id: 'asc' },
      }),
      db.product.findUniqueOrThrow({ where: { id: f.product.id } }),
      db.productVariant.findUniqueOrThrow({ where: { id: f.variant.id } }),
      db.cartItem.findMany({
        where: { cartId: f.cart.id },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      checkouts,
      orders,
      items,
      payments,
      movements,
      outbox,
      commands,
      resolutions,
      history,
      product,
      variant,
      cartItems,
    };
  }
  function barrier<T extends (...args: never[]) => Promise<unknown>>(
    original: T,
  ) {
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      call: async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
        entered = true;
        await gate;
        return (await original(...args)) as Awaited<ReturnType<T>>;
      },
      wait: () =>
        vi.waitFor(() => expect(entered).toBe(true), {
          timeout: 5000,
          interval: 10,
        }),
      release: () => release(),
    };
  }
  async function revokeAfterGuard(
    actorId: number,
    held: { wait: () => Promise<unknown>; release: () => void },
  ) {
    try {
      await held.wait();
      // Actual committed PostgreSQL write, not a mocked auth lookup. Only the
      // epoch changes; active/role/ownership remain valid to isolate this race.
      const changed = await db.user.update({
        where: { id: actorId },
        data: { credentialVersion: { increment: 1 } },
      });
      expect(changed.credentialVersion).toBe(2);
    } finally {
      held.release();
    }
  }

  it('Checkout refuses an old epoch after real guard acceptance without checkout/payment/stock/outbox changes', async () => {
    const f = await fixture(),
      before = await snapshot(f);
    const service = app.get(CheckoutCreateService),
      held = barrier(service.create.bind(service));
    vi.spyOn(service, 'create').mockImplementation(held.call);
    const pending = checkout(f).then((result) => result);
    await revokeAfterGuard(f.buyer.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('Seller confirm refuses an old epoch after guard acceptance without command/history/financial changes', async () => {
    const f = await fixture();
    const created = await checkout(f).expect(201),
      orderId = created.body.orders[0].id as number;
    const before = await snapshot(f),
      service = app.get(SellerOrderCommandService),
      held = barrier(service.execute.bind(service));
    vi.spyOn(service, 'execute').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/confirm`)
      .set('Authorization', 'Bearer ' + f.seller.token)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .then((result) => result);
    await revokeAfterGuard(f.seller.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('Seller cancel refuses an old epoch after guard acceptance without restoring stock or changing payment', async () => {
    const f = await fixture();
    const created = await checkout(f).expect(201),
      orderId = created.body.orders[0].id as number;
    const before = await snapshot(f),
      service = app.get(OrderCancellationService),
      held = barrier(service.cancel.bind(service));
    vi.spyOn(service, 'cancel').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/cancel`)
      .set('Authorization', 'Bearer ' + f.seller.token)
      .set('Idempotency-Key', randomUUID())
      .send({
        reasonCode: 'OTHER',
        reasonText: 'Synthetic post-guard epoch test',
      })
      .then((result) => result);
    await revokeAfterGuard(f.seller.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('Buyer cancel refuses a revoked epoch after guard acceptance without restoring stock or changing payment', async () => {
    const f = await fixture(),
      orderId = await orderFromCheckout(f);
    const before = await snapshot(f),
      service = app.get(OrderCancellationService),
      held = barrier(service.cancel.bind(service));
    vi.spyOn(service, 'cancel').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', 'Bearer ' + f.buyer.token)
      .set('Idempotency-Key', randomUUID())
      .send({
        reasonCode: 'OTHER',
        reasonText: 'Synthetic Buyer post-guard epoch test',
      })
      .then((result) => result);
    await revokeAfterGuard(f.buyer.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('Admin ship refuses a revoked epoch after guard acceptance without delivery/payment/history mutation', async () => {
    const f = await fixture(),
      orderId = await orderFromCheckout(f),
      admin = await actor('ADMIN');
    await readyToShip(f, orderId);
    const before = await snapshot(f),
      service = app.get(OrderDeliveryService),
      held = barrier(service.execute.bind(service));
    vi.spyOn(service, 'execute').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/admin/orders/${orderId}/ship`)
      .set('Authorization', 'Bearer ' + admin.token)
      .set('Idempotency-Key', randomUUID())
      .send({ trackingReference: 'EPOCH-SHIP-' + randomUUID() })
      .then((result) => result);
    await revokeAfterGuard(admin.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('Seller preparation resolver refuses a revoked epoch before creating a no-execution fence', async () => {
    const f = await fixture(),
      orderId = await orderFromCheckout(f);
    const before = await snapshot(f),
      service = app.get(OrderCommandResolutionService),
      held = barrier(service.resolve.bind(service));
    vi.spyOn(service, 'resolve').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/resolve-command`)
      .set('Authorization', 'Bearer ' + f.seller.token)
      .set('Idempotency-Key', randomUUID())
      .send({ command: 'confirm' })
      .then((result) => result);
    await revokeAfterGuard(f.seller.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('Seller close resolver refuses a revoked epoch before receipt lookup or no-execution fence', async () => {
    const f = await fixture(),
      orderId = await orderFromCheckout(f),
      key = randomUUID();
    const original = prepareOrderCommand({
      actorId: f.seller.id,
      actorType: 'SELLER',
      orderId,
      command: 'cancel',
      idempotencyKey: key,
      body: { reasonCode: 'OTHER', reasonText: 'Synthetic old lost body' },
    });
    const before = await snapshot(f),
      service = app.get(SellerCloseResolutionService),
      held = barrier(service.resolve.bind(service));
    vi.spyOn(service, 'resolve').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/resolve-close-command`)
      .set('Authorization', 'Bearer ' + f.seller.token)
      .set('Idempotency-Key', key)
      .send({
        command: 'cancel',
        hashVersion: 1,
        requestHash: original.requestHash,
      })
      .then((result) => result);
    await revokeAfterGuard(f.seller.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('Buyer resolver refuses a revoked epoch before creating a no-execution fence', async () => {
    const f = await fixture(),
      orderId = await orderFromCheckout(f),
      key = randomUUID();
    const original = prepareOrderCommand({
      actorId: f.buyer.id,
      actorType: 'BUYER',
      orderId,
      command: 'cancel',
      idempotencyKey: key,
      body: {
        reasonCode: 'OTHER',
        reasonText: 'Synthetic Buyer old lost body',
      },
    });
    const before = await snapshot(f),
      service = app.get(BuyerCommandResolutionService),
      held = barrier(service.resolve.bind(service));
    vi.spyOn(service, 'resolve').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/orders/${orderId}/resolve-command`)
      .set('Authorization', 'Bearer ' + f.buyer.token)
      .set('Idempotency-Key', key)
      .send({
        command: 'cancel',
        hashVersion: 1,
        requestHash: original.requestHash,
      })
      .then((result) => result);
    await revokeAfterGuard(f.buyer.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('an existing Seller receipt cannot bypass an epoch revoked after this replay passed its guard', async () => {
    const f = await fixture(),
      orderId = await orderFromCheckout(f),
      key = randomUUID();
    await request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/confirm`)
      .set('Authorization', 'Bearer ' + f.seller.token)
      .set('Idempotency-Key', key)
      .send({})
      .expect(200);
    const before = await snapshot(f),
      service = app.get(SellerOrderCommandService),
      held = barrier(service.execute.bind(service));
    vi.spyOn(service, 'execute').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/confirm`)
      .set('Authorization', 'Bearer ' + f.seller.token)
      .set('Idempotency-Key', key)
      .send({})
      .then((result) => result);
    await revokeAfterGuard(f.seller.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });

  it('Buyer completion refuses an epoch revoked after guard acceptance without completing the delivered COD order', async () => {
    const f = await fixture(),
      orderId = await orderFromCheckout(f),
      admin = await actor('ADMIN');
    await readyToShip(f, orderId);
    const trackingReference = 'EPOCH-DELIVERED-' + randomUUID();
    await request(app.getHttpServer())
      .post(`/admin/orders/${orderId}/ship`)
      .set('Authorization', 'Bearer ' + admin.token)
      .set('Idempotency-Key', randomUUID())
      .send({ trackingReference })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/admin/orders/${orderId}/mark-delivered`)
      .set('Authorization', 'Bearer ' + admin.token)
      .set('Idempotency-Key', randomUUID())
      .send({ trackingReference, deliveryAttempt: 1 })
      .expect(200);
    const before = await snapshot(f),
      service = app.get(OrderCompletionService),
      held = barrier(service.completeBuyer.bind(service));
    vi.spyOn(service, 'completeBuyer').mockImplementation(held.call);
    const pending = request(app.getHttpServer())
      .post(`/orders/${orderId}/complete`)
      .set('Authorization', 'Bearer ' + f.buyer.token)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .then((result) => result);
    await revokeAfterGuard(f.buyer.id, held);
    const response = await pending,
      after = await snapshot(f);
    expect.soft(response.status).toBe(401);
    expect(after).toEqual(before);
  });
});
