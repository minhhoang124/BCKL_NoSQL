import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma.service.js';

describe('Cart, order and inventory schema constraints (e2e)', () => {
  let prisma: PrismaService | undefined;
  const marker = `cart-order-schema-${Date.now()}`;
  const userIds: number[] = [];
  const addressIds: number[] = [];
  let buyerId: number | undefined;
  let otherBuyerId: number | undefined;
  let categoryId: number | undefined;
  let storeId: number | undefined;
  let productId: number | undefined;
  let variantId: number | undefined;
  let otherVariantId: number | undefined;
  let checkoutId: number | undefined;
  let orderId: number | undefined;
  let orderItemId: number | undefined;

  const db = (): PrismaService => {
    if (!prisma) throw new Error('Prisma test fixture is not initialized');
    return prisma;
  };

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.$connect();

    const [buyer, otherBuyer, seller] = await Promise.all([
      prisma.user.create({ data: { email: `${marker}-buyer@example.com`, passwordHash: 'test-only', role: 'USER' } }),
      prisma.user.create({ data: { email: `${marker}-other-buyer@example.com`, passwordHash: 'test-only', role: 'USER' } }),
      prisma.user.create({ data: { email: `${marker}-seller@example.com`, passwordHash: 'test-only', role: 'SELLER' } }),
    ]);
    userIds.push(buyer.id, otherBuyer.id, seller.id);
    buyerId = buyer.id;
    otherBuyerId = otherBuyer.id;

    const store = await prisma.store.create({ data: { sellerId: seller.id, name: marker, status: 'ACTIVE' } });
    storeId = store.id;
    const category = await prisma.category.create({ data: { name: marker, slug: marker } });
    categoryId = category.id;
    const product = await prisma.product.create({ data: { storeId, categoryId, name: marker } });
    productId = product.id;
    const [variant, otherVariant] = await Promise.all([
      prisma.productVariant.create({ data: { productId, storeId, skuCode: `${marker}-sku`, price: 100000, stock: 2, optionSignature: 'default' } }),
      prisma.productVariant.create({ data: { productId, storeId, skuCode: `${marker}-other-sku`, price: 120000, stock: 3, optionSignature: 'other' } }),
    ]);
    variantId = variant.id;
    otherVariantId = otherVariant.id;

    const checkout = await prisma.checkout.create({ data: { buyerId, idempotencyKey: `${marker}-key`, requestHash: `${marker}-hash` } });
    checkoutId = checkout.id;
    const order = await prisma.order.create({
      data: {
        orderNumber: `${marker}-order`, checkoutId, buyerId, storeId,
        recipientNameSnapshot: 'Test Buyer', phoneSnapshot: '0900000000',
        provinceSnapshot: 'Hồ Chí Minh', districtSnapshot: 'Quận 1',
        wardSnapshot: 'Bến Nghé', addressLineSnapshot: '1 Test Street',
        subtotal: 100000, shippingFee: 0, total: 100000,
      },
    });
    orderId = order.id;
    const item = await prisma.orderItem.create({
      data: {
        orderId, productId, variantId, storeId, productNameSnapshot: marker,
        skuSnapshot: `${marker}-sku`, optionSnapshot: {}, unitPrice: 100000,
        quantity: 1, lineTotal: 100000,
      },
    });
    orderItemId = item.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    // Guard every fixture ID: undefined must never degrade into `where: {}`.
    if (orderItemId !== undefined) await prisma.stockMovement.deleteMany({ where: { orderItemId } });
    await prisma.stockMovement.deleteMany({ where: { idempotencyKey: { startsWith: marker } } });
    if (orderId !== undefined) await prisma.orderItem.deleteMany({ where: { orderId } });
    if (checkoutId !== undefined) {
      await prisma.order.deleteMany({ where: { checkoutId } });
      await prisma.checkout.deleteMany({ where: { id: checkoutId } });
    }
    if (productId !== undefined) {
      await prisma.productVariant.deleteMany({ where: { productId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    }
    if (storeId !== undefined) await prisma.store.deleteMany({ where: { id: storeId } });
    if (categoryId !== undefined) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (addressIds.length > 0) await prisma.userAddress.deleteMany({ where: { id: { in: addressIds } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('rejects fractional VND prices instead of rounding them silently', async () => {
    await expect(db().productVariant.create({
      data: {
        productId: productId!, storeId: storeId!, skuCode: `${marker}-fractional-sku`,
        price: new Prisma.Decimal('100000.50'), stock: 1, optionSignature: 'fractional',
      },
    })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('rejects non-positive cart quantities', async () => {
    const cart = await db().cart.create({ data: { userId: buyerId! } });
    await expect(db().cartItem.create({ data: { cartId: cart.id, variantId: variantId!, quantity: 0 } }))
      .rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await db().cart.delete({ where: { id: cart.id } });
  });

  it('allows only one default address per user', async () => {
    const first = await db().userAddress.create({
      data: {
        userId: buyerId!, recipientName: 'Test Buyer', phone: '0900000000',
        province: 'Hồ Chí Minh', district: 'Quận 1', ward: 'Bến Nghé',
        addressLine: '1 Test Street', isDefault: true,
      },
    });
    addressIds.push(first.id);
    await expect(db().userAddress.create({
      data: {
        userId: buyerId!, recipientName: 'Test Buyer 2', phone: '0900000001',
        province: 'Hồ Chí Minh', district: 'Quận 1', ward: 'Bến Nghé',
        addressLine: '2 Test Street', isDefault: true,
      },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects an order whose buyer differs from its checkout owner', async () => {
    const isolatedCheckout = await db().checkout.create({
      data: {
        buyerId: buyerId!,
        idempotencyKey: `${marker}-buyer-ownership`,
        requestHash: `${marker}-buyer-ownership-hash`,
      },
    });
    try {
      await expect(db().order.create({
        data: {
          orderNumber: `${marker}-wrong-buyer`, checkoutId: isolatedCheckout.id,
          buyerId: otherBuyerId!, storeId: storeId!, recipientNameSnapshot: 'Other Buyer',
          phoneSnapshot: '0900000001', provinceSnapshot: 'Hồ Chí Minh',
          districtSnapshot: 'Quận 1', wardSnapshot: 'Bến Nghé',
          addressLineSnapshot: '2 Test Street', subtotal: 1, shippingFee: 0, total: 1,
        },
      })).rejects.toMatchObject({ code: 'P2003' });
    } finally {
      await db().checkout.delete({ where: { id: isolatedCheckout.id } });
    }
  });

  it('allows only one order per store in a checkout', async () => {
    await expect(db().order.create({
      data: {
        orderNumber: `${marker}-duplicate-store`, checkoutId: checkoutId!, buyerId: buyerId!, storeId: storeId!,
        recipientNameSnapshot: 'Test Buyer', phoneSnapshot: '0900000000',
        provinceSnapshot: 'Hồ Chí Minh', districtSnapshot: 'Quận 1', wardSnapshot: 'Bến Nghé',
        addressLineSnapshot: '1 Test Street', subtotal: 1, shippingFee: 0, total: 1,
      },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('requires transaction stock movements to reference an order item', async () => {
    await expect(db().stockMovement.create({
      data: {
        variantId: variantId!, type: 'CHECKOUT_DECREMENT', quantityDelta: -1,
        balanceAfter: 1, idempotencyKey: `${marker}-missing-item`,
      },
    })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('rejects a stock movement linked to a different variant than its order item', async () => {
    await expect(db().stockMovement.create({
      data: {
        variantId: otherVariantId!, orderItemId: orderItemId!, type: 'CHECKOUT_DECREMENT',
        quantityDelta: -1, balanceAfter: 2, idempotencyKey: `${marker}-wrong-variant`,
      },
    })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('allows manual adjustments only without an order item', async () => {
    await expect(db().stockMovement.create({
      data: {
        variantId: variantId!, orderItemId: orderItemId!, type: 'MANUAL_ADJUSTMENT',
        quantityDelta: 1, balanceAfter: 3, idempotencyKey: `${marker}-manual-with-item`,
      },
    })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('prevents duplicate stock effects for one order item and movement type', async () => {
    await db().stockMovement.create({
      data: {
        variantId: variantId!, orderItemId: orderItemId!, type: 'CHECKOUT_DECREMENT',
        quantityDelta: -1, balanceAfter: 1, idempotencyKey: `${marker}-stock-1`,
      },
    });
    await expect(db().stockMovement.create({
      data: {
        variantId: variantId!, orderItemId: orderItemId!, type: 'CHECKOUT_DECREMENT',
        quantityDelta: -1, balanceAfter: 0, idempotencyKey: `${marker}-stock-2`,
      },
    })).rejects.toMatchObject({ code: 'P2002' });
  });
});
