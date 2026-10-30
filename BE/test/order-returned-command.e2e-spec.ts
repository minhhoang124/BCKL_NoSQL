import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Role, type OrderStatus, type ProductVariant } from '@prisma/client';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Returned commands — real HTTP/PostgreSQL, two instances', () => {
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
    users: number[] = [],
    fixtureProductIds: number[] = [],
    fixtureCategoryIds: number[] = [],
    fixtureBrandIds: number[] = [];
  const previousRate = process.env.ORDER_COMMAND_RATE_PER_MINUTE;
  const key = () => marker + '-key-' + serial++;
  const returned = {
    reasonCode: 'RETURN_RECEIVED',
    reasonText: 'Returned in good condition',
    restockable: true,
    receiptReference: 'RECEIPT-A',
  };
  const damaged = {
    reasonCode: 'DAMAGED',
    reasonText: 'Broken',
    restockable: false,
    receiptReference: 'RECEIPT-B',
  };
  const post = (
    command = 'confirm-returned',
    body: unknown = returned,
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
  const sellerPost = (k = key(), instance = app, id = orderId) =>
    request(instance.getHttpServer())
      .post(`/seller/orders/${id}/confirm-returned`)
      .set('Authorization', seller.token)
      .set('Idempotency-Key', k)
      .send(returned);
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
  // Controlled failed/delivery fixture; the separate integration case below
  // creates its own Order and delivery history through real HTTP.
  async function fixture(status: OrderStatus = 'DELIVERY_FAILED') {
    const checkout = await prisma.checkout.create({
      data: {
        buyerId: buyer.id,
        idempotencyKey: key(),
        requestHash: 'legacy-controlled-fixture',
      },
    });
    checkouts.push(checkout.id);
    const order = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
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
      const item = await tx.orderItem.findFirstOrThrow({
        where: { orderId: order.id },
      });
      await tx.stockMovement.create({
        data: {
          orderItemId: item.id,
          variantId,
          type: 'CHECKOUT_DECREMENT',
          quantityDelta: -1,
          balanceAfter: 7,
          idempotencyKey: key(),
        },
      });
      await tx.deliveryAttempt.create({
        data: {
          orderId: order.id,
          deliveryAttempt: 1,
          trackingReference: 'WAYBILL',
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { currentDeliveryAttempt: 1, retryCount: 0 },
      });
      return order;
    });
    orders.push(order.id);
    return order.id;
  }
  async function state(id = orderId, selectedProductId = productId) {
    const order = await prisma.order.findUnique({ where: { id } });
    return {
      order,
      checkout: order
        ? await prisma.checkout.findUnique({ where: { id: order.checkoutId } })
        : null,
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
      product: await prisma.product.findUnique({
        where: { id: selectedProductId },
      }),
      variant: await prisma.productVariant.findFirst({
        where: { productId: selectedProductId },
        orderBy: { id: 'asc' },
      }),
      variants: await prisma.productVariant.findMany({
        where: { productId: selectedProductId },
        orderBy: { id: 'asc' },
      }),
      movements: await prisma.stockMovement.findMany({
        where: { variant: { productId: selectedProductId } },
        orderBy: { id: 'asc' },
      }),
      outbox: await prisma.searchOutbox.findMany({
        where: { productId: selectedProductId },
        orderBy: { id: 'asc' },
      }),
    };
  }

  // Isolated APPROVED listing with two real option-linked Variants. Stock 0
  // represents a controlled prior purchase, not a claim that shipping API ran.
  async function multiVariantFixture() {
    const root = await prisma.category.create({
      data: { name: 'Return root', slug: key() },
    });
    fixtureCategoryIds.push(root.id);
    const leaf = await prisma.category.create({
      data: { name: 'Return leaf', slug: key(), parentId: root.id },
    });
    fixtureCategoryIds.push(leaf.id);
    const brand = await prisma.brand.create({
      data: { name: 'Return brand', slug: key() },
    });
    fixtureBrandIds.push(brand.id);
    const attribute = await prisma.categoryAttributeDefinition.create({
      data: {
        categoryId: leaf.id,
        name: 'Material',
        slug: 'material',
        dataType: 'TEXT',
        isRequired: true,
      },
    });
    const product = await prisma.product.create({
      data: {
        storeId,
        categoryId: leaf.id,
        brandId: brand.id,
        name: 'Returned multi-variant product',
        description: 'Canonical returned description',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        version: 7,
        images: {
          create: [
            {
              url: '/uploads/returned-primary.jpg',
              sortOrder: 2,
              isPrimary: true,
            },
            { url: '/uploads/returned-secondary.jpg', sortOrder: 0 },
          ],
        },
        shippingProfile: { create: { packageWeightGrams: 250 } },
        attributeValues: {
          create: {
            attributeDefinitionId: attribute.id,
            textValue: 'Aluminium',
          },
        },
      },
    });
    fixtureProductIds.push(product.id);
    const group = await prisma.productOptionGroup.create({
      data: { productId: product.id, name: 'Color' },
    });
    const variants: (ProductVariant & {
      quantity: number;
      options: {
        groupId: number;
        groupName: string;
        valueId: number;
        value: string;
      }[];
    })[] = [];
    for (const [position, color] of ['Black', 'White'].entries()) {
      const value = await prisma.productOptionValue.create({
        data: {
          groupId: group.id,
          productId: product.id,
          value: color,
          position,
        },
      });
      const variant = await prisma.productVariant.create({
        data: {
          storeId,
          productId: product.id,
          skuCode: key(),
          optionSignature: `${group.id}:${value.id}`,
          price: position === 0 ? '10000' : '25000',
          stock: 0,
        },
      });
      await prisma.productVariantOptionValue.create({
        data: {
          variantId: variant.id,
          productId: product.id,
          optionGroupId: group.id,
          optionValueId: value.id,
        },
      });
      variants.push({
        ...variant,
        quantity: position + 2,
        options: [
          {
            groupId: group.id,
            groupName: 'Color',
            valueId: value.id,
            value: color,
          },
        ],
      });
    }
    const checkout = await prisma.checkout.create({
      data: {
        buyerId: buyer.id,
        idempotencyKey: key(),
        requestHash: 'controlled-multi-variant-return',
      },
    });
    checkouts.push(checkout.id);
    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          checkoutId: checkout.id,
          buyerId: buyer.id,
          storeId,
          orderNumber: key(),
          status: 'DELIVERY_FAILED',
          recipientNameSnapshot: 'Original recipient',
          phoneSnapshot: '0901234567',
          provinceSnapshot: 'Province',
          wardSnapshot: 'Ward',
          addressLineSnapshot: 'Original address',
          subtotal: '95000',
          shippingFee: 0,
          discountTotal: 0,
          total: '95000',
          payment: { create: { provider: 'COD', amount: '95000' } },
          items: {
            create: variants.map((variant) => ({
              productId: product.id,
              variantId: variant.id,
              productNameSnapshot: product.name,
              skuSnapshot: variant.skuCode,
              optionSnapshot: variant.options,
              unitPrice: variant.price,
              quantity: variant.quantity,
              lineTotal: variant.price.mul(variant.quantity),
            })),
          },
        },
      });
      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        orderBy: { id: 'asc' },
      });
      for (const item of items)
        await tx.stockMovement.create({
          data: {
            orderItemId: item.id,
            variantId: item.variantId,
            type: 'CHECKOUT_DECREMENT',
            quantityDelta: -item.quantity,
            balanceAfter: 0,
            idempotencyKey: key(),
          },
        });
      await tx.deliveryAttempt.create({
        data: {
          orderId: order.id,
          deliveryAttempt: 1,
          trackingReference: 'MULTI-WAYBILL',
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { currentDeliveryAttempt: 1, retryCount: 0 },
      });
      return order;
    });
    orders.push(created.id);
    return {
      id: created.id,
      productId: product.id,
      rootId: root.id,
      categoryId: leaf.id,
      brandId: brand.id,
    };
  }
  function expectedUpsert(
    fixture: Awaited<ReturnType<typeof multiVariantFixture>>,
    version: number,
  ) {
    // Independently written canonical fixture, NOT the production payload builder.
    return {
      productId: fixture.productId,
      version,
      name: 'Returned multi-variant product',
      description: 'Canonical returned description',
      categoryId: fixture.categoryId,
      categoryName: 'Return leaf',
      categoryPathIds: [fixture.rootId, fixture.categoryId],
      brandId: fixture.brandId,
      brandName: 'Return brand',
      attributes: { Material: ['Aluminium'] },
      imageUrls: [
        '/uploads/returned-primary.jpg',
        '/uploads/returned-secondary.jpg',
      ].map(image => new URL(image, process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${process.env.BACKEND_PORT ?? 3001}`).href),
      minPrice: '10000',
      maxPrice: '25000',
      inStock: true,
    };
  }
  async function assertMultiVariantRestore(
    fixture: Awaited<ReturnType<typeof multiVariantFixture>>,
    before: Awaited<ReturnType<typeof state>>,
  ) {
    const after = await state(fixture.id, fixture.productId);
    expect(after.order).toMatchObject({
      status: 'CANCELLED',
      cancellationReasonCode: 'RETURN_RECEIVED',
    });
    expect(after.payment).toMatchObject({
      provider: 'COD',
      status: 'CANCELLED',
      paidAt: null,
    });
    expect(after.payment!.amount).toEqual(before.payment!.amount);
    expect(after.product!.moderationStatus).toBe('APPROVED');
    expect(after.product!.sellerStatus).toBe('ACTIVE');
    expect(after.product!.version).toBe(before.product!.version + 1);
    expect(after.variants.map((variant) => variant.stock)).toEqual([2, 3]);
    const restores = after.movements.filter(
      (movement) => movement.type === 'CANCELLATION_RESTORE',
    );
    expect(after.movements).toHaveLength(before.movements.length + 2);
    expect(restores).toHaveLength(2);
    for (const item of before.items)
      expect(
        restores.find((movement) => movement.orderItemId === item.id),
      ).toMatchObject({
        variantId: item.variantId,
        quantityDelta: item.quantity,
        balanceAfter: item.quantity,
      });
    expect(after.outbox).toHaveLength(before.outbox.length + 1);
    expect(after.outbox.at(-1)).toMatchObject({
      operation: 'UPSERT',
      target: 'SEARCH_SERVICE',
      productId: fixture.productId,
      version: before.product!.version + 1,
      status: 'PENDING',
    });
    expect(after.outbox.at(-1)!.payload).toEqual(
      expectedUpsert(fixture, before.product!.version + 1),
    );
    expect(after.commands).toHaveLength(before.commands.length + 1);
    expect(after.commands.at(-1)!.status).toBe('SUCCEEDED');
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.history.at(-1)).toMatchObject({
      fromStatus: 'DELIVERY_FAILED',
      toStatus: 'CANCELLED',
      restockable: true,
      receiptReference: 'RECEIPT-A',
      deliveryAttempt: 1,
      trackingReference: 'MULTI-WAYBILL',
      commandId: after.commands.at(-1)!.id,
    });
    expect(after.attempts).toEqual(before.attempts);
    expect(after.checkout).toEqual(before.checkout);
    expect(after.items).toEqual(before.items);
    for (const field of [
      'recipientNameSnapshot',
      'phoneSnapshot',
      'provinceSnapshot',
      'districtSnapshot',
      'wardSnapshot',
      'addressLineSnapshot',
      'postalCodeSnapshot',
      'deliveryNoteSnapshot',
      'subtotal',
      'shippingFee',
      'discountTotal',
      'total',
    ] as const)
      expect(after.order![field]).toEqual(before.order![field]);
    return after;
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
    fixtureProductIds.push(productId);
    fixtureCategoryIds.push(categoryId);
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
    await prisma.user.update({
      where: { id: seller.id },
      data: { isActive: true, role: 'SELLER' },
    });
    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'ACTIVE' },
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
      await prisma.searchOutbox.deleteMany({
        where: { productId: { in: fixtureProductIds } },
      });
      await prisma.productVariant.deleteMany({
        where: { productId: { in: fixtureProductIds } },
      });
      await prisma.product.deleteMany({
        where: { id: { in: fixtureProductIds } },
      });
      // Delete leaves before their parents: Category.parent has ON DELETE RESTRICT.
      await prisma.category.deleteMany({
        where: { id: { in: fixtureCategoryIds }, parentId: { not: null } },
      });
      await prisma.category.deleteMany({
        where: { id: { in: fixtureCategoryIds } },
      });
      await prisma.brand.deleteMany({ where: { id: { in: fixtureBrandIds } } });
      await prisma.store.deleteMany({ where: { id: storeId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    await other?.close();
    await app?.close();
    if (previousRate === undefined)
      delete process.env.ORDER_COMMAND_RATE_PER_MINUTE;
    else process.env.ORDER_COMMAND_RATE_PER_MINUTE = previousRate;
  });
  it('real Checkout/Seller/delivery-failed → returned restores once, preserves snapshots and reads audit through detail', async () => {
    const originalProductId = productId,
      originalVariantId = variantId;
    const integrationProduct = await prisma.product.create({
      data: { storeId, categoryId, name: 'Return integration catalog fixture' },
    });
    fixtureProductIds.push(integrationProduct.id);
    const integrationVariant = await prisma.productVariant.create({
      data: {
        storeId,
        productId: integrationProduct.id,
        skuCode: key(),
        optionSignature: 'default',
        price: '10000.00',
        stock: 5,
      },
    });
    productId = integrationProduct.id;
    variantId = integrationVariant.id;
    try {
      // Catalog/address are labelled fixtures, not uploaded media or an index test.
      await prisma.product.update({
        where: { id: productId },
        data: {
          sellerStatus: 'ACTIVE',
          moderationStatus: 'APPROVED',
          images: {
            create: {
              url: '/uploads/returned-integration-fixture.jpg',
              isPrimary: true,
            },
          },
          shippingProfile: { create: { packageWeightGrams: 100 } },
        },
      });
      await prisma.productVariant.update({
        where: { id: variantId },
        data: { stock: 5 },
      });
      const address = await prisma.userAddress.create({
        data: {
          userId: buyer.id,
          recipientName: 'Return integration recipient',
          phone: '0901234567',
          province: 'Province',
          ward: 'Ward',
          addressLine: 'Original address',
        },
      });
      addresses.push(address.id);
      await request(app.getHttpServer())
        .put(`/cart/items/${variantId}`)
        .set('Authorization', buyer.token)
        .send({ quantity: 2 })
        .expect(200);
      carts.push(
        (await prisma.cart.findUniqueOrThrow({ where: { userId: buyer.id } }))
          .id,
      );
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
      orderId = created.body.orders[0].id;
      orders.push(orderId);
      const read = (actor = buyer, instance = app) =>
        request(instance.getHttpServer())
          .get(`${actor === seller ? '/seller' : ''}/orders/${orderId}`)
          .set('Authorization', actor.token);
      const original = (await read().expect(200)).body;
      for (const command of ['confirm', 'start-packing', 'ready-to-ship'])
        await request(app.getHttpServer())
          .post(`/seller/orders/${orderId}/${command}`)
          .set('Authorization', seller.token)
          .set('Idempotency-Key', key())
          .send({})
          .expect(200);
      const beforeShipping = await state();
      expect(beforeShipping.variant?.stock).toBe(3);
      const trackingReference = 'RETURN-INTEGRATION-WAYBILL';
      await post('ship', { trackingReference }).expect(200);
      await post('delivery-failed', {
        deliveryAttempt: 1,
        trackingReference,
        reasonCode: 'CUSTOMER_UNREACHABLE',
        reasonText: 'Controlled delivery failure',
      }).expect(200);
      const failed = await state();
      for (const field of [
        'variant',
        'product',
        'movements',
        'outbox',
        'payment',
      ] as const)
        expect(failed[field]).toEqual(beforeShipping[field]);
      expect(failed.order?.status).toBe('DELIVERY_FAILED');
      await prisma.userAddress.update({
        where: { id: address.id },
        data: { recipientName: 'Changed later' },
      });
      const k = key();
      const first = await sellerPost(k, other).expect(200);
      const after = await state();
      expect(after.variant?.stock).toBe(5);
      expect(after.product?.version).toBe(failed.product!.version + 1);
      expect(after.payment?.status).toBe('CANCELLED');
      expect(
        after.movements
          .filter((m) => m.orderItemId === after.items[0]!.id)
          .map((m) => m.quantityDelta),
      ).toEqual([-2, 2]);
      expect(after.outbox).toHaveLength(failed.outbox.length + 1);
      expect(after.outbox.at(-1)).toMatchObject({
        operation: 'UPSERT',
        productId,
        version: after.product!.version,
      });
      expect(after.outbox.at(-1)!.payload).toMatchObject({
        productId,
        version: after.product!.version,
        inStock: true,
        minPrice: '10000',
        maxPrice: '10000',
      });
      expect(after.attempts).toEqual(failed.attempts);
      expect(after.history.map((h) => h.toStatus)).toEqual([
        'PENDING_CONFIRMATION',
        'CONFIRMED',
        'PACKING',
        'READY_TO_SHIP',
        'SHIPPING',
        'DELIVERY_FAILED',
        'CANCELLED',
      ]);
      for (const actor of [buyer, seller]) {
        const detail = (await read(actor, other).expect(200)).body;
        expect(detail.status).toBe('CANCELLED');
        expect(detail.items).toEqual(original.items);
        expect(detail.shippingAddress).toEqual(original.shippingAddress);
        expect(detail.timeline.at(-1)).toMatchObject({
          restockable: true,
          receiptReference: 'RECEIPT-A',
          deliveryAttempt: 1,
          trackingReference,
        });
        expect(detail.timeline.at(-1).actorId).toBe(
          actor === buyer ? null : seller.id,
        );
        for (const field of ['requestHash', 'idempotencyKey', 'commands'])
          expect(detail).not.toHaveProperty(field);
      }
      expect((await sellerPost(k).expect(200)).body).toEqual({
        ...first.body,
        replayed: true,
      });
      expect(await state()).toEqual(after);
      await sellerPost().expect(409);
      await post('retry-delivery', { trackingReference }).expect(409);
      expect(await state()).toEqual(after);
      const replayCheckout = await request(other.getHttpServer())
        .post('/checkouts')
        .set('Authorization', buyer.token)
        .set('Idempotency-Key', checkoutKey)
        .send(payload)
        .expect(200);
      expect(replayCheckout.body.checkoutId).toBe(created.body.checkoutId);
      expect(await state()).toEqual(after);
    } finally {
      productId = originalProductId;
      variantId = originalVariantId;
    }
  });
  it('received/sellable commits cancellation, payment, audit, one ledger/version/outbox; replay survives another instance', async () => {
    const before = await state();
    const k = key();
    const first = await post('confirm-returned', returned, k);
    expect(first.status).toBe(200);
    const after = await state();
    expect(after.order).toMatchObject({
      status: 'CANCELLED',
      cancelledByType: 'ADMIN',
      cancellationReasonCode: 'RETURN_RECEIVED',
    });
    expect(after.payment?.status).toBe('CANCELLED');
    expect(after.variant?.stock).toBe(before.variant!.stock + 1);
    expect(after.product?.version).toBe(before.product!.version + 1);
    expect(after.product?.moderationStatus).toBe(
      before.product!.moderationStatus,
    );
    expect(after.outbox.length).toBe(before.outbox.length + 1);
    expect(after.outbox.at(-1)?.operation).toBe('DELETE');
    expect(after.outbox.at(-1)!.payload).toEqual({
      productId,
      version: before.product!.version + 1,
    });
    expect(after.history).toHaveLength(1);
    expect(after.history[0]).toMatchObject({
      restockable: true,
      receiptReference: 'RECEIPT-A',
      deliveryAttempt: 1,
      trackingReference: 'WAYBILL',
    });
    const replay = await post('confirm-returned', returned, k, other);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...first.body, replayed: true });
    expect(await state()).toEqual(after);
    const conflict = await post('confirm-returned', damaged, k);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await post()).status).toBe(409);
  });
  it('two option-linked Variants stock 0 → 2/3 produce one full UPSERT and immutable replay across instances', async () => {
    const fixture = await multiVariantFixture();
    const publicBefore = await request(app.getHttpServer())
      .get(`/products/${fixture.productId}`)
      .expect(200);
    expect(publicBefore.body).toMatchObject({
      inStock: false,
      minPrice: '10000',
      maxPrice: '25000',
    });
    const before = await state(fixture.id, fixture.productId);
    expect(before.variants.map((variant) => variant.stock)).toEqual([0, 0]);
    expect(before.product!.version).toBe(7);
    const k = key();
    const responses = await Promise.all([
      sellerPost(k, app, fixture.id),
      sellerPost(k, other, fixture.id),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const first = responses.find((response) => !response.body.replayed)!;
    expect(first.body.result.payment.amount).toBe('95000.00');
    const after = await assertMultiVariantRestore(fixture, before);
    expect(after.order).toMatchObject({
      cancelledByType: 'SELLER',
      cancelledById: seller.id,
    });
    expect(responses[0]!.body.commandId).toBe(responses[1]!.body.commandId);
    expect(responses[0]!.body.result).toEqual(responses[1]!.body.result);
    const publicAfter = await request(app.getHttpServer())
      .get(`/products/${fixture.productId}`)
      .expect(200);
    expect(publicAfter.body).toMatchObject({
      inStock: true,
      minPrice: '10000',
      maxPrice: '25000',
    });
    const replay = await sellerPost(k, other, fixture.id).expect(200);
    expect(replay.body).toEqual({ ...first.body, replayed: true });
    const newKey = await sellerPost(key(), app, fixture.id).expect(409);
    expect(newKey.body.code).toBe('INVALID_ORDER_TRANSITION');
    await post(
      'confirm-returned',
      returned,
      key(),
      other,
      admin.token,
      fixture.id,
    ).expect(409);
    expect(await state(fixture.id, fixture.productId)).toEqual(after);
  });
  it.each(['suspended-store', 'inactive-category'] as const)(
    'multi-Variant return restores stock but emits exact DELETE for %s',
    async (invalidity) => {
      const fixture = await multiVariantFixture();
      await request(app.getHttpServer())
        .get(`/products/${fixture.productId}`)
        .expect(200);
      if (invalidity === 'suspended-store')
        await prisma.store.update({
          where: { id: storeId },
          data: { status: 'SUSPENDED' },
        });
      else
        await prisma.category.update({
          where: { id: fixture.categoryId },
          data: { isActive: false },
        });
      await request(app.getHttpServer())
        .get(`/products/${fixture.productId}`)
        .expect(404);
      const before = await state(fixture.id, fixture.productId);
      const k = key();
      const first = await post(
        'confirm-returned',
        returned,
        k,
        app,
        admin.token,
        fixture.id,
      ).expect(200);
      const after = await state(fixture.id, fixture.productId);
      expect(after.order!.status).toBe('CANCELLED');
      expect(after.payment!.status).toBe('CANCELLED');
      expect(after.variants.map((variant) => variant.stock)).toEqual([2, 3]);
      expect(
        after.movements.filter(
          (movement) => movement.type === 'CANCELLATION_RESTORE',
        ),
      ).toHaveLength(2);
      expect(after.product!.moderationStatus).toBe('APPROVED');
      expect(after.product!.version).toBe(before.product!.version + 1);
      expect(after.outbox).toHaveLength(before.outbox.length + 1);
      expect(after.outbox.at(-1)).toMatchObject({
        operation: 'DELETE',
        productId: fixture.productId,
        version: before.product!.version + 1,
      });
      expect(after.outbox.at(-1)!.payload).toEqual({
        productId: fixture.productId,
        version: before.product!.version + 1,
      });
      expect(after.items).toEqual(before.items);
      expect(after.checkout).toEqual(before.checkout);
      await request(app.getHttpServer())
        .get(`/products/${fixture.productId}`)
        .expect(404);
      const replay = await post(
        'confirm-returned',
        returned,
        k,
        other,
        admin.token,
        fixture.id,
      ).expect(200);
      expect(replay.body).toEqual({ ...first.body, replayed: true });
      expect(await state(fixture.id, fixture.productId)).toEqual(after);
    },
  );
  it.each(['CANCELLATION_RESTORE', 'RETURN_RESTORE'] as const)(
    'prior %s on the second Item rejects all restoration without mutation',
    async (type) => {
      const fixture = await multiVariantFixture();
      const item = (await state(fixture.id, fixture.productId)).items[1]!;
      await prisma.productVariant.update({
        where: { id: item.variantId },
        data: { stock: item.quantity },
      });
      await prisma.stockMovement.create({
        data: {
          variantId: item.variantId,
          orderItemId: item.id,
          type,
          quantityDelta: item.quantity,
          balanceAfter: item.quantity,
          idempotencyKey: key(),
        },
      });
      const before = await state(fixture.id, fixture.productId);
      const response = await post(
        'confirm-returned',
        returned,
        key(),
        app,
        admin.token,
        fixture.id,
      ).expect(409);
      expect(response.body.code).toBe('ORDER_INVENTORY_REVIEW_REQUIRED');
      expect(await state(fixture.id, fixture.productId)).toEqual(before);
    },
  );
  it('Product version overflow rolls back both Variant restores, ledger and command claim', async () => {
    const fixture = await multiVariantFixture();
    await prisma.product.update({
      where: { id: fixture.productId },
      data: { version: 2147483647 },
    });
    const before = await state(fixture.id, fixture.productId);
    const response = await post(
      'confirm-returned',
      returned,
      key(),
      other,
      admin.token,
      fixture.id,
    ).expect(409);
    expect(response.body.code).toBe('INVENTORY_STATE_CONFLICT');
    expect(await state(fixture.id, fixture.productId)).toEqual(before);
    expect(
      await prisma.orderCommand.count({ where: { orderId: fixture.id } }),
    ).toBe(0);
  });
  it('last legal Product version increments to MAX_INT exactly once; replay stays at the boundary', async () => {
    const fixture = await multiVariantFixture();
    await prisma.product.update({
      where: { id: fixture.productId },
      data: { version: 2147483646 },
    });
    const before = await state(fixture.id, fixture.productId);
    const k = key();
    await post(
      'confirm-returned',
      returned,
      k,
      app,
      admin.token,
      fixture.id,
    ).expect(200);
    const after = await assertMultiVariantRestore(fixture, before);
    expect(after.product!.version).toBe(2147483647);
    await post(
      'confirm-returned',
      returned,
      k,
      other,
      admin.token,
      fixture.id,
    ).expect(200);
    expect(await state(fixture.id, fixture.productId)).toEqual(after);
  });
  it.each(['DAMAGED', 'LOST'])(
    '%s closes without touching stock/version/outbox',
    async (reasonCode) => {
      const body =
        reasonCode === 'LOST'
          ? { ...damaged, reasonCode, receiptReference: null }
          : damaged;
      const before = await state();
      expect((await post('confirm-returned', body)).status).toBe(200);
      const after = await state();
      expect(after.order?.status).toBe('CANCELLED');
      expect(after.payment?.status).toBe('CANCELLED');
      expect(after.variant).toEqual(before.variant);
      expect(after.product).toEqual(before.product);
      expect(after.outbox).toEqual(before.outbox);
      expect(after.movements).toEqual(before.movements);
      expect(after.history[0]).toMatchObject({
        restockable: false,
        receiptReference: body.receiptReference,
        reasonCode,
      });
    },
  );
  it('Seller own suspended Store can receive; cross-owner hidden; cannot claim LOST', async () => {
    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'SUSPENDED' },
    });
    const call = (
      id = orderId,
      body: unknown = returned,
      token = seller.token,
    ) =>
      request(app.getHttpServer())
        .post('/seller/orders/' + id + '/confirm-returned')
        .set('Authorization', token)
        .set('Idempotency-Key', key())
        .send(body as object);
    expect(
      (
        await call(orderId, {
          ...damaged,
          reasonCode: 'LOST',
          receiptReference: null,
        })
      ).status,
    ).toBe(400);
    const stranger = await actor('SELLER');
    expect((await call(orderId, returned, stranger.token)).status).toBe(404);
    expect((await call()).status).toBe(200);
  });
  it('same key concurrent across instances yields one transition/restore', async () => {
    const k = key(),
      before = await state();
    const responses = await Promise.all([
      post('confirm-returned', returned, k),
      post('confirm-returned', returned, k, other),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    const after = await state();
    expect(after.commands).toHaveLength(1);
    expect(after.history).toHaveLength(1);
    expect(after.variant?.stock).toBe(before.variant!.stock + 1);
  });
  it('Seller/Admin compete with different decisions: only one closes; stock follows winner', async () => {
    const before = await state();
    const sellerCall = request(other.getHttpServer())
      .post('/seller/orders/' + orderId + '/confirm-returned')
      .set('Authorization', seller.token)
      .set('Idempotency-Key', key())
      .send(returned);
    const responses = await Promise.all([
      post('confirm-returned', damaged),
      sellerCall,
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await state();
    expect(after.commands).toHaveLength(1);
    expect(after.history).toHaveLength(1);
    expect(after.variant?.stock).toBe(
      before.variant!.stock + (after.history[0]!.restockable ? 1 : 0),
    );
  });
  it('legacy missing decrement is rejected with zero mutations', async () => {
    await prisma.stockMovement.deleteMany({
      where: { orderItem: { orderId } },
    });
    const before = await state(),
      response = await post();
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ORDER_INVENTORY_REVIEW_REQUIRED');
    expect(await state()).toEqual(before);
  });
  it('paid/prepaid and wrong source state fail closed', async () => {
    await prisma.payment.update({
      where: { orderId },
      data: { provider: 'MOMO', status: 'PAID', paidAt: new Date() },
    });
    const before = await state();
    expect((await post()).status).toBe(409);
    expect(await state()).toEqual(before);
    const id = await fixture('SHIPPING');
    expect(
      (await post('confirm-returned', returned, key(), app, admin.token, id))
        .status,
    ).toBe(409);
  });
  it('blocked Seller denied even for replay; Buyer cannot call Admin/Seller commands', async () => {
    expect(
      (await post('confirm-returned', returned, key(), app, buyer.token))
        .status,
    ).toBe(403);
    await request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/confirm-returned`)
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', key())
      .send(returned)
      .expect(403);
    const k = key();
    const original = await sellerPost(k).expect(200);
    const after = await state();
    expect(after.commands.at(-1)).toMatchObject({
      status: 'SUCCEEDED',
      actorType: 'SELLER',
      actorId: seller.id,
    });
    await prisma.user.update({
      where: { id: seller.id },
      data: { isActive: false },
    });
    expect(
      (
        await request(app.getHttpServer())
          .post('/seller/orders/' + orderId + '/confirm-returned')
          .set('Authorization', seller.token)
          .set('Idempotency-Key', k)
          .send(returned)
      ).status,
    ).toBe(401);
    await sellerPost(k, other).expect(401);
    await sellerPost(key(), other).expect(401);
    expect(await state()).toEqual(after);
    await prisma.user.update({
      where: { id: seller.id },
      data: { isActive: true },
    });
    const replay = await sellerPost(k, other).expect(200);
    expect(replay.body).toEqual({ ...original.body, replayed: true });
    expect(await state()).toEqual(after);
  });
  it('Seller role revoked after a real successful receipt cannot bypass current role by replay', async () => {
    const k = key();
    await sellerPost(k).expect(200);
    const after = await state();
    await prisma.user.update({
      where: { id: seller.id },
      data: { role: 'USER' },
    });
    await sellerPost(k, other).expect(403);
    expect(await state()).toEqual(after);
  });
  it('failure finalizing receipt rolls back stock/payment/order/history/outbox; same key retry works', async () => {
    const k = key(),
      before = await state();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION returned_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."orderId" = ${orderId} AND NEW.status = 'SUCCEEDED' THEN RAISE EXCEPTION 'fixture fault'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER returned_test_fault BEFORE UPDATE ON order_commands FOR EACH ROW EXECUTE FUNCTION returned_test_fault()',
    );
    try {
      expect((await post('confirm-returned', returned, k)).status).toBe(500);
      expect(await state()).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER returned_test_fault ON order_commands',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION returned_test_fault()');
    }
    expect((await post('confirm-returned', returned, k)).status).toBe(200);
  });
  it('stock overflow rolls back with no successful claim', async () => {
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: 2147483647 },
    });
    const before = await state();
    try {
      expect((await post()).status).toBe(409);
      expect(await state()).toEqual(before);
    } finally {
      await prisma.productVariant.update({
        where: { id: variantId },
        data: { stock: 7 },
      });
    }
  });
  it('strict JSON/query/fields and bounded body; Swagger includes both roles', async () => {
    expect(
      (await post('confirm-returned', { ...returned, restockable: 'true' }))
        .status,
    ).toBe(400);
    expect(
      (await post('confirm-returned', { ...returned, actorId: admin.id }))
        .status,
    ).toBe(400);
    expect(
      (
        await post('confirm-returned', {
          ...returned,
          reasonText: 'x'.repeat(9000),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(app.getHttpServer())
          .post('/admin/orders/' + orderId + '/confirm-returned?actorId=1')
          .set('Authorization', admin.token)
          .set('Idempotency-Key', key())
          .send(returned)
      ).status,
    ).toBe(400);
    const paths = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    ).paths;
    expect(paths['/seller/orders/{orderId}/confirm-returned']).toBeDefined();
    expect(paths['/admin/orders/{orderId}/confirm-returned']).toBeDefined();
  });
});
