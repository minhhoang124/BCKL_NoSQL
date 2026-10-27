import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { request as nodeRequest } from 'node:http';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import {
  CheckoutReadService,
  type CheckoutPreview,
} from '../src/checkout/checkout-read.service.js';
import type { CheckoutRequestInput } from '../src/checkout/checkout-request.js';

describe('Checkout preview and receipt lookup HTTP (e2e; read-only scenarios)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let buyerId: number;
  let buyerToken: string;
  let sellerToken: string;
  let adminToken: string;
  let storeId: number;
  let categoryId: number;
  let addressId: number;
  let cartId: number;
  let input: CheckoutRequestInput;
  let productId: number;
  let sequence = 0;
  const marker = `checkout-read-${Date.now()}`;
  const key = 'checkout_read_key_0123456789';
  const http = () => request(app.getHttpServer());
  const preview = (body: unknown = input, token = buyerToken) =>
    http()
      .post('/checkout/preview')
      .set('Authorization', token)
      .send(body as object);
  const lookup = (headerKey = key, token = buyerToken) =>
    http()
      .get('/checkouts/by-key')
      .set('Authorization', token)
      .set('Idempotency-Key', headerKey);

  async function user(role: Role = Role.USER) {
    const actor = await prisma.user.create({
      data: {
        email: `${marker}-${sequence++}@example.com`,
        passwordHash: 'fixture-not-for-login',
        role,
      },
    });
    const config = app.get(ConfigService);
    const token = app.get(JwtService).sign(
      { sub: actor.id, email: actor.email, role, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { ...actor, token: `Bearer ${token}` };
  }
  async function variant(store = storeId, price = '10000.00', stock = 5) {
    const product = await prisma.product.create({
      data: {
        storeId: store,
        categoryId,
        name: 'Public checkout sample',
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
        optionSignature: 'default',
      },
    });
    return { product, variant: v };
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    const seller = await user(Role.SELLER);
    sellerToken = seller.token;
    adminToken = (await user(Role.ADMIN)).token;
    storeId = (
      await prisma.store.create({
        data: {
          name: `${marker}-store`,
          sellerId: seller.id,
          status: 'ACTIVE',
        },
      })
    ).id;
    categoryId = (
      await prisma.category.create({
        data: { name: 'Checkout leaf', slug: marker },
      })
    ).id;
  });
  beforeEach(async () => {
    const buyer = await user();
    buyerId = buyer.id;
    buyerToken = buyer.token;
    addressId = (
      await prisma.userAddress.create({
        data: {
          userId: buyerId,
          recipientName: 'Buyer fixture',
          phone: '0901234567',
          province: 'Demo province',
          ward: 'Demo ward',
          addressLine: 'Private fixture address',
          isDefault: true,
        },
      })
    ).id;
    cartId = (await prisma.cart.create({ data: { userId: buyerId } })).id;
    const v = await variant();
    productId = v.product.id;
    await prisma.cartItem.create({
      data: { cartId, variantId: v.variant.id, quantity: 2 },
    });
    input = {
      addressId,
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
      // Only marker-owned fixtures. Lookup uses receipt-only DB fixtures, not Orders.
      await prisma.checkout.deleteMany({
        where: { buyer: { email: { startsWith: marker } } },
      });
      await prisma.cartItem.deleteMany({
        where: { cart: { user: { email: { startsWith: marker } } } },
      });
      await prisma.product.deleteMany({
        where: { store: { name: { startsWith: marker } } },
      });
      await prisma.store.deleteMany({
        where: { name: { startsWith: marker } },
      });
      await prisma.category.deleteMany({ where: { slug: marker } });
      await prisma.brand.deleteMany({
        where: { slug: { startsWith: marker } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: marker } },
      });
    }
    if (app) await app.close();
  });

  async function state() {
    return {
      product: await prisma.product.findUnique({ where: { id: productId } }),
      variant: await prisma.productVariant.findUnique({
        where: { id: input.items[0].variantId },
      }),
      cart: await prisma.cart.findUnique({
        where: { id: cartId },
        include: { items: true },
      }),
      checkouts: await prisma.checkout.count({ where: { buyerId } }),
      orders: await prisma.order.count({ where: { buyerId } }),
      payments: await prisma.payment.count({ where: { order: { buyerId } } }),
      movements: await prisma.stockMovement.count({
        where: { variantId: input.items[0].variantId },
      }),
      outbox: await prisma.searchOutbox.count({ where: { productId } }),
    };
  }
  it('preview canonical money, zero demo shipping, allowlist and no DB writes', async () => {
    const before = await state();
    const result = await preview().expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toEqual({
      canCheckout: true,
      paymentProvider: 'COD',
      currency: 'VND',
      shippingMode: 'DEMO_ZERO_V1',
      groups: [
        {
          store: { id: storeId, name: `${marker}-store` },
          items: [
            {
              variantId: input.items[0].variantId,
              quantity: 2,
              expectedUnitPrice: '10000.00',
              unitPrice: '10000.00',
              lineTotal: '20000.00',
              errors: [],
            },
          ],
          subtotal: '20000.00',
          shippingFee: '0.00',
          discountTotal: '0.00',
          total: '20000.00',
        },
      ],
      unavailableItems: [],
      totals: {
        subtotal: '20000.00',
        shippingFee: '0.00',
        discountTotal: '0.00',
        total: '20000.00',
      },
    });
    expect(await state()).toEqual(before);
  });
  it('groups selected items by Store, sorts IDs and never consumes unselected cart rows', async () => {
    const seller = await user(Role.SELLER);
    const second = await prisma.store.create({
      data: { name: `${marker}-second`, sellerId: seller.id, status: 'ACTIVE' },
    });
    const v2 = await variant(second.id, '25000.00');
    const unselected = await variant();
    await prisma.cartItem.createMany({
      data: [
        { cartId, variantId: v2.variant.id, quantity: 1 },
        { cartId, variantId: unselected.variant.id, quantity: 3 },
      ],
    });
    const body = {
      ...input,
      items: [
        {
          variantId: v2.variant.id,
          quantity: 1,
          expectedUnitPrice: '25000.00',
        },
        ...input.items,
      ],
    };
    const result = (await preview(body).expect(200)).body as CheckoutPreview;
    expect(result.groups.map((g) => g.store.id)).toEqual([storeId, second.id]);
    expect(result.totals?.total).toBe('45000.00');
    expect(await prisma.cartItem.count({ where: { cartId } })).toBe(3);
  });
  it.each(['DRAFT', 'HIDDEN'] as const)(
    'private Product %s returns only the unavailable allowlist',
    async (sellerStatus) => {
      await prisma.product.update({
        where: { id: productId },
        data: { sellerStatus, name: 'PRIVATE NAME MUST NOT LEAK' },
      });
      const result = await preview().expect(200);
      expect(result.body).toEqual({
        canCheckout: false,
        paymentProvider: 'COD',
        currency: 'VND',
        shippingMode: 'DEMO_ZERO_V1',
        groups: [],
        unavailableItems: [
          {
            variantId: input.items[0].variantId,
            quantity: 2,
            errors: ['VARIANT_NOT_AVAILABLE'],
          },
        ],
        totals: null,
      });
    },
  );
  it('an inactive selected Variant is private even if a sibling keeps Product public', async () => {
    await prisma.productVariant.update({
      where: { id: input.items[0].variantId },
      data: { isActive: false },
    });
    await prisma.productVariant.create({
      data: {
        productId,
        storeId,
        skuCode: `${marker}-${sequence++}`,
        price: '20000.00',
        stock: 5,
        optionSignature: 'fixture-sibling',
      },
    });
    const result = (await preview().expect(200)).body as CheckoutPreview;
    expect(result.groups).toEqual([]);
    expect(result.unavailableItems).toEqual([
      {
        variantId: input.items[0].variantId,
        quantity: 2,
        errors: ['VARIANT_NOT_AVAILABLE'],
      },
    ]);
  });
  it.each(['store', 'seller', 'category', 'brand', 'required-attribute'])(
    'rechecks canonical public eligibility: %s',
    async (dependency) => {
      const store = await prisma.store.findUniqueOrThrow({
        where: { id: storeId },
      });
      let definitionId: number | undefined;
      try {
        if (dependency === 'store')
          await prisma.store.update({
            where: { id: storeId },
            data: { status: 'SUSPENDED' },
          });
        if (dependency === 'seller')
          await prisma.user.update({
            where: { id: store.sellerId },
            data: { isActive: false },
          });
        if (dependency === 'category')
          await prisma.category.update({
            where: { id: categoryId },
            data: { isActive: false },
          });
        if (dependency === 'brand') {
          const brand = await prisma.brand.create({
            data: {
              name: 'Private brand',
              slug: `${marker}-${sequence++}`,
              isActive: false,
            },
          });
          await prisma.product.update({
            where: { id: productId },
            data: { brandId: brand.id },
          });
        }
        if (dependency === 'required-attribute') {
          definitionId = (
            await prisma.categoryAttributeDefinition.create({
              data: {
                categoryId,
                name: 'Required specification',
                slug: `${marker}-${sequence++}`,
                dataType: 'TEXT',
                isRequired: true,
              },
            })
          ).id;
        }
        const before = await state();
        const result = (await preview().expect(200)).body as CheckoutPreview;
        expect(result.canCheckout).toBe(false);
        expect(result.groups).toEqual([]);
        expect(result.totals).toBeNull();
        expect(result.unavailableItems).toEqual([
          {
            variantId: input.items[0].variantId,
            quantity: 2,
            errors: ['VARIANT_NOT_AVAILABLE'],
          },
        ]);
        expect(await state()).toEqual(before);
      } finally {
        await prisma.store.update({
          where: { id: storeId },
          data: { status: 'ACTIVE' },
        });
        await prisma.user.update({
          where: { id: store.sellerId },
          data: { isActive: true },
        });
        await prisma.category.update({
          where: { id: categoryId },
          data: { isActive: true },
        });
        if (definitionId)
          await prisma.categoryAttributeDefinition.delete({
            where: { id: definitionId },
          });
      }
    },
  );
  it.each([
    { stock: 1, price: '12000.00', code: 'INSUFFICIENT_STOCK' },
    { stock: 5, price: '12000.00', code: 'PRICE_CHANGED' },
  ])(
    'line priority $code; error group/totals null, public current price only',
    async ({ stock, price, code }) => {
      await prisma.productVariant.update({
        where: { id: input.items[0].variantId },
        data: { stock, price },
      });
      const result = (await preview().expect(200)).body as CheckoutPreview;
      expect(result.canCheckout).toBe(false);
      expect(result.totals).toBeNull();
      expect(result.groups[0]).toMatchObject({
        subtotal: null,
        shippingFee: null,
        discountTotal: null,
        total: null,
      });
      expect(result.groups[0].items[0]).toMatchObject({
        unitPrice: '12000.00',
        expectedUnitPrice: '10000.00',
        errors: [code],
      });
    },
  );
  it('foreign/missing address has the same 404 without PII', async () => {
    const result = await preview({ ...input, addressId: 2147483647 }).expect(
      404,
    );
    expect(result.body.code).toBe('ADDRESS_NOT_FOUND');
    expect(JSON.stringify(result.body)).not.toContain(
      'Private fixture address',
    );
    const other = await user();
    await prisma.userAddress.update({
      where: { id: addressId },
      data: { userId: other.id },
    });
    expect((await preview().expect(404)).body).toEqual(result.body);
  });
  it('Cart membership and quantity are whole-request errors, not partial preview success', async () => {
    expect(
      (
        await preview({
          ...input,
          items: [{ ...input.items[0], quantity: 1 }],
        }).expect(409)
      ).body.code,
    ).toBe('CART_CHANGED');
    await prisma.cartItem.deleteMany({ where: { cartId } });
    expect((await preview().expect(404)).body.code).toBe('CART_ITEM_NOT_FOUND');
  });
  it('self-purchase rejected even with seeded Buyer-owned Store', async () => {
    const own = await prisma.store.create({
      data: { name: `${marker}-own`, sellerId: buyerId, status: 'ACTIVE' },
    });
    const v = await variant(own.id);
    await prisma.cartItem.create({
      data: { cartId, variantId: v.variant.id, quantity: 1 },
    });
    expect(
      (
        await preview({
          ...input,
          items: [
            {
              variantId: v.variant.id,
              quantity: 1,
              expectedUnitPrice: '10000',
            },
          ],
        }).expect(409)
      ).body.code,
    ).toBe('SELF_PURCHASE_FORBIDDEN');
  });
  it.each([
    { extra: true },
    { paymentProvider: 'MOMO' },
    { addressId: '1' },
    { addressId: 2147483648 },
    { items: [] },
    { items: [{ variantId: 1, quantity: 0, expectedUnitPrice: '10000' }] },
    { items: [{ variantId: 1, quantity: 100, expectedUnitPrice: '10000' }] },
    {
      items: Array.from({ length: 51 }, (_, index) => ({
        variantId: index + 1,
        quantity: 1,
        expectedUnitPrice: '10000',
      })),
    },
    {
      items: Array.from({ length: 2 }, () => ({
        variantId: 1,
        quantity: 1,
        expectedUnitPrice: '10000',
      })),
    },
    { items: [{ variantId: 1, quantity: 1, expectedUnitPrice: 10000 }] },
    { items: [{ variantId: 1, quantity: 1, expectedUnitPrice: '01' }] },
    {
      items: [
        {
          variantId: 1,
          quantity: 1,
          expectedUnitPrice: '10000',
          injected: true,
        },
      ],
    },
  ])(
    'rejects malformed body $extra $paymentProvider $addressId',
    async (patch) => {
      const before = await state();
      const result = await preview({ ...input, ...patch }).expect(400);
      expect(['VALIDATION_ERROR', 'EMPTY_CHECKOUT']).toContain(
        result.body.code,
      );
      expect(await state()).toEqual(before);
    },
  );
  it('line and aggregate overflow rejected before DB write', async () => {
    await prisma.productVariant.update({
      where: { id: input.items[0].variantId },
      data: { price: '999999999999.00' },
    });
    const result = await preview({
      ...input,
      items: [{ ...input.items[0], expectedUnitPrice: '999999999999' }],
    }).expect(400);
    expect(result.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'MONEY_LIMIT_EXCEEDED' },
    });
    expect(await prisma.order.count({ where: { buyerId } })).toBe(0);
  });
  it('Auth/role checks return safe no-store envelopes', async () => {
    expect(
      (await http().post('/checkout/preview').send(input).expect(401)).body
        .code,
    ).toBe('UNAUTHORIZED');
    for (const token of [sellerToken, adminToken]) {
      const result = await preview(input, token).expect(403);
      expect(result.body.code).toBe('FORBIDDEN');
      expect(result.headers['cache-control']).toBe('no-store');
    }
    await prisma.user.update({
      where: { id: buyerId },
      data: { isActive: false },
    });
    expect((await preview().expect(401)).body.code).toBe('UNAUTHORIZED');
  });

  // Fixture-only receipts: no claim these tests create a real Order via runtime.
  async function storedReceipt() {
    const pending = await prisma.checkout.create({
      data: {
        buyerId,
        idempotencyKey: key,
        requestHash: 'a'.repeat(64),
        hashVersion: 1,
      },
    });
    const receipt = {
      checkoutId: pending.id,
      status: 'COMPLETED',
      orders: [
        {
          id: 1,
          orderNumber: `${marker}-fixture-${sequence++}`,
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
    };
    await prisma.checkout.update({
      where: { id: pending.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        receiptVersion: 1,
        receiptJson: receipt,
      },
    });
    return receipt;
  }
  it('lookup returns immutable receipt after deleting Cart/address, without writes', async () => {
    const receipt = await storedReceipt();
    await prisma.cartItem.deleteMany({ where: { cartId } });
    await prisma.userAddress.delete({ where: { id: addressId } });
    await prisma.productVariant.update({
      where: { id: input.items[0].variantId },
      data: { price: '20000.00', stock: 0 },
    });
    const before = await state();
    const result = await lookup().expect(200);
    expect(result.body).toEqual({ ...receipt, replayed: true });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(await state()).toEqual(before);
  });
  it('absent and cross-Buyer keys both return 404; never disclose key/hash/receipt', async () => {
    const before = await lookup().expect(404);
    await storedReceipt();
    const other = await user();
    const after = await lookup(key, other.token).expect(404);
    expect(before.body).toEqual(after.body);
    expect(JSON.stringify(after.body)).not.toContain(key);
  });
  it.each([null, 3])(
    'unknown hash provenance %s remains legacy 409, not recreated',
    async (hashVersion) => {
      const row = await prisma.checkout.create({
        data: {
          buyerId,
          idempotencyKey: key,
          requestHash: 'legacy',
          hashVersion,
        },
      });
      expect((await lookup().expect(409)).body.code).toBe(
        'CHECKOUT_LEGACY_REVIEW_REQUIRED',
      );
      expect(
        await prisma.checkout.findUnique({ where: { id: row.id } }),
      ).toEqual(row);
    },
  );
  it('visible PENDING gives Retry-After without resetting data', async () => {
    const row = await prisma.checkout.create({
      data: {
        buyerId,
        idempotencyKey: key,
        requestHash: 'a'.repeat(64),
        hashVersion: 1,
      },
    });
    const result = await lookup().expect(409);
    expect(result.body.code).toBe('CHECKOUT_IN_PROGRESS');
    expect(result.headers['retry-after']).toBe('2');
    expect(await prisma.checkout.findUnique({ where: { id: row.id } })).toEqual(
      row,
    );
  });
  it('corrupt new receipt returns safe 500 and is not rebuilt from Orders', async () => {
    const row = await prisma.checkout.create({
      data: {
        buyerId,
        idempotencyKey: key,
        requestHash: 'a'.repeat(64),
        hashVersion: 1,
        status: 'COMPLETED',
        completedAt: new Date(),
        receiptVersion: 1,
        receiptJson: { secret: 'DO_NOT_ECHO_RECEIPT' },
      },
    });
    const result = await lookup().expect(500);
    expect(result.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Không thể đọc kết quả đặt hàng đã lưu.',
    });
    expect(await prisma.checkout.findUnique({ where: { id: row.id } })).toEqual(
      row,
    );
  });
  it('lookup requires header key, rejects unsupported query/body and never puts keys in URLs', async () => {
    expect(
      (
        await http()
          .get('/checkouts/by-key')
          .set('Authorization', buyerToken)
          .expect(400)
      ).body.code,
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await lookup('too_short').expect(400)).body.code).toBe(
      'VALIDATION_ERROR',
    );
    await lookup().query({ key }).expect(400);
    const lookupBody = JSON.stringify({ key });
    await lookup()
      .set('Content-Type', 'application/json')
      .set('Content-Length', String(Buffer.byteLength(lookupBody)))
      .send(lookupBody)
      .expect(400);
    const chunked = await streamBody(
      '/CHECKOUTS/BY-KEY/',
      Buffer.from(lookupBody),
      undefined,
      'GET',
    );
    expect(chunked.status).toBe(400);
    expect(chunked.body.code).toBe('VALIDATION_ERROR');
    expect(chunked.headers['cache-control']).toBe('no-store');
    await preview().query({ injected: true }).expect(400);
  });
  it('rate limits preview and lookup independently; another Buyer has its own buckets', async () => {
    for (let i = 0; i < 20; i++) await preview().expect(200);
    const limited = await preview().expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) await lookup().expect(404);
    await lookup().expect(429);
    await lookup(key, (await user()).token).expect(404);
  });

  async function streamBody(
    path: string,
    data: Buffer,
    encoding?: string,
    method = 'POST',
  ) {
    return new Promise<{
      status: number;
      body: { code?: string };
      headers: Record<string, unknown>;
    }>((resolve, reject) => {
      const req = nodeRequest(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: buyerToken,
            Origin: process.env.FRONTEND_URL || 'http://localhost:5173',
            ...(method === 'GET' ? { 'Transfer-Encoding': 'chunked' } : {}),
            ...(encoding ? { 'Content-Encoding': encoding } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode!,
                body: JSON.parse(Buffer.concat(chunks).toString()),
                headers: res.headers,
              });
            } catch (error) {
              reject(error);
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.setTimeout(5000, () =>
        req.destroy(new Error('Test HTTP deadline exceeded')),
      );
      // No Content-Length: exercise the actual chunked request stream.
      req.write(data.subarray(0, Math.ceil(data.length / 2)));
      req.end(data.subarray(Math.ceil(data.length / 2)));
    });
  }
  it('streaming JSON >64 KiB and compressed >64 KiB rejected before service', async () => {
    const spy = vi.spyOn(app.get(CheckoutReadService), 'preview');
    const oversized = Buffer.from(
      JSON.stringify({ ...input, padding: 's'.repeat(70_000) }),
    );
    for (const [path, body, encoding] of [
      ['/checkout/preview', oversized, undefined],
      ['/CHECKOUT/PREVIEW/', gzipSync(oversized), 'gzip'],
    ] as const) {
      const result = await streamBody(path, body, encoding);
      expect(result.status).toBe(413);
      expect(result.body.code).toBe('REQUEST_TOO_LARGE');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['access-control-allow-origin']).toBe(
        process.env.FRONTEND_URL || 'http://localhost:5173',
      );
    }
    expect(spy).not.toHaveBeenCalled();
  });
  it('valid compressed JSON reaches runtime normalizer; malformed JSON never leaks body', async () => {
    expect(
      (
        await streamBody(
          '/checkout/preview',
          gzipSync(Buffer.from(JSON.stringify(input))),
          'gzip',
        )
      ).status,
    ).toBe(200);
    const result = await streamBody(
      '/checkout/preview',
      Buffer.from('{"private":"DO_NOT_ECHO_BODY"'),
    );
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(result.body)).not.toContain('DO_NOT_ECHO_BODY');
    await http()
      .post('/checkout/preview')
      .set('Authorization', buyerToken)
      .type('form')
      .send('addressId=1')
      .expect(400);
  });
  it('Checkout parser does not impose its limit on pre-existing JSON routes', async () => {
    // A malformed payload alone is insufficient: it returns 400 even when a
    // parser regression silently drops the whole body. Prove a valid body too.
    await http()
      .post('/auth/register')
      .send({
        email: `${marker}-${sequence++}@example.com`,
        password: 'StrongPass123!',
      })
      .expect(201);
    const result = await http()
      .post('/auth/login')
      .send({ email: 'x'.repeat(70_000), password: 'unused' });
    expect(result.status).toBe(400);
    expect(result.body.code).not.toBe('REQUEST_TOO_LARGE');
  });
  it('Swagger documents runtime endpoints, DTO limits, price and header format', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(
      document.paths['/checkout/preview']?.post?.responses['200'],
    ).toBeDefined();
    expect(document.paths['/checkouts/by-key']?.get?.parameters).toContainEqual(
      expect.objectContaining({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
      }),
    );
    const schemas = document.components!.schemas!;
    expect(schemas.CheckoutPreviewRequestDto).toMatchObject({
      properties: {
        items: { minItems: 1, maxItems: 50 },
        paymentProvider: { enum: ['COD', 'VNPAY'] },
      },
    });
    expect(schemas.CheckoutItemDto).toMatchObject({
      properties: {
        quantity: { minimum: 1, maximum: 99 },
        expectedUnitPrice: { type: 'string' },
      },
    });
    expect(document.paths['/checkouts']?.post?.responses['201']).toBeDefined();
    expect(document.paths['/checkouts']?.post?.responses['200']).toBeDefined();
    expect(document.paths['/checkouts']?.post?.parameters).toContainEqual(
      expect.objectContaining({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
      }),
    );
  });
});
