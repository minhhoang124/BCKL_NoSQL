import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma.service.js';

/**
 * ProductImage composite FK – proves that the database rejects images
 * referencing a ProductOptionValue from a different Product, and that
 * cascade deletion through Product still works correctly.
 *
 * All fixtures use unique markers and are cleaned up in afterAll.
 */
describe('ProductImage option-value ownership (e2e)', () => {
  let prisma: PrismaService;

  const marker = `img-own-${Date.now()}`;

  // Fixture IDs for cleanup — may remain undefined if beforeAll partially fails
  let userAId: number | undefined;
  let userBId: number | undefined;
  let storeAId: number | undefined;
  let storeBId: number | undefined;
  let categoryId: number | undefined;
  let productAId: number | undefined;
  let productBId: number | undefined;
  let optionGroupAId: number | undefined;
  let optionValueAId: number | undefined;
  let optionValueBId: number | undefined;

  /** Safely ignore Prisma P2025 (record not found). Re-throw everything else. */
  function ignoreNotFound(err: unknown): void {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2025'
    ) {
      return;
    }
    throw err;
  }

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.$connect();

    // ── Create two independent Products with OptionValues ────────────────

    const userA = await prisma.user.create({
      data: {
        email: `${marker}-a@example.com`,
        passwordHash: 'not-used',
        role: 'SELLER',
      },
    });
    userAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        email: `${marker}-b@example.com`,
        passwordHash: 'not-used',
        role: 'SELLER',
      },
    });
    userBId = userB.id;

    const storeA = await prisma.store.create({
      data: { sellerId: userA.id, name: `${marker}-store-a` },
    });
    storeAId = storeA.id;

    const storeB = await prisma.store.create({
      data: { sellerId: userB.id, name: `${marker}-store-b` },
    });
    storeBId = storeB.id;

    const category = await prisma.category.create({
      data: { name: `${marker}-cat`, slug: `${marker}-cat` },
    });
    categoryId = category.id;

    const productA = await prisma.product.create({
      data: {
        storeId: storeA.id,
        categoryId: category.id,
        name: `${marker}-product-a`,
      },
    });
    productAId = productA.id;

    const productB = await prisma.product.create({
      data: {
        storeId: storeB.id,
        categoryId: category.id,
        name: `${marker}-product-b`,
      },
    });
    productBId = productB.id;

    const optionGroupA = await prisma.productOptionGroup.create({
      data: { productId: productA.id, name: 'Color' },
    });
    optionGroupAId = optionGroupA.id;

    // optionGroupB is only needed for productB's OptionValue creation;
    // Product cascade handles its deletion, so we don't store its ID.
    const optionGroupB = await prisma.productOptionGroup.create({
      data: { productId: productB.id, name: 'Color' },
    });

    const optionValueA = await prisma.productOptionValue.create({
      data: {
        groupId: optionGroupA.id,
        productId: productA.id,
        value: 'Red',
      },
    });
    optionValueAId = optionValueA.id;

    const optionValueB = await prisma.productOptionValue.create({
      data: {
        groupId: optionGroupB.id,
        productId: productB.id,
        value: 'Blue',
      },
    });
    optionValueBId = optionValueB.id;
  });

  afterAll(async () => {
    try {
      // Cleanup in FK-safe order.
      // Product cascade handles: Images, OptionGroups, OptionValues.
      // Each step skips gracefully if the fixture was never created (undefined)
      // or was already deleted (P2025), but real FK errors are surfaced.

      if (productAId !== undefined) {
        await prisma.product
          .delete({ where: { id: productAId } })
          .catch(ignoreNotFound);
      }
      if (productBId !== undefined) {
        await prisma.product
          .delete({ where: { id: productBId } })
          .catch(ignoreNotFound);
      }

      // Stores must be deleted before Users (FK: Store.sellerId → User)
      if (storeAId !== undefined) {
        await prisma.store
          .delete({ where: { id: storeAId } })
          .catch(ignoreNotFound);
      }
      if (storeBId !== undefined) {
        await prisma.store
          .delete({ where: { id: storeBId } })
          .catch(ignoreNotFound);
      }

      // Category after Products
      if (categoryId !== undefined) {
        await prisma.category
          .delete({ where: { id: categoryId } })
          .catch(ignoreNotFound);
      }

      // Users after Stores
      if (userAId !== undefined) {
        await prisma.user
          .delete({ where: { id: userAId } })
          .catch(ignoreNotFound);
      }
      if (userBId !== undefined) {
        await prisma.user
          .delete({ where: { id: userBId } })
          .catch(ignoreNotFound);
      }
    } finally {
      if (prisma) await prisma.$disconnect();
    }
  });

  it('allows image with own product OptionValue', async () => {
    const image = await prisma.productImage.create({
      data: {
        productId: productAId!,
        productOptionValueId: optionValueAId!,
        url: `${marker}/a-with-own-ov.jpg`,
        sortOrder: 0,
      },
    });
    expect(image).toBeDefined();
    expect(image.productOptionValueId).toBe(optionValueAId);

    // Cleanup
    await prisma.productImage.delete({ where: { id: image.id } });
  });

  it('allows image without OptionValue', async () => {
    const image = await prisma.productImage.create({
      data: {
        productId: productAId!,
        productOptionValueId: null,
        url: `${marker}/a-no-ov.jpg`,
        sortOrder: 0,
      },
    });
    expect(image).toBeDefined();
    expect(image.productOptionValueId).toBeNull();

    // Cleanup
    await prisma.productImage.delete({ where: { id: image.id } });
  });

  it('rejects image with OptionValue from different product', async () => {
    await expect(
      prisma.productImage.create({
        data: {
          productId: productAId!,
          productOptionValueId: optionValueBId!,
          url: `${marker}/a-with-b-ov.jpg`,
          sortOrder: 0,
        },
      }),
    ).rejects.toMatchObject({
      code: 'P2003',
    } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });

  it('blocks standalone OptionValue deletion when image references it', async () => {
    // Create image referencing OptionValue A
    const image = await prisma.productImage.create({
      data: {
        productId: productAId!,
        productOptionValueId: optionValueAId!,
        url: `${marker}/a-block-delete.jpg`,
        sortOrder: 0,
      },
    });

    // Attempt to delete OptionValue A → must fail (NO ACTION)
    await expect(
      prisma.productOptionValue.delete({
        where: { id: optionValueAId! },
      }),
    ).rejects.toThrow();

    // Cleanup
    await prisma.productImage.delete({ where: { id: image.id } });
  });

  it('allows OptionValue deletion after unlinking image', async () => {
    // Create image referencing OptionValue A
    const image = await prisma.productImage.create({
      data: {
        productId: productAId!,
        productOptionValueId: optionValueAId!,
        url: `${marker}/a-unlink-then-delete.jpg`,
        sortOrder: 0,
      },
    });

    // Unlink the image from the OptionValue
    await prisma.productImage.update({
      where: { id: image.id },
      data: { productOptionValueId: null },
    });

    // Delete OptionValue A → should succeed now
    await prisma.productOptionValue.delete({
      where: { id: optionValueAId! },
    });

    // Cleanup image
    await prisma.productImage.delete({ where: { id: image.id } });

    // Recreate OptionValue A for subsequent tests
    const recreated = await prisma.productOptionValue.create({
      data: {
        groupId: optionGroupAId!,
        productId: productAId!,
        value: 'Red',
      },
    });
    optionValueAId = recreated.id;
  });

  it('cascades Product deletion despite composite FK', async () => {
    // Create a temporary product with full chain:
    // Product C → OptionGroup → OptionValue → Image referencing it
    const productC = await prisma.product.create({
      data: {
        storeId: storeAId!,
        categoryId: categoryId!,
        name: `${marker}-product-c`,
      },
    });

    const groupC = await prisma.productOptionGroup.create({
      data: { productId: productC.id, name: 'Size' },
    });

    const valueC = await prisma.productOptionValue.create({
      data: {
        groupId: groupC.id,
        productId: productC.id,
        value: 'Large',
      },
    });

    await prisma.productImage.create({
      data: {
        productId: productC.id,
        productOptionValueId: valueC.id,
        url: `${marker}/c-cascade.jpg`,
        sortOrder: 0,
      },
    });

    // Also create image without OptionValue
    await prisma.productImage.create({
      data: {
        productId: productC.id,
        productOptionValueId: null,
        url: `${marker}/c-no-ov.jpg`,
        sortOrder: 1,
      },
    });

    // Delete Product C → must cascade successfully
    await expect(
      prisma.product.delete({ where: { id: productC.id } }),
    ).resolves.toBeDefined();

    // Verify everything is gone
    const imagesLeft = await prisma.productImage.count({
      where: { productId: productC.id },
    });
    expect(imagesLeft).toBe(0);
  });
});
