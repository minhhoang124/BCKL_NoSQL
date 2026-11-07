import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { completeInput } from '../src/order/order-completion-request.js';

// Retain immutable receipts/fences and labeled fixtures in an isolated QA DB.
describe('Seller acts as Buyer — opt-in real HTTP/PostgreSQL', () => {
  let app: INestApplication, second: INestApplication, p: PrismaService;
  type Actor = { id: number; token: string };
  let purchaser: Actor, owner: Actor, other: Actor, admin: Actor;
  let variantId: number, storeId: number;
  const marker = `dual_access_${randomUUID()}`;
  const key = () => `${marker}_${randomUUID()}`;
  async function start() {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const instance = module.createNestApplication();
    configureApp(instance);
    await instance.init();
    return instance;
  }
  async function actor(role: Role) {
    const row = await p.user.create({
      data: {
        email: `${key()}@example.test`,
        passwordHash: 'fixture-only',
        role,
      },
    });
    const c = app.get(ConfigService);
    return {
      id: row.id,
      token:
        'Bearer ' +
        app.get(JwtService).sign(
          { sub: row.id, email: row.email, role, type: 'access' },
          {
            secret: c.getOrThrow('JWT_ACCESS_SECRET'),
            issuer: c.get('JWT_ISSUER', 'klcn-ecommerce-api'),
            audience: c.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
            expiresIn: '10m',
          },
        ),
    };
  }
  const http = (instance = app) => request(instance.getHttpServer());
  const post = (
    url: string,
    who: Actor,
    body: object,
    k = key(),
    instance = app,
  ) =>
    http(instance)
      .post(url)
      .set('Authorization', who.token)
      .set('Idempotency-Key', k)
      .send(body);
  beforeAll(async () => {
    vi.stubEnv('ACCOUNT_BUYER_ACCESS_ENABLED', 'true');
    app = await start();
    second = await start();
    p = app.get(PrismaService);
    purchaser = await actor('SELLER');
    owner = await actor('SELLER');
    other = await actor('SELLER');
    admin = await actor('ADMIN');
    await p.store.create({
      data: {
        sellerId: purchaser.id,
        name: marker + '_own_suspended',
        status: 'SUSPENDED',
      },
    });
    storeId = (
      await p.store.create({
        data: { sellerId: owner.id, name: marker, status: 'ACTIVE' },
      })
    ).id;
    const category = await p.category.create({
      data: { name: marker, slug: key() },
    });
    const product = await p.product.create({
      data: {
        storeId,
        categoryId: category.id,
        name: marker,
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: { url: '/uploads/dual-access-fixture.jpg', isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    variantId = (
      await p.productVariant.create({
        data: {
          productId: product.id,
          storeId,
          skuCode: key(),
          price: '10000',
          stock: 20,
          optionSignature: '',
        },
      })
    ).id;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await second?.close();
    await app?.close();
  });
  async function checkout() {
    const address = await post('/me/addresses', purchaser, {
      recipientName: 'Seller buying',
      phone: '0901234567',
      province: 'QA',
      ward: 'QA',
      addressLine: 'QA only',
    }).expect(201);
    await http()
      .put(`/cart/items/${variantId}`)
      .set('Authorization', purchaser.token)
      .send({ quantity: 1 })
      .expect(200);
    const input = {
      addressId: address.body.id,
      paymentProvider: 'COD',
      items: [{ variantId, quantity: 1, expectedUnitPrice: '10000' }],
    };
    await post('/checkout/preview', purchaser, input).expect(200);
    const k = key();
    const response = await post('/checkouts', purchaser, input, k).expect(201);
    const row = await p.order.findFirstOrThrow({
      where: { buyerId: purchaser.id },
      orderBy: { id: 'desc' },
    });
    const replay = await post('/checkouts', purchaser, input, k, second).expect(
      200,
    );
    expect(replay.body.checkoutId).toBe(response.body.checkoutId);
    expect(replay.body.replayed).toBe(true);
    return row.id;
  }
  it('buys from another Store despite own Store suspension, reads only its purchases', async () => {
    const id = await checkout();
    await http()
      .get('/orders')
      .set('Authorization', purchaser.token)
      .expect(200);
    const detail = await http()
      .get(`/orders/${id}`)
      .set('Authorization', purchaser.token)
      .expect(200);
    expect(detail.body.id).toBe(id);
    await http()
      .get(`/orders/${id}`)
      .set('Authorization', other.token)
      .expect(404);
    await http()
      .get(`/seller/orders/${id}`)
      .set('Authorization', purchaser.token)
      .expect(404);
    await http()
      .get(`/seller/orders/${id}`)
      .set('Authorization', owner.token)
      .expect(200);
  });
  it('SELLER account on /orders gets BUYER image policy by endpoint scope; owner keeps SELLER policy', async () => {
    const id = await checkout();
    const item = await p.orderItem.findFirstOrThrow({ where: { orderId: id } });
    const listRow = async (url: string, who: Actor) =>
      (
        await http().get(url).set('Authorization', who.token).expect(200)
      ).body.items.find((row: { id: number }) => row.id === id);
    const detailItem = async (url: string, who: Actor) =>
      (await http().get(url).set('Authorization', who.token).expect(200)).body
        .items[0];
    // Visible product: a role-based SELLER policy would filter by the
    // purchaser's own Store and wrongly return null here.
    const purchased = await listRow('/orders', purchaser);
    expect(purchased).toMatchObject({
      itemCount: 1,
      totalQuantity: 1,
      hasMoreItems: false,
    });
    expect(purchased.itemPreview).toEqual([
      {
        orderItemId: item.id,
        productId: item.productId,
        variantId,
        productName: marker,
        options: [],
        quantity: 1,
        unitPrice: '10000.00',
        lineTotal: '10000.00',
        imageUrl: '/uploads/dual-access-fixture.jpg',
      },
    ]);
    expect((await detailItem(`/orders/${id}`, purchaser)).imageUrl).toBe(
      '/uploads/dual-access-fixture.jpg',
    );
    expect(
      (await listRow('/seller/orders', owner)).itemPreview[0].imageUrl,
    ).toBe('/uploads/dual-access-fixture.jpg');
    // The purchaser's own Seller scope never sees this order.
    expect(await listRow('/seller/orders', purchaser)).toBeUndefined();
    await p.product.update({
      where: { id: item.productId },
      data: { sellerStatus: 'HIDDEN' },
    });
    try {
      expect(
        (await listRow('/orders', purchaser)).itemPreview[0].imageUrl,
      ).toBeNull();
      const hiddenDetail = await detailItem(`/orders/${id}`, purchaser);
      expect(hiddenDetail.imageUrl).toBeNull();
      expect(hiddenDetail.productName).toBe(marker);
      expect(hiddenDetail.unitPrice).toBe('10000.00');
      expect(
        (await listRow('/seller/orders', owner)).itemPreview[0].imageUrl,
      ).toBe('/uploads/dual-access-fixture.jpg');
      expect(
        (await detailItem(`/seller/orders/${id}`, owner)).imageUrl,
      ).toBe('/uploads/dual-access-fixture.jpg');
    } finally {
      await p.product.update({
        where: { id: item.productId },
        data: { sellerStatus: 'ACTIVE' },
      });
    }
  });
  it('blocks self-purchase at Cart, preview and create even with a directly seeded cart row', async () => {
    const ownStore = await p.store.findUniqueOrThrow({
      where: { sellerId: purchaser.id },
    });
    const source = await p.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      include: { product: true },
    });
    const ownProduct = await p.product.create({
      data: {
        storeId: ownStore.id,
        categoryId: source.product.categoryId,
        name: marker + '_self',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
      },
    });
    const ownVariant = await p.productVariant.create({
      data: {
        storeId: ownStore.id,
        productId: ownProduct.id,
        skuCode: key(),
        optionSignature: '',
        stock: 3,
        price: '10000',
      },
    });
    const cartReply = await http()
      .put(`/cart/items/${ownVariant.id}`)
      .set('Authorization', purchaser.token)
      .send({ quantity: 1 })
      .expect(409);
    expect(cartReply.body.code).toBe('SELF_PURCHASE_FORBIDDEN');
    // A corrupted/legacy cart must not bypass the two independent checkout checks.
    const cart = await p.cart.upsert({
      where: { userId: purchaser.id },
      create: { userId: purchaser.id },
      update: {},
    });
    await p.cartItem.create({
      data: { cartId: cart.id, variantId: ownVariant.id, quantity: 1 },
    });
    const address = await post('/me/addresses', purchaser, {
      recipientName: 'QA self',
      phone: '0901234567',
      province: 'QA',
      ward: 'QA',
      addressLine: 'QA only',
    }).expect(201);
    const input = {
      addressId: address.body.id,
      paymentProvider: 'COD',
      items: [
        { variantId: ownVariant.id, quantity: 1, expectedUnitPrice: '10000' },
      ],
    };
    const before = {
      orders: await p.order.count({ where: { buyerId: purchaser.id } }),
      events: await p.searchOutbox.count({
        where: { productId: ownProduct.id },
      }),
    };
    for (const endpoint of ['/checkout/preview', '/checkouts']) {
      const response = await post(endpoint, purchaser, input).expect(409);
      expect(response.body.code).toBe('SELF_PURCHASE_FORBIDDEN');
    }
    expect(await p.order.count({ where: { buyerId: purchaser.id } })).toBe(
      before.orders,
    );
    expect(
      await p.searchOutbox.count({ where: { productId: ownProduct.id } }),
    ).toBe(before.events);
    expect(
      (
        await p.productVariant.findUniqueOrThrow({
          where: { id: ownVariant.id },
        })
      ).stock,
    ).toBe(3);
    expect(
      (await p.product.findUniqueOrThrow({ where: { id: ownProduct.id } }))
        .version,
    ).toBe(ownProduct.version);
    expect(
      await p.stockMovement.count({ where: { variantId: ownVariant.id } }),
    ).toBe(0);
  });
  it('cancels own purchase with one restore and replays original Buyer receipt across apps', async () => {
    const id = await checkout(),
      k = key();
    const body = { reasonCode: 'CHANGED_MIND', reasonText: 'QA' };
    await post(`/orders/${id}/cancel`, other, body).expect(404);
    await post(`/orders/${id}/cancel`, purchaser, body, k).expect(200);
    await post(`/orders/${id}/cancel`, purchaser, body, k, second).expect(200);
    expect(
      await p.stockMovement.count({
        where: { orderItem: { orderId: id }, type: 'CANCELLATION_RESTORE' },
      }),
    ).toBe(1);
    expect(
      await p.orderCommand.count({
        where: { orderId: id, actorType: 'BUYER' },
      }),
    ).toBe(1);
  });
  it('completes a delivered purchase and resolves its exact receipt, not Seller namespace', async () => {
    const id = await checkout();
    for (const command of ['confirm', 'start-packing', 'ready-to-ship'])
      await post(`/seller/orders/${id}/${command}`, owner, {}).expect(200);
    await post(`/admin/orders/${id}/ship`, admin, {
      trackingReference: 'QA-DUAL',
    }).expect(200);
    await post(`/admin/orders/${id}/mark-delivered`, admin, {
      trackingReference: 'QA-DUAL',
      deliveryAttempt: 1,
    }).expect(200);
    const k = key();
    await post(`/orders/${id}/complete`, purchaser, {}, k).expect(200);
    const input = completeInput(purchaser.id, id, k, {});
    const resolved = await post(
      `/orders/${id}/resolve-command`,
      purchaser,
      { command: 'complete', hashVersion: 1, requestHash: input.requestHash },
      k,
      second,
    ).expect(200);
    expect(resolved.body.outcome).toBe('COMMITTED');
    expect(
      await p.orderCommand.count({
        where: { orderId: id, actorType: 'BUYER', command: 'complete' },
      }),
    ).toBe(1);
  });
  it('does not grant Admin privileges and checks current account activity, not old JWT role', async () => {
    await http()
      .get('/admin/accounts')
      .set('Authorization', purchaser.token)
      .expect(403);
    await http().get('/cart').set('Authorization', admin.token).expect(403);
    await p.user.update({ where: { id: other.id }, data: { isActive: false } });
    await http().get('/cart').set('Authorization', other.token).expect(401);
  });
  it('default-off gate preserves legacy access and does not broaden ordinary USER to Seller', async () => {
    const buyer = await actor('USER');
    await http()
      .get('/seller/orders')
      .set('Authorization', buyer.token)
      .expect(403);
    vi.stubEnv('ACCOUNT_BUYER_ACCESS_ENABLED', 'false');
    try {
      await http()
        .get('/cart')
        .set('Authorization', purchaser.token)
        .expect(403);
      await http().get('/cart').set('Authorization', buyer.token).expect(200);
    } finally {
      vi.stubEnv('ACCOUNT_BUYER_ACCESS_ENABLED', 'true');
    }
  });
});
