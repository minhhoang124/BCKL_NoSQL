import { execSync } from 'node:child_process';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Prisma, StoreStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma.service.js';

/**
 * Seed idempotency – verifies that running seed a second time never overwrites
 * business data that a Seller or Admin might have changed, and never recreates
 * child records (Variant / Shipping) that belong to an existing Product.
 *
 * Phase A: mutate every seeded entity then re-seed → assert preservation.
 * Phase B: delete Variant/Shipping, move Product to another Store → re-seed
 *          → assert children are not recreated and storeId is not reverted.
 *
 * Cleanup: every mutation is reverted in afterAll so the database is left clean
 * for other test suites, even when assertions fail.
 */
describe('Seed idempotency (e2e)', () => {
  let prisma: PrismaService;
  const seedScript = path.resolve(__dirname, '../prisma/seed.mjs');

  // ---------- snapshot holders ----------
  type Snapshot = {
    store: {
      id: number;
      name: string;
      status: StoreStatus;
      updatedAt: Date;
    };
    electronicsCategory: {
      id: number;
      name: string;
      isActive: boolean;
      updatedAt: Date;
    };
    audioCategory: {
      id: number;
      name: string;
      parentId: number | null;
      isActive: boolean;
      updatedAt: Date;
    };
    brand: {
      id: number;
      name: string;
      isActive: boolean;
      updatedAt: Date;
    };
    product: {
      id: number;
      name: string;
      description: string | null;
      version: number;
      storeId: number;
      categoryId: number;
      brandId: number | null;
      updatedAt: Date;
    };
    variant: {
      id: number;
      productId: number;
      storeId: number;
      skuCode: string;
      sellerSku: string | null;
      price: Prisma.Decimal;
      stock: number;
      isActive: boolean;
      optionSignature: string;
      createdAt: Date;
      updatedAt: Date;
    } | null;
    shipping: {
      productId: number;
      packageWeightGrams: number | null;
      packageLengthCm: Prisma.Decimal | null;
      packageWidthCm: Prisma.Decimal | null;
      packageHeightCm: Prisma.Decimal | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
    testStoreId: number | null;
    testUserId: number | null;
    testCategoryId: number | null;
  };

  let snap: Snapshot;

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
  });

  afterAll(async () => {
    try {
      if (!snap) return;

      // ── 1. Remove test variant if it exists (may block storeId restore) ──
      const testVariant = await prisma.productVariant.findUnique({
        where: { skuCode: 'DEMO-ELECTRONICS-001-DEFAULT' },
      });
      if (testVariant) {
        await prisma.productVariant
          .delete({ where: { id: testVariant.id } })
          .catch(ignoreNotFound);
      }

      // ── 2. Restore Product to original owner/data ──────────────────────
      await prisma.product
        .update({
          where: { id: snap.product.id },
          data: {
            storeId: snap.product.storeId,
            categoryId: snap.product.categoryId,
            brandId: snap.product.brandId,
            name: snap.product.name,
            description: snap.product.description,
            version: snap.product.version,
            updatedAt: snap.product.updatedAt,
          },
        })
        .catch(ignoreNotFound);

      // ── 3. Recreate original Variant with full snapshot data ────────────
      if (snap.variant) {
        const existingVariant = await prisma.productVariant.findUnique({
          where: { skuCode: snap.variant.skuCode },
        });
        if (!existingVariant) {
          await prisma.productVariant.create({
            data: {
              id: snap.variant.id,
              productId: snap.variant.productId,
              storeId: snap.variant.storeId,
              skuCode: snap.variant.skuCode,
              sellerSku: snap.variant.sellerSku,
              price: snap.variant.price,
              stock: snap.variant.stock,
              isActive: snap.variant.isActive,
              optionSignature: snap.variant.optionSignature,
              createdAt: snap.variant.createdAt,
              updatedAt: snap.variant.updatedAt,
            },
          });
        } else {
          await prisma.productVariant.update({
            where: { id: existingVariant.id },
            data: {
              sellerSku: snap.variant.sellerSku,
              price: snap.variant.price,
              stock: snap.variant.stock,
              isActive: snap.variant.isActive,
              optionSignature: snap.variant.optionSignature,
              createdAt: snap.variant.createdAt,
              updatedAt: snap.variant.updatedAt,
            },
          });
        }
      }

      // ── 4. Recreate original Shipping with full snapshot data ───────────
      if (snap.shipping) {
        const existingShipping = await prisma.productShippingProfile.findUnique(
          {
            where: { productId: snap.shipping.productId },
          },
        );
        if (!existingShipping) {
          await prisma.productShippingProfile.create({
            data: {
              productId: snap.shipping.productId,
              packageWeightGrams: snap.shipping.packageWeightGrams,
              packageLengthCm: snap.shipping.packageLengthCm,
              packageWidthCm: snap.shipping.packageWidthCm,
              packageHeightCm: snap.shipping.packageHeightCm,
              createdAt: snap.shipping.createdAt,
              updatedAt: snap.shipping.updatedAt,
            },
          });
        } else {
          await prisma.productShippingProfile.update({
            where: { productId: snap.shipping.productId },
            data: {
              packageWeightGrams: snap.shipping.packageWeightGrams,
              packageLengthCm: snap.shipping.packageLengthCm,
              packageWidthCm: snap.shipping.packageWidthCm,
              packageHeightCm: snap.shipping.packageHeightCm,
              createdAt: snap.shipping.createdAt,
              updatedAt: snap.shipping.updatedAt,
            },
          });
        }
      }

      // ── 5. Restore Store ───────────────────────────────────────────────
      await prisma.store
        .update({
          where: { id: snap.store.id },
          data: {
            name: snap.store.name,
            status: snap.store.status,
            updatedAt: snap.store.updatedAt,
          },
        })
        .catch(ignoreNotFound);

      // ── 6. Restore audio category (restore parentId before electronics) ─
      await prisma.category
        .update({
          where: { id: snap.audioCategory.id },
          data: {
            name: snap.audioCategory.name,
            parentId: snap.audioCategory.parentId,
            isActive: snap.audioCategory.isActive,
            updatedAt: snap.audioCategory.updatedAt,
          },
        })
        .catch(ignoreNotFound);

      // ── 7. Restore electronics category ────────────────────────────────
      await prisma.category
        .update({
          where: { id: snap.electronicsCategory.id },
          data: {
            name: snap.electronicsCategory.name,
            isActive: snap.electronicsCategory.isActive,
            updatedAt: snap.electronicsCategory.updatedAt,
          },
        })
        .catch(ignoreNotFound);

      // ── 8. Restore Brand ───────────────────────────────────────────────
      await prisma.brand
        .update({
          where: { id: snap.brand.id },
          data: {
            name: snap.brand.name,
            isActive: snap.brand.isActive,
            updatedAt: snap.brand.updatedAt,
          },
        })
        .catch(ignoreNotFound);

      // ── 9. Delete test category (after Product no longer references it) ─
      if (snap.testCategoryId) {
        await prisma.category
          .delete({ where: { id: snap.testCategoryId } })
          .catch(ignoreNotFound);
      }

      // ── 10. Delete test store (after Product no longer references it) ──
      if (snap.testStoreId) {
        await prisma.store
          .delete({ where: { id: snap.testStoreId } })
          .catch(ignoreNotFound);
      }

      // ── 11. Delete test user (after test store is gone) ────────────────
      if (snap.testUserId) {
        await prisma.user
          .delete({ where: { id: snap.testUserId } })
          .catch(ignoreNotFound);
      }
    } finally {
      // ── 12. Disconnect Prisma ──────────────────────────────────────────
      if (prisma) await prisma.$disconnect();
    }
  });

  it('preserves all business data on subsequent seed runs', async () => {
    // ══════════════════════════════════════════════════════════════════════
    //  PHASE A — prove seed does not overwrite Seller/Admin mutations
    // ══════════════════════════════════════════════════════════════════════

    // ── A1. First seed run ───────────────────────────────────────────────
    execSync(`node "${seedScript}"`, { env: process.env });

    // ── A2. Snapshot every demo entity ───────────────────────────────────
    const store = await prisma.store.findFirst({
      where: { seller: { email: 'seller.demo@example.com' } },
    });
    expect(store).toBeDefined();

    const electronicsCategory = await prisma.category.findUnique({
      where: { slug: 'electronics' },
    });
    expect(electronicsCategory).toBeDefined();

    const audioCategory = await prisma.category.findUnique({
      where: { slug: 'electronics-audio' },
    });
    expect(audioCategory).toBeDefined();

    const brand = await prisma.brand.findUnique({
      where: { slug: 'demo-brand' },
    });
    expect(brand).toBeDefined();

    const product = await prisma.product.findUnique({
      where: { externalId: 'internal:demo-electronics-001' },
    });
    expect(product).toBeDefined();

    const variant = await prisma.productVariant.findUnique({
      where: { skuCode: 'DEMO-ELECTRONICS-001-DEFAULT' },
    });
    expect(variant).toBeDefined();

    const shipping = await prisma.productShippingProfile.findUnique({
      where: { productId: product!.id },
    });
    expect(shipping).toBeDefined();

    const outboxCountBefore = await prisma.searchOutbox.count({
      where: { productId: product!.id },
    });

    snap = {
      store: {
        id: store!.id,
        name: store!.name,
        status: store!.status,
        updatedAt: store!.updatedAt,
      },
      electronicsCategory: {
        id: electronicsCategory!.id,
        name: electronicsCategory!.name,
        isActive: electronicsCategory!.isActive,
        updatedAt: electronicsCategory!.updatedAt,
      },
      audioCategory: {
        id: audioCategory!.id,
        name: audioCategory!.name,
        parentId: audioCategory!.parentId,
        isActive: audioCategory!.isActive,
        updatedAt: audioCategory!.updatedAt,
      },
      brand: {
        id: brand!.id,
        name: brand!.name,
        isActive: brand!.isActive,
        updatedAt: brand!.updatedAt,
      },
      product: {
        id: product!.id,
        name: product!.name,
        description: product!.description,
        version: product!.version,
        storeId: product!.storeId,
        categoryId: product!.categoryId,
        brandId: product!.brandId,
        updatedAt: product!.updatedAt,
      },
      variant: variant
        ? {
            id: variant.id,
            productId: variant.productId,
            storeId: variant.storeId,
            skuCode: variant.skuCode,
            sellerSku: variant.sellerSku,
            price: variant.price,
            stock: variant.stock,
            isActive: variant.isActive,
            optionSignature: variant.optionSignature,
            createdAt: variant.createdAt,
            updatedAt: variant.updatedAt,
          }
        : null,
      shipping: shipping
        ? {
            productId: shipping.productId,
            packageWeightGrams: shipping.packageWeightGrams,
            packageLengthCm: shipping.packageLengthCm,
            packageWidthCm: shipping.packageWidthCm,
            packageHeightCm: shipping.packageHeightCm,
            createdAt: shipping.createdAt,
            updatedAt: shipping.updatedAt,
          }
        : null,
      testStoreId: null,
      testUserId: null,
      testCategoryId: null,
    };

    // ── A3. Mutate demo entities like a Seller/Admin would ───────────────

    // Store: rename + suspend
    await prisma.store.update({
      where: { id: store!.id },
      data: { name: 'Seller Custom Store Name', status: 'SUSPENDED' },
    });

    // Categories: rename, reparent audio, deactivate electronics
    await prisma.category.update({
      where: { id: electronicsCategory!.id },
      data: { name: 'Renamed Electronics', isActive: false },
    });

    // Create a test category to reparent audio under
    const testCategory = await prisma.category.create({
      data: { name: 'Test Parent', slug: `test-parent-${Date.now()}` },
    });
    snap.testCategoryId = testCategory.id;

    await prisma.category.update({
      where: { id: audioCategory!.id },
      data: {
        name: 'Renamed Audio',
        parentId: testCategory.id,
        isActive: false,
      },
    });

    // Brand: rename + deactivate
    await prisma.brand.update({
      where: { id: brand!.id },
      data: { name: 'Renamed Brand', isActive: false },
    });

    // Product: change name, description, version, categoryId, brandId
    // (storeId is NOT changed yet — Variant still references original Store)
    await prisma.product.update({
      where: { id: product!.id },
      data: {
        name: 'Seller Custom Product Name',
        description: 'Seller custom description',
        version: 5,
        categoryId: testCategory.id,
        brandId: null,
      },
    });

    // Variant: change price, set stock=0, deactivate
    await prisma.productVariant.update({
      where: { id: variant!.id },
      data: {
        price: '1500000.00',
        stock: 0,
        isActive: false,
      },
    });

    // Shipping: change packageWeightGrams
    await prisma.productShippingProfile.update({
      where: { productId: product!.id },
      data: { packageWeightGrams: 999 },
    });

    // Record updatedAt AFTER Seller mutations, BEFORE second seed
    const productAfterMutation = await prisma.product.findUnique({
      where: { id: product!.id },
    });
    const updatedAtAfterMutation = productAfterMutation!.updatedAt;

    // ── A4. Second seed run ──────────────────────────────────────────────
    execSync(`node "${seedScript}"`, { env: process.env });

    // ── A5. Assert every field is preserved ──────────────────────────────

    // Store
    const storeAfter = await prisma.store.findUnique({
      where: { id: store!.id },
    });
    expect(storeAfter!.name).toBe('Seller Custom Store Name');
    expect(storeAfter!.status).toBe('SUSPENDED');

    // Category (electronics)
    const elecAfter = await prisma.category.findUnique({
      where: { id: electronicsCategory!.id },
    });
    expect(elecAfter!.name).toBe('Renamed Electronics');
    expect(elecAfter!.isActive).toBe(false);

    // Category (audio)
    const audioAfter = await prisma.category.findUnique({
      where: { id: audioCategory!.id },
    });
    expect(audioAfter!.name).toBe('Renamed Audio');
    expect(audioAfter!.parentId).toBe(testCategory.id);
    expect(audioAfter!.isActive).toBe(false);

    // Brand
    const brandAfter = await prisma.brand.findUnique({
      where: { id: brand!.id },
    });
    expect(brandAfter!.name).toBe('Renamed Brand');
    expect(brandAfter!.isActive).toBe(false);

    // Product
    const productAfter = await prisma.product.findUnique({
      where: { id: product!.id },
    });
    expect(productAfter!.name).toBe('Seller Custom Product Name');
    expect(productAfter!.description).toBe('Seller custom description');
    expect(productAfter!.version).toBe(5);
    expect(productAfter!.storeId).toBe(store!.id); // storeId unchanged in Phase A
    expect(productAfter!.categoryId).toBe(testCategory.id);
    expect(productAfter!.brandId).toBeNull();
    expect(productAfter!.updatedAt.getTime()).toBe(
      updatedAtAfterMutation.getTime(),
    );

    // Variant: price/stock/isActive must be preserved
    const variantAfterA = await prisma.productVariant.findUnique({
      where: { skuCode: 'DEMO-ELECTRONICS-001-DEFAULT' },
    });
    expect(variantAfterA).toBeDefined();
    expect(Number(variantAfterA!.price)).toBe(1500000);
    expect(variantAfterA!.stock).toBe(0);
    expect(variantAfterA!.isActive).toBe(false);

    // Shipping: packageWeightGrams must be preserved
    const shippingAfterA = await prisma.productShippingProfile.findUnique({
      where: { productId: product!.id },
    });
    expect(shippingAfterA).toBeDefined();
    expect(shippingAfterA!.packageWeightGrams).toBe(999);

    // SearchOutbox: no new entries from seed
    const outboxCountAfterA = await prisma.searchOutbox.count({
      where: { productId: product!.id },
    });
    expect(outboxCountAfterA).toBe(outboxCountBefore);

    // No duplicate products
    const productCountA = await prisma.product.count({
      where: { externalId: 'internal:demo-electronics-001' },
    });
    expect(productCountA).toBe(1);

    // ══════════════════════════════════════════════════════════════════════
    //  PHASE B — prove seed does not recreate deleted children
    // ══════════════════════════════════════════════════════════════════════

    // ── B1. Delete Variant and Shipping ──────────────────────────────────
    await prisma.productVariant.delete({ where: { id: variantAfterA!.id } });
    await prisma.productShippingProfile.delete({
      where: { productId: product!.id },
    });

    // ── B2. Create Test User and Test Store ──────────────────────────────
    const testUser = await prisma.user.create({
      data: {
        email: `test-seller-${Date.now()}@example.com`,
        passwordHash: 'not-real',
        role: 'SELLER',
      },
    });
    snap.testUserId = testUser.id;

    const testStore = await prisma.store.create({
      data: { sellerId: testUser.id, name: 'Test Store For StoreId Check' },
    });
    snap.testStoreId = testStore.id;

    // ── B3. Move Product to Test Store ───────────────────────────────────
    await prisma.product.update({
      where: { id: product!.id },
      data: { storeId: testStore.id },
    });

    // ── B4. Third seed run ───────────────────────────────────────────────
    execSync(`node "${seedScript}"`, { env: process.env });

    // ── B5. Assert children are not recreated and storeId is preserved ───

    // Product.storeId must remain the test store
    const productAfterB = await prisma.product.findUnique({
      where: { id: product!.id },
    });
    expect(productAfterB!.storeId).toBe(testStore.id);

    // Variant must NOT be recreated
    const variantAfterB = await prisma.productVariant.findUnique({
      where: { skuCode: 'DEMO-ELECTRONICS-001-DEFAULT' },
    });
    expect(variantAfterB).toBeNull();

    // Shipping must NOT be recreated
    const shippingAfterB = await prisma.productShippingProfile.findUnique({
      where: { productId: product!.id },
    });
    expect(shippingAfterB).toBeNull();

    // No new SearchOutbox entries
    const outboxCountAfterB = await prisma.searchOutbox.count({
      where: { productId: product!.id },
    });
    expect(outboxCountAfterB).toBe(outboxCountBefore);

    // Still no duplicates
    const productCountB = await prisma.product.count({
      where: { externalId: 'internal:demo-electronics-001' },
    });
    expect(productCountB).toBe(1);

    // No duplicate variants
    const variantCount = await prisma.productVariant.count({
      where: { productId: product!.id },
    });
    expect(variantCount).toBe(0);

    // ── Cleanup is handled entirely by afterAll ──────────────────────────
  }, 15_000);
});
