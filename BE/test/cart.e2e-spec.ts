import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { CartService } from '../src/cart/cart.service.js';
import type { CartResponseDto } from '../src/cart/cart.dto.js';

describe('Buyer Cart API (e2e)', () => {
  let app: INestApplication<App>;
  let app2: INestApplication<App>;
  let prisma: PrismaService;
  let prisma2: PrismaService;
  let buyer: number;
  let token: string;
  let sellerToken: string;
  let adminToken: string;
  let sellerId: number;
  let storeId: number;
  let otherStoreId: number;
  let rootId: number;
  let categoryId: number;
  let brandId: number;
  let serial = 0;
  const marker = `cart-e2e-${Date.now()}`;
  const http = (application = app) => request(application.getHttpServer());
  const put = (
    id: number,
    quantity: unknown,
    auth = token,
    application = app,
  ) =>
    http(application)
      .put(`/cart/items/${id}`)
      .set('Authorization', auth)
      .send({ quantity });
  const get = (auth = token) => http().get('/cart').set('Authorization', auth);
  const del = (id: number, auth = token, application = app) =>
    http(application).delete(`/cart/items/${id}`).set('Authorization', auth);

  async function actor(role = Role.USER as Role) {
    const user = await prisma.user.create({
      data: {
        email: `${marker}-${serial++}@example.com`,
        passwordHash: 'unused-test-only',
        role,
      },
    });
    const config = app.get(ConfigService);
    const signed = app.get(JwtService).sign(
      { sub: user.id, email: user.email, role, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { id: user.id, token: `Bearer ${signed}` };
  }

  beforeAll(async () => {
    for (const index of [1, 2]) {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const application = module.createNestApplication();
      configureApp(application);
      await application.init();
      if (index === 1) app = application;
      else app2 = application;
    }
    prisma = app.get(PrismaService);
    prisma2 = app2.get(PrismaService);
    const seller = await actor(Role.SELLER);
    sellerId = seller.id;
    sellerToken = seller.token;
    adminToken = (await actor(Role.ADMIN)).token;
    storeId = (
      await prisma.store.create({
        data: { name: `${marker}-store`, sellerId, status: 'ACTIVE' },
      })
    ).id;
    const otherSeller = await actor(Role.SELLER);
    otherStoreId = (
      await prisma.store.create({
        data: {
          name: `${marker}-other-store`,
          sellerId: otherSeller.id,
          status: 'ACTIVE',
        },
      })
    ).id;
    rootId = (
      await prisma.category.create({
        data: { name: 'Cart root', slug: `${marker}-root` },
      })
    ).id;
    categoryId = (
      await prisma.category.create({
        data: { name: 'Cart leaf', slug: `${marker}-leaf`, parentId: rootId },
      })
    ).id;
    brandId = (
      await prisma.brand.create({ data: { name: 'Cart brand', slug: marker } })
    ).id;
  });

  beforeEach(async () => {
    const user = await actor();
    buyer = user.id;
    token = user.token;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) {
      await prisma.cartItem.deleteMany({
        where: { cart: { user: { email: { startsWith: marker } } } },
      });
      await prisma.product.deleteMany({
        where: { store: { name: { startsWith: marker } } },
      });
      await prisma.store.deleteMany({
        where: { name: { startsWith: marker } },
      });
      await prisma.category.deleteMany({ where: { slug: `${marker}-leaf` } });
      await prisma.category.deleteMany({ where: { slug: `${marker}-root` } });
      await prisma.brand.deleteMany({ where: { slug: marker } });
      await prisma.user.deleteMany({
        where: { email: { startsWith: marker } },
      });
    }
    if (app2) await app2.close();
    if (app) await app.close();
  });

  // Public-policy fixtures, not claims of completing moderation/checkout flows.
  async function product(price = '10000.00', stock = 10, store = storeId) {
    const p = await prisma.product.create({
      data: {
        storeId: store,
        categoryId,
        brandId,
        name: 'Public cart headphones',
        description: 'Safe public description',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: { url: '/uploads/cart-fixture.png', isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    const v = await prisma.productVariant.create({
      data: {
        productId: p.id,
        storeId: store,
        skuCode: `${marker}-${serial++}`,
        price,
        stock,
        optionSignature: 'default',
      },
    });
    return { productId: p.id, variantId: v.id };
  }
  const response = (body: unknown) => body as CartResponseDto;

  it('GET empty does not create a Cart; DELETE missing is also a no-op', async () => {
    const res = await get().expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      groups: [],
      unavailableItems: [],
      lineCount: 0,
      totalQuantity: 0,
      purchasableSubtotal: '0.00',
    });
    await del(2147483647).expect(204);
    expect(await prisma.cart.count({ where: { userId: buyer } })).toBe(0);
  });

  it('PUT returns the full cart, is absolute/idempotent and does not touch inventory/search/order', async () => {
    const { productId, variantId } = await product();
    const initialProduct = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    await put(variantId, 2).expect(200);
    const before = await prisma.cartItem.findFirstOrThrow({
      where: { variantId, cart: { userId: buyer } },
    });
    const res = response((await put(variantId, 2).expect(200)).body);
    expect(res).toMatchObject({
      lineCount: 1,
      totalQuantity: 2,
      purchasableSubtotal: '20000.00',
      unavailableItems: [],
    });
    expect(res.groups[0].items[0]).toEqual({
      variantId,
      quantity: 2,
      productId,
      productName: 'Public cart headphones',
      imageUrl: '/uploads/cart-fixture.png',
      optionValues: [],
      currentUnitPrice: '10000.00',
      stock: 10,
      available: true,
      unavailableReason: null,
    });
    expect(
      await prisma.cartItem.findUnique({ where: { id: before.id } }),
    ).toEqual(before);
    expect((await put(variantId, 3).expect(200)).body.totalQuantity).toBe(3);
    expect(
      (
        await prisma.productVariant.findUniqueOrThrow({
          where: { id: variantId },
        })
      ).stock,
    ).toBe(10);
    expect(
      await prisma.product.findUnique({ where: { id: productId } }),
    ).toEqual(initialProduct);
    expect(await prisma.searchOutbox.count({ where: { productId } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { variantId } })).toBe(0);
    expect(await prisma.checkout.count({ where: { buyerId: buyer } })).toBe(0);
  });

  it('groups by Store, computes exact large Decimal totals and refreshes canonical prices', async () => {
    const a = await product('999999999999.00', 99);
    const b = await product('12345.00', 99, otherStoreId);
    await put(a.variantId, 99).expect(200);
    const res = response((await put(b.variantId, 99).expect(200)).body);
    expect(res.groups.map((g) => g.store.id)).toEqual([storeId, otherStoreId]);
    expect(res).toMatchObject({
      lineCount: 2,
      totalQuantity: 198,
      purchasableSubtotal: '99000001222056.00',
    });
    await prisma.productVariant.update({
      where: { id: b.variantId },
      data: { price: '1.00' },
    });
    expect((await get().expect(200)).body.purchasableSubtotal).toBe(
      '99000000000000.00',
    );
  });

  it('Cart reads/deletes only the actor cart, even when the Variant is shared', async () => {
    const p = await product();
    const other = await actor();
    await put(p.variantId, 2).expect(200);
    await put(p.variantId, 3, other.token).expect(200);
    expect((await get(other.token).expect(200)).body.totalQuantity).toBe(3);
    await del(p.variantId).expect(204);
    await del(p.variantId).expect(204);
    expect((await get().expect(200)).body.lineCount).toBe(0);
    expect((await get(other.token).expect(200)).body.totalQuantity).toBe(3);
  });

  it('stock is not reserved: two Buyers may add the last item, later GET reflects shortage', async () => {
    const p = await product('12000', 1);
    const other = await actor();
    await Promise.all([
      put(p.variantId, 1).expect(200),
      put(p.variantId, 1, other.token, app2).expect(200),
    ]);
    expect(
      (
        await prisma.productVariant.findUniqueOrThrow({
          where: { id: p.variantId },
        })
      ).stock,
    ).toBe(1);
    await prisma.productVariant.update({
      where: { id: p.variantId },
      data: { stock: 0 },
    });
    const res = response((await get().expect(200)).body);
    expect(res.groups[0].items[0]).toMatchObject({
      available: false,
      unavailableReason: 'OUT_OF_STOCK',
      stock: 0,
    });
    expect(res.purchasableSubtotal).toBe('0.00');
    await put(p.variantId, 1)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('INSUFFICIENT_STOCK'));
  });

  it('existing shortage is retained/countable but excluded from totals; lower quantity is allowed', async () => {
    const p = await product();
    await put(p.variantId, 5).expect(200);
    await prisma.productVariant.update({
      where: { id: p.variantId },
      data: { stock: 3 },
    });
    const res = response((await get().expect(200)).body);
    expect(res).toMatchObject({
      lineCount: 1,
      totalQuantity: 5,
      purchasableSubtotal: '0.00',
    });
    expect(res.groups[0].items[0].unavailableReason).toBe('INSUFFICIENT_STOCK');
    expect(
      (await put(p.variantId, 3).expect(200)).body.purchasableSubtotal,
    ).toBe('30000.00');
  });

  it('mixed public/private/unavailable lines count fully but only purchasable lines contribute money', async () => {
    const good = await product('12345', 10);
    const hidden = await product('999999', 10);
    const short = await product('55555', 10, otherStoreId);
    await put(good.variantId, 2).expect(200);
    await put(hidden.variantId, 2).expect(200);
    await put(short.variantId, 3).expect(200);
    await prisma.product.update({
      where: { id: hidden.productId },
      data: { sellerStatus: 'HIDDEN' },
    });
    await prisma.productVariant.update({
      where: { id: short.variantId },
      data: { stock: 2 },
    });
    const res = response((await get().expect(200)).body);
    expect(res).toMatchObject({
      lineCount: 3,
      totalQuantity: 7,
      purchasableSubtotal: '24690.00',
    });
    expect(res.groups.map((group) => group.purchasableSubtotal)).toEqual([
      '24690.00',
      '0.00',
    ]);
    expect(res.unavailableItems).toEqual([
      {
        variantId: hidden.variantId,
        quantity: 2,
        available: false,
        unavailableReason: 'PRODUCT_UNAVAILABLE',
      },
    ]);
  });

  it.each([
    'hidden',
    'draft',
    'frozen',
    'store',
    'seller',
    'root',
    'brand',
    'required',
    'image',
    'shipping',
  ])(
    'hides all private metadata and rejects PUT when invalidated by %s',
    async (reason) => {
      const p = await product();
      await put(p.variantId, 2).expect(200);
      try {
        if (reason === 'hidden')
          await prisma.product.update({
            where: { id: p.productId },
            data: { sellerStatus: 'HIDDEN' },
          });
        if (reason === 'draft')
          await prisma.product.update({
            where: { id: p.productId },
            data: {
              sellerStatus: 'DRAFT',
              moderationStatus: 'NOT_SUBMITTED',
              name: 'PRIVATE DRAFT SECRET',
            },
          });
        if (reason === 'frozen')
          await prisma.product.update({
            where: { id: p.productId },
            data: { moderationStatus: 'FROZEN' },
          });
        if (reason === 'store')
          await prisma.store.update({
            where: { id: storeId },
            data: { status: 'SUSPENDED' },
          });
        if (reason === 'seller')
          await prisma.user.update({
            where: { id: sellerId },
            data: { isActive: false },
          });
        if (reason === 'root')
          await prisma.category.update({
            where: { id: rootId },
            data: { isActive: false },
          });
        if (reason === 'brand')
          await prisma.brand.update({
            where: { id: brandId },
            data: { isActive: false },
          });
        if (reason === 'required')
          await prisma.categoryAttributeDefinition.create({
            data: {
              categoryId,
              name: 'Required',
              slug: 'required',
              dataType: 'TEXT',
              isRequired: true,
            },
          });
        if (reason === 'image')
          await prisma.productImage.deleteMany({
            where: { productId: p.productId },
          });
        if (reason === 'shipping')
          await prisma.productShippingProfile.delete({
            where: { productId: p.productId },
          });
        const res = response((await get().expect(200)).body);
        expect(res).toEqual({
          groups: [],
          unavailableItems: [
            {
              variantId: p.variantId,
              quantity: 2,
              available: false,
              unavailableReason: 'PRODUCT_UNAVAILABLE',
            },
          ],
          lineCount: 1,
          totalQuantity: 2,
          purchasableSubtotal: '0.00',
        });
        await put(p.variantId, 1)
          .expect(409)
          .expect(({ body }) =>
            expect(body.code).toBe('VARIANT_NOT_AVAILABLE'),
          );
        await del(p.variantId).expect(204);
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
          where: { id: rootId },
          data: { isActive: true },
        });
        await prisma.brand.update({
          where: { id: brandId },
          data: { isActive: true },
        });
        await prisma.categoryAttributeDefinition.deleteMany({
          where: { categoryId, slug: 'required' },
        });
      }
    },
  );

  it.each(['inactive', 'zero-price', 'missing-options'])(
    'selected Variant %s is not valid merely because another Variant is public',
    async (reason) => {
      const p = await product();
      await put(p.variantId, 2).expect(200);
      if (reason === 'inactive')
        await prisma.productVariant.update({
          where: { id: p.variantId },
          data: { isActive: false },
        });
      if (reason === 'zero-price')
        await prisma.productVariant.update({
          where: { id: p.variantId },
          data: { price: 0 },
        });
      const sibling = await prisma.productVariant.create({
        data: {
          productId: p.productId,
          storeId,
          skuCode: `${marker}-${serial++}`,
          price: '10000',
          stock: 10,
          optionSignature: 'sibling',
        },
      });
      if (reason === 'missing-options') {
        const group = await prisma.productOptionGroup.create({
          data: { productId: p.productId, name: 'Color' },
        });
        const value = await prisma.productOptionValue.create({
          data: { groupId: group.id, productId: p.productId, value: 'Black' },
        });
        await prisma.productVariantOptionValue.create({
          data: {
            variantId: sibling.id,
            productId: p.productId,
            optionGroupId: group.id,
            optionValueId: value.id,
          },
        });
      }
      const res = response((await get().expect(200)).body);
      expect(res.unavailableItems).toEqual([]);
      expect(res.groups[0].items[0]).toEqual({
        variantId: p.variantId,
        quantity: 2,
        productId: p.productId,
        productName: 'Public cart headphones',
        imageUrl: '/uploads/cart-fixture.png',
        available: false,
        unavailableReason: 'VARIANT_UNAVAILABLE',
      });
      expect(res.purchasableSubtotal).toBe('0.00');
      await put(p.variantId, 1).expect(409);
    },
  );

  it('returns selected option labels in group order and supports null Brand', async () => {
    const p = await product();
    await prisma.product.update({
      where: { id: p.productId },
      data: { brandId: null },
    });
    for (const [name, label, position] of [
      ['Size', 'M', 1],
      ['Color', 'Black', 0],
    ] as const) {
      const group = await prisma.productOptionGroup.create({
        data: { productId: p.productId, name, position },
      });
      const value = await prisma.productOptionValue.create({
        data: { groupId: group.id, productId: p.productId, value: label },
      });
      await prisma.productVariantOptionValue.create({
        data: {
          variantId: p.variantId,
          productId: p.productId,
          optionGroupId: group.id,
          optionValueId: value.id,
        },
      });
    }
    expect(
      (await put(p.variantId, 1).expect(200)).body.groups[0].items[0]
        .optionValues,
    ).toEqual(['Black', 'M']);
  });

  it('rejects missing Variant and insufficient stock without creating a cart', async () => {
    await put(2147483647, 1)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('VARIANT_NOT_AVAILABLE'));
    const p = await product('10000', 1);
    await put(p.variantId, 2)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('INSUFFICIENT_STOCK'));
    expect(await prisma.cart.count({ where: { userId: buyer } })).toBe(0);
  });

  it('enforces Buyer role and active JWT identity, not client-owned IDs', async () => {
    const p = await product();
    await http()
      .get('/cart')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('UNAUTHORIZED'));
    for (const auth of [sellerToken, adminToken]) {
      await get(auth).expect(403);
      await put(p.variantId, 1, auth).expect(403);
      await del(p.variantId, auth).expect(403);
    }
    const config = app.get(ConfigService);
    const expired = app.get(JwtService).sign(
      { sub: buyer, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: -10,
      },
    );
    await get(`Bearer ${expired}`).expect(401);
    await prisma.user.update({
      where: { id: buyer },
      data: { isActive: false },
    });
    await get().expect(401);
    await put(p.variantId, 1).expect(401);
    await del(p.variantId).expect(401);
  });

  it('rejects self-purchase defensively without changing single-role Auth', async () => {
    // The DB permits legacy/corrupt USER-owned Store; public UI never grants Seller role.
    const own = await prisma.store.create({
      data: { sellerId: buyer, name: `${marker}-self`, status: 'ACTIVE' },
    });
    const p = await product('10000', 10, own.id);
    await put(p.variantId, 1)
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('SELF_PURCHASE_FORBIDDEN'));
    await prisma.cart.create({
      data: {
        userId: buyer,
        items: { create: { variantId: p.variantId, quantity: 1 } },
      },
    });
    expect((await get().expect(200)).body.groups).toEqual([]);
    await del(p.variantId).expect(204);
    await prisma.product.delete({ where: { id: p.productId } });
  });

  it('strictly validates quantity, IDs, unknown body and query fields', async () => {
    const p = await product('10000', 100);
    for (const quantity of [0, -1, 100, 1.5, '2', null, true])
      await put(p.variantId, quantity)
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('VALIDATION_ERROR'));
    await http()
      .put(`/cart/items/${p.variantId}`)
      .set('Authorization', token)
      .send({ quantity: 1, userId: buyer })
      .expect(400);
    await http()
      .put(`/cart/items/${p.variantId}`)
      .set('Authorization', token)
      .send({})
      .expect(400);
    for (const id of ['1e2', '1.0', '0', '-1', '2147483648', 'abc']) {
      await http()
        .put(`/cart/items/${id}`)
        .set('Authorization', token)
        .send({ quantity: 1 })
        .expect(400);
      await http()
        .delete(`/cart/items/${id}`)
        .set('Authorization', token)
        .expect(400);
    }
    await get().query({ userId: buyer }).expect(400);
    await del(p.variantId).send({ cartId: 1 }).expect(400);
    await put(p.variantId, 99).expect(200);
  });

  it('uses one shared GET/PUT/DELETE rate bucket per Buyer with Retry-After', async () => {
    const p = await product();
    const limit = Number(
      app.get(ConfigService).get('CART_RATE_LIMIT_PER_MINUTE', 60),
    );
    for (let i = 0; i < limit - 2; i++) await get().expect(200);
    await put(p.variantId, 1).expect(200);
    await del(p.variantId).expect(204);
    const res = await get().expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toBe('no-store');
    await put(p.variantId, 1).expect(429);
    expect(
      await prisma.cartItem.count({ where: { cart: { userId: buyer } } }),
    ).toBe(0);
    await get((await actor()).token).expect(200);
  });

  it('concurrent first writes across two application instances create one Cart/line', async () => {
    expect(prisma2).not.toBe(prisma);
    const p = await product();
    await Promise.all([
      put(p.variantId, 2).expect(200),
      put(p.variantId, 3, token, app2).expect(200),
    ]);
    expect(await prisma.cart.count({ where: { userId: buyer } })).toBe(1);
    const rows = await prisma.cartItem.findMany({
      where: { cart: { userId: buyer } },
    });
    expect(rows).toHaveLength(1);
    expect([2, 3]).toContain(rows[0].quantity);
  });

  it('keeps Address and Cart available together across two application instances', async () => {
    expect(prisma2).not.toBe(prisma);
    const p = await product('12000.00', 10);
    const before = await prisma.product.findUniqueOrThrow({
      where: { id: p.productId },
      include: { variants: true },
    });
    const addressBody = {
      recipientName: 'Integration Buyer',
      phone: '0901234567',
      province: 'Test province',
      ward: 'Test ward',
      addressLine: 'Test address',
    };
    await Promise.all([
      http(app2)
        .post('/me/addresses')
        .set('Authorization', token)
        .send(addressBody)
        .expect(201),
      http(app2)
        .post('/me/addresses')
        .set('Authorization', token)
        .send({ ...addressBody, addressLine: 'Second test address' })
        .expect(201),
      put(p.variantId, 2).expect(200),
    ]);

    const addresses = await prisma.userAddress.findMany({
      where: { userId: buyer },
    });
    expect(addresses).toHaveLength(2);
    expect(addresses.filter((address) => address.isDefault)).toHaveLength(1);
    expect(addresses.every((address) => address.district === null)).toBe(true);
    await http()
      .get('/me/addresses')
      .set('Authorization', token)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(2));
    await http(app2)
      .get('/cart')
      .set('Authorization', token)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lineCount).toBe(1);
        expect(body.totalQuantity).toBe(2);
        expect(body.purchasableSubtotal).toBe('24000.00');
      });

    const other = await actor();
    await http(app2)
      .delete(`/me/addresses/${addresses[0].id}`)
      .set('Authorization', other.token)
      .expect(404);
    await del(p.variantId, other.token, app2).expect(204);
    expect((await get().expect(200)).body.totalQuantity).toBe(2);
    const after = await prisma.product.findUniqueOrThrow({
      where: { id: p.productId },
      include: { variants: true },
    });
    expect(after.version).toBe(before.version);
    expect(after.variants[0].stock).toBe(before.variants[0].stock);
    expect(
      await prisma.searchOutbox.count({ where: { productId: p.productId } }),
    ).toBe(0);
    expect(await prisma.checkout.count({ where: { buyerId: buyer } })).toBe(0);
  });

  it('concurrent distinct lines are not lost; PUT/DELETE yields a serial end state', async () => {
    const a = await product();
    const b = await product();
    await Promise.all([
      put(a.variantId, 1).expect(200),
      put(b.variantId, 2, token, app2).expect(200),
    ]);
    expect((await get().expect(200)).body.lineCount).toBe(2);
    await Promise.all([
      put(a.variantId, 3).expect(200),
      del(a.variantId, token, app2).expect(204),
    ]);
    const rows = await prisma.cartItem.findMany({
      where: { cart: { userId: buyer } },
    });
    expect(rows.filter((r) => r.variantId === b.variantId)).toHaveLength(1);
    const line = rows.find((r) => r.variantId === a.variantId);
    if (line) expect(line.quantity).toBe(3);
  });

  it('a failure after CartItem mutation rolls back the entire write', async () => {
    const p = await product();
    // Inject the post-write read fault; no HTTP mocking, real database transaction.
    const service = app.get(CartService);
    const spy = vi
      .spyOn(
        service as unknown as {
          read: (...args: unknown[]) => Promise<unknown>;
        },
        'read',
      )
      .mockRejectedValueOnce(new Error('test-only read failure'));
    try {
      await put(p.variantId, 2).expect(500);
      expect(await prisma.cart.count({ where: { userId: buyer } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
    await put(p.variantId, 2).expect(200);
    const secondSpy = vi
      .spyOn(
        service as unknown as {
          read: (...args: unknown[]) => Promise<unknown>;
        },
        'read',
      )
      .mockRejectedValueOnce(new Error('test-only update read failure'));
    try {
      await put(p.variantId, 4).expect(500);
      expect(
        (
          await prisma.cartItem.findFirstOrThrow({
            where: { variantId: p.variantId, cart: { userId: buyer } },
          })
        ).quantity,
      ).toBe(2);
    } finally {
      secondSpy.mockRestore();
    }
  });

  it('Swagger advertises Cart routes, response models and error codes', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(document.paths['/cart'].get?.responses['200']).toBeDefined();
    expect(
      document.paths['/cart/items/{variantId}'].put?.responses['409'],
    ).toBeDefined();
    expect(
      document.paths['/cart/items/{variantId}'].delete?.responses['204'],
    ).toBeDefined();
    expect(document.components?.schemas?.CartResponseDto).toBeDefined();
  });
});
