import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { SearchOutboxService } from '../src/search/search-outbox.service.js';
import { CheckoutCreateRate } from '../src/checkout/checkout-create-rate.js';
import { CheckoutCreateService } from '../src/checkout/checkout-create.service.js';
import type { CheckoutRequestInput } from '../src/checkout/checkout-request.js';
import * as receiptModule from '../src/checkout/checkout-receipt.js';

describe('COD create HTTP + real PostgreSQL transactions (two app instances)', () => {
  let app: INestApplication;
  let otherApp: INestApplication;
  let prisma: PrismaService;
  let otherPrisma: PrismaService;
  let buyerId: number;
  let token: string;
  let sellerId: number;
  let sellerToken: string;
  let storeId: number;
  let categoryId: number;
  let cartId: number;
  let productId: number;
  let input: CheckoutRequestInput;
  let sequence = 0;
  const marker = `checkout-create-${Date.now()}`;
  const key = 'cod_create_key_0123456789';
  const post = (
    body: unknown = input,
    headerKey = key,
    bearer = token,
    instance = app,
  ) =>
    request(instance.getHttpServer())
      .post('/checkouts')
      .set('Authorization', bearer)
      .set('Idempotency-Key', headerKey)
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
  async function user(role: Role = Role.USER) {
    const actor = await prisma.user.create({
      data: {
        email: `${marker}-${sequence++}@example.com`,
        passwordHash: 'fixture-no-login',
        role,
      },
    });
    const config = app.get(ConfigService);
    const jwt = app.get(JwtService).sign(
      { sub: actor.id, email: actor.email, role, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { ...actor, token: `Bearer ${jwt}` };
  }
  async function buyer() {
    const actor = await user();
    const address = await prisma.userAddress.create({
      data: {
        userId: actor.id,
        recipientName: 'Buyer fixture',
        phone: '0901234567',
        province: 'Province',
        ward: 'Ward',
        addressLine: 'Snapshot address',
        deliveryNote: 'Original note',
        isDefault: true,
      },
    });
    const cart = await prisma.cart.create({ data: { userId: actor.id } });
    return { ...actor, addressId: address.id, cartId: cart.id };
  }
  async function variant(
    store = storeId,
    price = '10000.00',
    stock = 5,
    sameProduct?: number,
  ) {
    const product = sameProduct
      ? await prisma.product.findUniqueOrThrow({ where: { id: sameProduct } })
      : await prisma.product.create({
          data: {
            storeId: store,
            categoryId,
            name: 'COD public sample',
            sellerStatus: 'ACTIVE',
            moderationStatus: 'APPROVED',
            images: {
              create: { url: '/uploads/checkout-fixture.jpg', isPrimary: true },
            },
            shippingProfile: { create: { packageWeightGrams: 100 } },
          },
        });
    const v = await prisma.productVariant.create({
      data: {
        productId: product.id,
        storeId: store,
        skuCode: `${marker}-${sequence++}`,
        price,
        stock,
        optionSignature: `fixture-${sequence}`,
      },
    });
    return { product, variant: v };
  }
  async function add(v: number, quantity = 1, cart = cartId) {
    await prisma.cartItem.create({
      data: { cartId: cart, variantId: v, quantity },
    });
  }
  beforeAll(async () => {
    app = await start();
    otherApp = await start();
    prisma = app.get(PrismaService);
    otherPrisma = otherApp.get(PrismaService);
    const sellerActor = await user(Role.SELLER);
    sellerId = sellerActor.id;
    sellerToken = sellerActor.token;
    storeId = (
      await prisma.store.create({
        data: { sellerId, name: `${marker}-store`, status: 'ACTIVE' },
      })
    ).id;
    categoryId = (
      await prisma.category.create({ data: { name: 'COD leaf', slug: marker } })
    ).id;
  });
  beforeEach(async () => {
    const actor = await buyer();
    buyerId = actor.id;
    token = actor.token;
    cartId = actor.cartId;
    const v = await variant();
    productId = v.product.id;
    await add(v.variant.id, 2);
    input = {
      addressId: actor.addressId,
      paymentProvider: 'COD',
      items: [
        { variantId: v.variant.id, quantity: 2, expectedUnitPrice: '10000' },
      ],
    };
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) {
      const owned = { buyer: { email: { startsWith: marker } } };
      await prisma.stockMovement.deleteMany({
        where: { variant: { skuCode: { startsWith: marker } } },
      });
      await prisma.orderStatusHistory.deleteMany({ where: { order: owned } });
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
      await prisma.category.deleteMany({ where: { slug: marker } });
      await prisma.user.deleteMany({
        where: { email: { startsWith: marker } },
      });
    }
    if (otherApp) await otherApp.close();
    if (app) await app.close();
  });
  async function state() {
    return {
      product: await prisma.product.findUnique({ where: { id: productId } }),
      variants: await prisma.productVariant.findMany({
        where: { skuCode: { startsWith: marker } },
        orderBy: { id: 'asc' },
      }),
      cart: await prisma.cartItem.findMany({
        where: { cartId },
        orderBy: { id: 'asc' },
      }),
      checkouts: await prisma.checkout.count({ where: { buyerId } }),
      orders: await prisma.order.count({ where: { buyerId } }),
      items: await prisma.orderItem.count({ where: { order: { buyerId } } }),
      payments: await prisma.payment.count({ where: { order: { buyerId } } }),
      history: await prisma.orderStatusHistory.count({
        where: { order: { buyerId } },
      }),
      movements: await prisma.stockMovement.count({
        where: { variant: { productId } },
      }),
      outbox: await prisma.searchOutbox.findMany({
        where: { productId },
        orderBy: { id: 'asc' },
      }),
    };
  }
  it('requires canonical verified email for a new checkout and rolls back all business state', async () => {
    const old = process.env.AUTH_EMAIL_ENABLED;
    process.env.AUTH_EMAIL_ENABLED = 'true';
    try {
      const before = await state();
      const rejected = await post().expect(412);
      expect(rejected.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
      expect(rejected.headers['cache-control']).toBe('no-store');
      expect(await state()).toEqual(before);
      await prisma.user.update({
        where: { id: buyerId },
        data: { emailVerifiedAt: new Date() },
      });
      await post().expect(201);
      expect(await prisma.order.count({ where: { buyerId } })).toBe(1);
    } finally {
      if (old === undefined) delete process.env.AUTH_EMAIL_ENABLED;
      else process.env.AUTH_EMAIL_ENABLED = old;
    }
  });
  it('replays a committed checkout when verification is enabled later, without reserving stock again', async () => {
    const old = process.env.AUTH_EMAIL_ENABLED;
    process.env.AUTH_EMAIL_ENABLED = 'false';
    try {
      const first = await post().expect(201);
      const before = await state();
      process.env.AUTH_EMAIL_ENABLED = 'true';
      const replay = await post().expect(200);
      expect(replay.body.checkoutId).toBe(first.body.checkoutId);
      expect(replay.body.replayed).toBe(true);
      expect(await state()).toEqual(before);
    } finally {
      if (old === undefined) delete process.env.AUTH_EMAIL_ENABLED;
      else process.env.AUTH_EMAIL_ENABLED = old;
    }
  });
  it('integrates Cart/preview/create COD with Buyer and Seller lists without read mutations', async () => {
    const cart = await request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', token)
      .expect(200);
    expect(cart.body.totalQuantity).toBe(2);
    const preview = await request(app.getHttpServer())
      .post('/checkout/preview')
      .set('Authorization', token)
      .send(input)
      .expect(200);
    expect(preview.body.canCheckout).toBe(true);
    const created = await post().expect(201);
    const committed = await state();
    const order = created.body.orders[0];
    for (const [path, bearer, instance] of [
      ['/orders', token, app],
      ['/seller/orders', sellerToken, otherApp],
    ] as const) {
      const listed = await request(instance.getHttpServer())
        .get(path)
        .set('Authorization', bearer)
        .expect(200);
      expect(listed.headers['cache-control']).toBe('no-store');
      const row = listed.body.items.find(
        (item: { id: number }) => item.id === order.id,
      );
      expect(row).toMatchObject({
        id: order.id,
        orderNumber: order.orderNumber,
        status: 'PENDING_CONFIRMATION',
        store: { id: storeId, name: `${marker}-store` },
        total: '20000.00',
        payment: {
          provider: 'COD',
          status: 'UNPAID',
          amount: '20000.00',
          currency: 'VND',
          paidAt: null,
        },
      });
      expect(JSON.stringify(listed.body)).not.toMatch(
        /Snapshot address|0901234567|idempotencyKey|requestHash|buyerId|checkoutId/,
      );
    }
    expect(await state()).toEqual(committed);
    await post(input, key, token, otherApp).expect(200);
    expect(await state()).toEqual(committed);
  });

  it('a multi-Store COD checkout is visible only to its Buyer and each owning Seller', async () => {
    const secondSeller = await user(Role.SELLER);
    const secondStore = await prisma.store.create({
      data: {
        sellerId: secondSeller.id,
        name: `${marker}-second-store`,
        status: 'ACTIVE',
      },
    });
    const secondVariant = await variant(secondStore.id, '25000.00', 3);
    await add(secondVariant.variant.id);
    const multi = {
      ...input,
      items: [
        ...input.items,
        {
          variantId: secondVariant.variant.id,
          quantity: 1,
          expectedUnitPrice: '25000.00',
        },
      ],
    };
    const created = await post(multi).expect(201);
    expect(created.body.orders).toHaveLength(2);
    const committed = await state();
    const buyerList = await request(otherApp.getHttpServer())
      .get('/orders')
      .set('Authorization', token)
      .expect(200);
    expect(
      buyerList.body.items
        .map((item: { id: number }) => item.id)
        .sort((a: number, b: number) => a - b),
    ).toEqual(
      created.body.orders
        .map((item: { id: number }) => item.id)
        .sort((a: number, b: number) => a - b),
    );
    const sellerList = await request(app.getHttpServer())
      .get('/seller/orders')
      .set('Authorization', sellerToken)
      .expect(200);
    expect(
      sellerList.body.items.some(
        (item: { store: { id: number } }) => item.store.id === secondStore.id,
      ),
    ).toBe(false);
    expect(
      sellerList.body.items.some(
        (item: { id: number }) =>
          item.id ===
          created.body.orders.find(
            (item: { storeId: number }) => item.storeId === storeId,
          ).id,
      ),
    ).toBe(true);
    const secondList = await request(otherApp.getHttpServer())
      .get('/seller/orders')
      .set('Authorization', secondSeller.token)
      .expect(200);
    expect(secondList.body.items).toHaveLength(1);
    expect(secondList.body.items[0]).toMatchObject({
      store: { id: secondStore.id },
      total: '25000.00',
    });
    const stranger = await user();
    const strangerList = await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', stranger.token)
      .expect(200);
    expect(strangerList.body).toEqual({ items: [], nextCursor: null });
    expect(await state()).toEqual(committed);
  });

  it('creates COD snapshots, ledger/history/receipt/outbox and removes only selected cart lines', async () => {
    const unselected = await variant();
    await add(unselected.variant.id);
    const before = await state();
    const result = await post().expect(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(Object.keys(result.body).sort()).toEqual([
      'checkoutId',
      'orders',
      'replayed',
      'status',
    ]);
    expect(result.body).toMatchObject({
      status: 'COMPLETED',
      replayed: false,
      orders: [
        {
          storeId,
          status: 'PENDING_CONFIRMATION',
          total: '20000.00',
          payment: {
            provider: 'COD',
            status: 'UNPAID',
            amount: '20000.00',
            currency: 'VND',
          },
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /Snapshot address|0901234567|idempotencyKey|requestHash/,
    );
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.body.orders[0].id },
      include: { items: true, payment: true, statusHistory: true },
    });
    expect(order).toMatchObject({
      buyerId,
      recipientNameSnapshot: 'Buyer fixture',
      addressLineSnapshot: 'Snapshot address',
      districtSnapshot: null,
      deliveryNoteSnapshot: 'Original note',
    });
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      variantId: input.items[0].variantId,
      productId,
      productNameSnapshot: 'COD public sample',
      quantity: 2,
      optionSnapshot: [],
    });
    expect(order.statusHistory).toMatchObject([
      {
        fromStatus: null,
        toStatus: 'PENDING_CONFIRMATION',
        actorId: buyerId,
        actorType: 'BUYER',
      },
    ]);
    const after = await state();
    expect(after.cart.map((row) => row.variantId)).toEqual([
      unselected.variant.id,
    ]);
    expect(
      after.variants.find((v) => v.id === input.items[0].variantId)?.stock,
    ).toBe(3);
    expect(after.product).toMatchObject({
      version: before.product!.version + 1,
      moderationStatus: 'APPROVED',
      sellerStatus: 'ACTIVE',
    });
    expect(after.outbox).toMatchObject([
      {
        target: 'SEARCH_SERVICE',
        operation: 'UPSERT',
        version: before.product!.version + 1,
        status: 'PENDING',
        payload: {
          productId,
          version: before.product!.version + 1,
          inStock: true,
          minPrice: '10000',
        },
      },
    ]);
    expect(
      await prisma.stockMovement.findMany({
        where: { orderItemId: order.items[0].id },
      }),
    ).toMatchObject([
      { type: 'CHECKOUT_DECREMENT', quantityDelta: -2, balanceAfter: 3 },
    ]);
    const checkout = await prisma.checkout.findUniqueOrThrow({
      where: { id: result.body.checkoutId },
    });
    expect(checkout).toMatchObject({
      hashVersion: 1,
      receiptVersion: 1,
      status: 'COMPLETED',
      receiptJson: { checkoutId: result.body.checkoutId, status: 'COMPLETED' },
    });
  });
  it('creates one Order per Store in stable order under one Checkout', async () => {
    const seller = await user(Role.SELLER);
    const store = await prisma.store.create({
      data: { sellerId: seller.id, name: `${marker}-second`, status: 'ACTIVE' },
    });
    const v = await variant(store.id, '7000.00');
    await add(v.variant.id);
    input.items.unshift({
      variantId: v.variant.id,
      quantity: 1,
      expectedUnitPrice: '7000',
    });
    const result = await post().expect(201);
    expect(
      result.body.orders.map((o: { storeId: number }) => o.storeId),
    ).toEqual([storeId, store.id]);
    expect(
      await prisma.order.count({
        where: { checkoutId: result.body.checkoutId, buyerId },
      }),
    ).toBe(2);
    expect(
      await prisma.payment.count({
        where: { order: { buyerId }, provider: 'COD', status: 'UNPAID' },
      }),
    ).toBe(2);
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(0);
  });
  it('groups multiple Variants of one Product into one version/event; all sold out stays APPROVED/public', async () => {
    const sibling = await variant(storeId, '12000.00', 1, productId);
    await add(sibling.variant.id);
    await prisma.productVariant.update({
      where: { id: input.items[0].variantId },
      data: { stock: 2 },
    });
    input.items.push({
      variantId: sibling.variant.id,
      quantity: 1,
      expectedUnitPrice: '12000',
    });
    const before = (await state()).product!;
    await post().expect(201);
    const after = await state();
    expect(after.product).toMatchObject({
      version: before.version + 1,
      moderationStatus: 'APPROVED',
    });
    expect(after.outbox).toHaveLength(1);
    expect(after.outbox[0]).toMatchObject({
      operation: 'UPSERT',
      payload: { inStock: false, minPrice: '10000', maxPrice: '12000' },
    });
  });
  it('outbox uses all display Variants, including an unpurchased sibling', async () => {
    await variant(storeId, '5000.00', 9, productId);
    await post().expect(201);
    expect((await state()).outbox[0]).toMatchObject({
      payload: { minPrice: '5000', maxPrice: '10000', inStock: true },
    });
  });
  it('replay after cart/address deletion and catalog/payment changes returns original receipt without writes', async () => {
    const first = await post().expect(201);
    await prisma.userAddress.delete({ where: { id: input.addressId } });
    await prisma.product.update({
      where: { id: productId },
      data: { name: 'Changed later', sellerStatus: 'HIDDEN' },
    });
    await prisma.productVariant.update({
      where: { id: input.items[0].variantId },
      data: { price: '99000.00' },
    });
    await prisma.order.update({
      where: { id: first.body.orders[0].id },
      data: { status: 'CONFIRMED' },
    });
    await prisma.payment.update({
      where: { orderId: first.body.orders[0].id },
      data: { status: 'PAID' },
    });
    const before = await state();
    const second = await post({
      ...input,
      items: input.items.map((i) => ({ ...i, expectedUnitPrice: '10000.00' })),
    }).expect(200);
    expect(second.body).toEqual({ ...first.body, replayed: true });
    expect(
      (
        await request(app.getHttpServer())
          .get('/checkouts/by-key')
          .set('Authorization', token)
          .set('Idempotency-Key', key)
          .expect(200)
      ).body,
    ).toEqual(second.body);
    expect(await state()).toEqual(before);
    expect(
      await prisma.orderItem.findFirst({ where: { order: { buyerId } } }),
    ).toMatchObject({ productNameSnapshot: 'COD public sample' });
  });
  it('same key with changed payload conflicts before looking at consumed cart', async () => {
    await post().expect(201);
    const before = await state();
    const result = await post({
      ...input,
      items: [{ ...input.items[0], quantity: 1 }],
    }).expect(409);
    expect(result.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await state()).toEqual(before);
  });
  it('canonical item reordering and equivalent price strings replay', async () => {
    const v = await variant();
    await add(v.variant.id);
    input.items.push({
      variantId: v.variant.id,
      quantity: 1,
      expectedUnitPrice: '10000',
    });
    const first = await post().expect(201);
    const second = await post({
      ...input,
      items: [...input.items]
        .reverse()
        .map((i) => ({ ...i, expectedUnitPrice: '10000.00' })),
    }).expect(200);
    expect(second.body).toEqual({ ...first.body, replayed: true });
  });
  it.each([
    ['price', 'PRICE_CHANGED'],
    ['stock', 'INSUFFICIENT_STOCK'],
    ['draft', 'VARIANT_NOT_AVAILABLE'],
    ['hidden', 'VARIANT_NOT_AVAILABLE'],
    ['variant', 'VARIANT_NOT_AVAILABLE'],
    ['store', 'VARIANT_NOT_AVAILABLE'],
    ['seller', 'VARIANT_NOT_AVAILABLE'],
    ['category', 'VARIANT_NOT_AVAILABLE'],
  ])('rechecks %s at create and rolls back', async (change, code) => {
    const v = input.items[0].variantId;
    if (change === 'price')
      await prisma.productVariant.update({
        where: { id: v },
        data: { price: '11000.00' },
      });
    if (change === 'stock')
      await prisma.productVariant.update({
        where: { id: v },
        data: { stock: 1 },
      });
    if (change === 'variant')
      await prisma.productVariant.update({
        where: { id: v },
        data: { isActive: false },
      });
    if (change === 'draft')
      await prisma.product.update({
        where: { id: productId },
        data: { moderationStatus: 'NOT_SUBMITTED' },
      });
    if (change === 'hidden')
      await prisma.product.update({
        where: { id: productId },
        data: { sellerStatus: 'HIDDEN' },
      });
    if (change === 'store')
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });
    if (change === 'seller')
      await prisma.user.update({
        where: { id: sellerId },
        data: { isActive: false },
      });
    if (change === 'category')
      await prisma.category.update({
        where: { id: categoryId },
        data: { isActive: false },
      });
    try {
      const before = await state();
      const result = await post().expect(409);
      expect(result.body.code).toBe(code);
      expect(await state()).toEqual(before);
      if (code === 'VARIANT_NOT_AVAILABLE')
        expect(JSON.stringify(result.body)).not.toMatch(
          /COD public sample|10000|storeId|moderation/,
        );
    } finally {
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'ACTIVE' },
      });
      await prisma.user.update({
        where: { id: sellerId },
        data: { isActive: true },
      });
      await prisma.category.update({
        where: { id: categoryId },
        data: { isActive: true },
      });
    }
  });
  it('rejects duplicate variant lines before purchase and preserves the same key for a valid intent', async () => {
    const before = await state();
    const response = await post({
      ...input,
      items: [{ ...input.items[0] }, { ...input.items[0] }],
    }).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(await state()).toEqual(before);
    const valid = await post().expect(201);
    expect(valid.body.replayed).toBe(false);
    const committed = await state();
    expect(committed.orders).toBe(before.orders + 1);
    expect(committed.movements).toBe(before.movements + 1);
    expect(
      committed.variants.find((v) => v.id === input.items[0].variantId)!.stock,
    ).toBe(
      before.variants.find((v) => v.id === input.items[0].variantId)!.stock -
        input.items[0].quantity,
    );
    await post().expect(200);
    expect(await state()).toEqual(committed);
  });
  it('quantity mismatch and non-owned cart/address have no side effects', async () => {
    const before = await state();
    expect(
      (
        await post({
          ...input,
          items: [{ ...input.items[0], quantity: 1 }],
        }).expect(409)
      ).body.code,
    ).toBe('CART_CHANGED');
    const foreign = await buyer();
    expect(
      (await post({ ...input, addressId: foreign.addressId }).expect(404)).body
        .code,
    ).toBe('ADDRESS_NOT_FOUND');
    const foreignVariant = await variant();
    await add(foreignVariant.variant.id, 1, foreign.cartId);
    expect(
      (
        await post({
          ...input,
          items: [
            {
              variantId: foreignVariant.variant.id,
              quantity: 1,
              expectedUnitPrice: '10000',
            },
          ],
        }).expect(404)
      ).body.code,
    ).toBe('CART_ITEM_NOT_FOUND');
    expect((await state()).checkouts).toBe(before.checkouts);
    expect((await state()).cart).toEqual(before.cart);
  });
  it('money overflow is rejected before any transactional writes', async () => {
    await prisma.productVariant.update({
      where: { id: input.items[0].variantId },
      data: { price: '999999999999.00' },
    });
    input.items[0].expectedUnitPrice = '999999999999.00';
    const before = await state();
    expect((await post().expect(400)).body.details.reason).toBe(
      'MONEY_LIMIT_EXCEEDED',
    );
    expect(await state()).toEqual(before);
  });
  it('outbox failure after Orders/stock were written rolls everything back, then same key can succeed', async () => {
    const before = await state();
    const spy = vi
      .spyOn(app.get(SearchOutboxService), 'writeOutboxEvent')
      .mockRejectedValueOnce(new Error('fixture-only-outbox-error'));
    const failed = await post().expect(500);
    expect(JSON.stringify(failed.body)).not.toContain('fixture-only');
    expect(await state()).toEqual(before);
    spy.mockRestore();
    await post().expect(201);
    const committed = await state();
    await post().expect(200);
    expect(await state()).toEqual(committed);
  });
  it('failure on Store two rolls back even Store one outbox and orders', async () => {
    const seller = await user(Role.SELLER);
    const store = await prisma.store.create({
      data: {
        sellerId: seller.id,
        name: `${marker}-rollback`,
        status: 'ACTIVE',
      },
    });
    const v = await variant(store.id);
    await add(v.variant.id);
    input.items.push({
      variantId: v.variant.id,
      quantity: 1,
      expectedUnitPrice: '10000',
    });
    const service = app.get(SearchOutboxService);
    const original = service.writeOutboxEvent.bind(service);
    vi.spyOn(service, 'writeOutboxEvent').mockImplementation(
      async (tx, product, cats, version) => {
        if (product.id === v.product.id)
          throw new Error('fixture-late-failure');
        return original(tx, product, cats, version);
      },
    );
    const before = await state();
    await post().expect(500);
    expect(await state()).toEqual(before);
    expect(
      await prisma.searchOutbox.count({ where: { productId: v.product.id } }),
    ).toBe(0);
  });
  it('receipt validation failure after cart removal rolls back all changes', async () => {
    const before = await state();
    vi.spyOn(receiptModule, 'validateCheckoutReceiptV1').mockImplementationOnce(
      () => {
        throw new Error('fixture-receipt-failure');
      },
    );
    await post().expect(500);
    expect(await state()).toEqual(before);
  });

  // Hold a real Product row until both independent HTTP requests are blocked.
  // This forces overlapping Serializable snapshots, rather than two sequential calls.
  async function race(
    first: () => PromiseLike<request.Response>,
    second: () => PromiseLike<request.Response>,
  ) {
    let release!: () => void;
    let ready!: () => void;
    const released = new Promise<void>((r) => {
      release = r;
    });
    const locked = new Promise<void>((r) => {
      ready = r;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
        ready();
        await released;
      },
      { timeout: 10000 },
    );
    await locked;
    const pending = [Promise.resolve(first()), Promise.resolve(second())];
    try {
      let blocked = false;
      for (let i = 0; i < 70; i++) {
        const rows = await otherPrisma.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND (query LIKE 'SELECT id FROM products%' OR query LIKE 'SELECT id FROM users%')`;
        if (Number(rows[0].count) >= 2) {
          blocked = true;
          break;
        }
        await delay(10);
      }
      expect(blocked).toBe(true);
    } finally {
      release();
      await blocker;
    }
    return Promise.all(pending);
  }
  it('same Buyer/key across two apps creates once; retry gets the same receipt', async () => {
    const results = await race(
      () => post(),
      () => post(input, key, token, otherApp),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.checkoutId).toBe(results[1].body.checkoutId);
    expect((await state()).orders).toBe(1);
    expect((await state()).movements).toBe(1);
  });
  it('two different keys cannot consume the same cart line twice even with enough stock', async () => {
    const results = await race(
      () => post(),
      () => post(input, `${key}_different`, token, otherApp),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 404]);
    expect(results.find((r) => r.status === 404)?.body.code).toBe(
      'CART_ITEM_NOT_FOUND',
    );
    expect((await state()).orders).toBe(1);
    expect((await state()).movements).toBe(1);
  });
  it('two Buyers competing for the last item: exactly one Order/decrement, stock never negative', async () => {
    input.items[0].quantity = 1;
    await prisma.cartItem.updateMany({
      where: { cartId },
      data: { quantity: 1 },
    });
    await prisma.productVariant.update({
      where: { id: input.items[0].variantId },
      data: { stock: 1 },
    });
    const other = await buyer();
    await add(input.items[0].variantId, 1, other.cartId);
    const otherInput = { ...input, addressId: other.addressId };
    const results = await race(
      () => post(),
      () => post(otherInput, key, other.token, otherApp),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe(
      'INSUFFICIENT_STOCK',
    );
    expect(
      await prisma.productVariant.findUnique({
        where: { id: input.items[0].variantId },
      }),
    ).toMatchObject({ stock: 0 });
    expect(
      await prisma.stockMovement.count({
        where: { variantId: input.items[0].variantId },
      }),
    ).toBe(1);
    expect(
      await prisma.orderItem.count({
        where: { variantId: input.items[0].variantId },
      }),
    ).toBe(1);
  });
  it('serialization retries are bounded at three and do not count a second intent', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'fixture-conflict',
      { code: 'P2034', clientVersion: '7.10.0' },
    );
    const outbox = app.get(SearchOutboxService);
    const spy = vi
      .spyOn(outbox, 'writeOutboxEvent')
      .mockRejectedValue(conflict);
    const before = await state();
    expect((await post().expect(409)).body.code).toBe('STOCK_CONFLICT');
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await state()).toEqual(before);
    spy.mockRestore();
    await post().expect(201);
  });
  it('one transient serialization error rolls back its attempt, then commits once', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'fixture-conflict',
      { code: 'P2034', clientVersion: '7.10.0' },
    );
    vi.spyOn(
      app.get(SearchOutboxService),
      'writeOutboxEvent',
    ).mockRejectedValueOnce(conflict);
    const quota = vi.spyOn(app.get(CheckoutCreateRate), 'consume');
    await post().expect(201);
    expect(
      quota.mock.calls.filter(([, kind]) => kind === 'intent'),
    ).toHaveLength(1);
    expect((await state()).orders).toBe(1);
    expect((await state()).outbox).toHaveLength(1);
  });
  it('failed new intents exhaust five slots; completed replay does not spend intent quota', async () => {
    const first = await post().expect(201);
    for (let i = 0; i < 4; i++) await post(input, `${key}_${i}`).expect(404);
    const denied = await post(input, `${key}_unknown`).expect(429);
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect((await post().expect(200)).body).toEqual({
      ...first.body,
      replayed: true,
    });
    expect(
      (
        await post({
          ...input,
          items: [{ ...input.items[0], quantity: 1 }],
        }).expect(409)
      ).body.code,
    ).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('replays still hit the 60-request ingress cap', async () => {
    await post().expect(201);
    for (let i = 1; i < 60; i++) await post().expect(200);
    const denied = await post().expect(429);
    expect(denied.body.code).toBe('RATE_LIMITED');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect((await state()).orders).toBe(1);
  });
  it('legacy/PENDING keys cannot be recreated or reset', async () => {
    await prisma.checkout.create({
      data: { buyerId, idempotencyKey: key, requestHash: 'legacy' },
    });
    expect((await post().expect(409)).body.code).toBe(
      'CHECKOUT_LEGACY_REVIEW_REQUIRED',
    );
    const { buildCheckoutRequestV1 } =
      await import('../src/checkout/checkout-request.js');
    await prisma.checkout.updateMany({
      where: { buyerId },
      data: {
        hashVersion: 1,
        requestHash: buildCheckoutRequestV1(buyerId, input).requestHash,
      },
    });
    const pending = await post().expect(409);
    expect(pending.body.code).toBe('CHECKOUT_IN_PROGRESS');
    expect(pending.headers['retry-after']).toBe('2');
    expect((await state()).orders).toBe(0);
  });
  it('Auth, required header, extra body/query and unsupported payment are rejected without writes', async () => {
    await request(app.getHttpServer())
      .post('/checkouts')
      .send(input)
      .expect(401);
    await post(input, key, (await user(Role.SELLER)).token).expect(403);
    const missing = await request(app.getHttpServer())
      .post('/checkouts')
      .set('Authorization', token)
      .send(input)
      .expect(400);
    expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await post({ ...input, buyerId }).expect(400);
    await post({ ...input, paymentProvider: 'MOMO' }).expect(400);
    await request(app.getHttpServer())
      .post('/checkouts?key=not_allowed')
      .set('Authorization', token)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(400);
    expect((await state()).checkouts).toBe(0);
  });
  it('rechecks active/role inside transaction even when called without HTTP guards', async () => {
    await prisma.user.update({
      where: { id: buyerId },
      data: { isActive: false },
    });
    await expect(
      app.get(CheckoutCreateService).create(buyerId, key, input),
    ).rejects.toMatchObject({ status: 401 });
    expect((await state()).checkouts).toBe(0);
  });

  it('snapshot captures selected option labels and SKU without depending on live catalog', async () => {
    const group = await prisma.productOptionGroup.create({
      data: { productId, name: 'Color' },
    });
    const value = await prisma.productOptionValue.create({
      data: { productId, groupId: group.id, value: 'Black' },
    });
    await prisma.productVariantOptionValue.create({
      data: {
        variantId: input.items[0].variantId,
        productId,
        optionGroupId: group.id,
        optionValueId: value.id,
      },
    });
    await post().expect(201);
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { buyerId } },
    });
    expect(item.optionSnapshot).toEqual([
      {
        groupId: group.id,
        groupName: 'Color',
        valueId: value.id,
        value: 'Black',
      },
    ]);
    await prisma.productOptionValue.update({
      where: { id: value.id },
      data: { value: 'White' },
    });
    await prisma.productVariant.update({
      where: { id: input.items[0].variantId },
      data: { skuCode: `${marker}-${sequence++}-changed` },
    });
    expect(
      await prisma.orderItem.findUnique({ where: { id: item.id } }),
    ).toEqual(item);
  });
  it('one buyer cannot replay another buyer key; identical keys are scoped to buyer', async () => {
    const first = await post().expect(201);
    const other = await buyer();
    await add(input.items[0].variantId, 1, other.cartId);
    const result = await post(
      {
        ...input,
        addressId: other.addressId,
        items: [{ ...input.items[0], quantity: 1 }],
      },
      key,
      other.token,
      otherApp,
    ).expect(201);
    expect(result.body.checkoutId).not.toBe(first.body.checkoutId);
    expect(
      await prisma.checkout.count({
        where: { idempotencyKey: key, buyerId: { in: [buyerId, other.id] } },
      }),
    ).toBe(2);
  });
  it('self-purchase is rejected even for a USER that owns a Store in database', async () => {
    const ownStore = await prisma.store.create({
      data: { sellerId: buyerId, name: `${marker}-self`, status: 'ACTIVE' },
    });
    const v = await variant(ownStore.id);
    await add(v.variant.id);
    const body = {
      ...input,
      items: [
        { variantId: v.variant.id, quantity: 1, expectedUnitPrice: '10000' },
      ],
    };
    expect((await post(body).expect(409)).body.code).toBe(
      'SELF_PURCHASE_FORBIDDEN',
    );
    expect((await state()).checkouts).toBe(0);
  });
  it('required Category attribute invalidation prevents create', async () => {
    const definition = await prisma.categoryAttributeDefinition.create({
      data: {
        categoryId,
        name: `${marker}-required`,
        slug: `${marker}-required`,
        dataType: 'TEXT',
        isRequired: true,
      },
    });
    try {
      const before = await state();
      expect((await post().expect(409)).body.code).toBe(
        'VARIANT_NOT_AVAILABLE',
      );
      expect(await state()).toEqual(before);
    } finally {
      await prisma.categoryAttributeDefinition.delete({
        where: { id: definition.id },
      });
    }
  });
  it('JSON body limit applies to create too, before any write', async () => {
    const before = await state();
    const result = await post({
      ...input,
      padding: 'x'.repeat(70 * 1024),
    }).expect(413);
    expect(result.body.code).toBe('REQUEST_TOO_LARGE');
    expect(await state()).toEqual(before);
  });
  it('real database lock timeout is bounded, safe and permits retry with the same key', async () => {
    let release!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>((r) => {
      ready = r;
    });
    const released = new Promise<void>((r) => {
      release = r;
    });
    const blocker = otherPrisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
        ready();
        await released;
      },
      { timeout: 10000 },
    );
    await locked;
    const before = await state();
    try {
      const start = Date.now();
      const result = await post().expect(409);
      expect(Date.now() - start).toBeLessThan(5000);
      expect(result.body.code).toBe('CHECKOUT_IN_PROGRESS');
      expect(result.headers['retry-after']).toBe('2');
      expect(await state()).toEqual(before);
    } finally {
      release();
      await blocker;
    }
    await post().expect(201);
  });
  it('records Buyer audit for every Store and replay on another instance does not duplicate history', async () => {
    const seller = await user(Role.SELLER);
    const store = await prisma.store.create({
      data: { sellerId: seller.id, name: `${marker}-audit`, status: 'ACTIVE' },
    });
    const second = await variant(store.id, '7000.00');
    await add(second.variant.id);
    input.items.push({
      variantId: second.variant.id,
      quantity: 1,
      expectedUnitPrice: '7000',
    });
    const first = await post().expect(201);
    const orderIds = first.body.orders.map((order: { id: number }) => order.id);
    expect(orderIds).toHaveLength(2);
    const histories = () =>
      prisma.orderStatusHistory.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { orderId: 'asc' },
      });
    const before = await histories();
    expect(before).toHaveLength(2);
    for (const history of before) {
      expect(history).toMatchObject({
        actorId: buyerId,
        actorType: 'BUYER',
        fromStatus: null,
        toStatus: 'PENDING_CONFIRMATION',
        commandId: null,
      });
    }
    const committed = await state();
    const replay = await post(input, key, token, otherApp).expect(200);
    expect(replay.body).toEqual({ ...first.body, replayed: true });
    expect(await histories()).toEqual(before);
    expect(await state()).toEqual(committed);
  });
});
