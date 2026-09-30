import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Public listing filters and cursor (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sellerId: number;
  let storeId: number;
  let parentCategoryId: number;
  let categoryId: number;
  let otherCategoryId: number;
  let brandId: number;
  let otherBrandId: number;
  const marker = `public-filters-${Date.now()}`;
  const ids: number[] = [];
  const stockedIds: number[] = [];
  let invalidStockId: number;
  let lateId: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    sellerId = (
      await prisma.user.create({
        data: {
          email: `${marker}@example.com`,
          passwordHash: 'unused',
          role: 'SELLER',
        },
      })
    ).id;
    storeId = (
      await prisma.store.create({
        data: { sellerId, name: marker, status: 'ACTIVE' },
      })
    ).id;
    parentCategoryId = (
      await prisma.category.create({
        data: { name: `${marker}-parent`, slug: `${marker}-parent` },
      })
    ).id;
    categoryId = (
      await prisma.category.create({
        data: { name: marker, slug: marker, parentId: parentCategoryId },
      })
    ).id;
    otherCategoryId = (
      await prisma.category.create({
        data: { name: marker, slug: `${marker}-other` },
      })
    ).id;
    brandId = (
      await prisma.brand.create({ data: { name: marker, slug: marker } })
    ).id;
    otherBrandId = (
      await prisma.brand.create({
        data: { name: marker, slug: `${marker}-other` },
      })
    ).id;
    for (let i = 0; i < 30; i++) {
      const product = await prisma.product.create({
        data: {
          storeId,
          categoryId,
          brandId: otherBrandId,
          name: `${marker}-${i}`,
          sellerStatus: 'ACTIVE',
          moderationStatus: 'APPROVED',
          images: {
            create: { url: '/uploads/test-filter.png', isPrimary: true },
          },
          shippingProfile: { create: { packageWeightGrams: 100 } },
          variants: {
            create: {
              skuCode: `${marker}-${i}`,
              optionSignature: '',
              price: '100',
              stock: i % 2 === 0 ? 1 : 0,
            },
          },
        },
      });
      ids.push(product.id);
      if (i % 2 === 0) stockedIds.push(product.id);
    }
    lateId = ids[28];
    await prisma.product.update({ where: { id: lateId }, data: { brandId } });
    // A stocked but incomplete option combination must not make this product in stock.
    invalidStockId = ids[29];
    const group = await prisma.productOptionGroup.create({
      data: { productId: invalidStockId, name: 'Color' },
    });
    const value = await prisma.productOptionValue.create({
      data: { groupId: group.id, productId: invalidStockId, value: 'Black' },
    });
    const valid = await prisma.productVariant.findFirstOrThrow({
      where: { productId: invalidStockId },
    });
    await prisma.productVariantOptionValue.create({
      data: {
        variantId: valid.id,
        productId: invalidStockId,
        optionGroupId: group.id,
        optionValueId: value.id,
      },
    });
    await prisma.productVariant.create({
      data: {
        productId: invalidStockId,
        storeId,
        skuCode: `${marker}-invalid`,
        optionSignature: 'incomplete',
        price: '100',
        stock: 10,
      },
    });
    await prisma.productVariant.create({
      data: {
        productId: invalidStockId,
        storeId,
        skuCode: `${marker}-inactive`,
        optionSignature: 'inactive',
        price: '100',
        stock: 10,
        isActive: false,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      if (storeId) {
        await prisma.product.deleteMany({ where: { storeId } });
        await prisma.store.delete({ where: { id: storeId } });
      }
      await prisma.category.deleteMany({
        where: { parentId: parentCategoryId },
      });
      await prisma.category.deleteMany({
        where: { slug: { startsWith: marker } },
      });
      await prisma.brand.deleteMany({
        where: { slug: { startsWith: marker } },
      });
      if (sellerId) await prisma.user.delete({ where: { id: sellerId } });
    }
    if (app) await app.close();
  });

  const list = (query: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .get('/products')
      .query({ storeId, ...query });

  it('finds a matching brand beyond the first 24 public products', async () => {
    const first = await list({ limit: 24 }).expect(200);
    expect(first.body.items).toHaveLength(24);
    expect(
      first.body.items.map((item: { id: number }) => item.id),
    ).not.toContain(lateId);
    const filtered = await list({ limit: 24, brandId }).expect(200);
    expect(filtered.body.items.map((item: { id: number }) => item.id)).toEqual([
      lateId,
    ]);
  });

  it('filters stock using only valid active variants, including explicit false', async () => {
    const stocked = await list({ limit: 50, inStock: true }).expect(200);
    expect(stocked.body.items.map((item: { id: number }) => item.id)).toEqual(
      stockedIds,
    );
    const empty = await list({ limit: 50, inStock: false }).expect(200);
    expect(empty.body.items.map((item: { id: number }) => item.id)).toEqual(
      ids.filter((id) => !stockedIds.includes(id)),
    );
    expect(empty.body.items.map((item: { id: number }) => item.id)).toContain(
      invalidStockId,
    );
    await list({ inStock: 'garbage' }).expect(400);
    await list({ inStock: '0' }).expect(400);
    await list({ brandId: -1 }).expect(400);
  });

  it('combines category, brand and stock and rechecks public eligibility', async () => {
    const result = await list({ categoryId, brandId, inStock: true }).expect(
      200,
    );
    expect(result.body.items.map((item: { id: number }) => item.id)).toEqual([
      lateId,
    ]);
    expect(
      (
        await list({
          categoryId: otherCategoryId,
          brandId,
          inStock: true,
        }).expect(200)
      ).body.items,
    ).toEqual([]);
    try {
      await prisma.product.update({
        where: { id: lateId },
        data: { sellerStatus: 'HIDDEN' },
      });
      expect(
        (await list({ brandId, inStock: true }).expect(200)).body.items,
      ).toEqual([]);
    } finally {
      await prisma.product.update({
        where: { id: lateId },
        data: { sellerStatus: 'ACTIVE' },
      });
    }
  });

  it('treats a parent category as its complete active subtree', async () => {
    const child = await list({ categoryId, brandId, inStock: true }).expect(
      200,
    );
    const parent = await list({
      categoryId: parentCategoryId,
      brandId,
      inStock: true,
    }).expect(200);
    expect(parent.body.items).toEqual(child.body.items);

    await prisma.category.update({
      where: { id: categoryId },
      data: { isActive: false },
    });
    try {
      expect(
        (await list({ categoryId: parentCategoryId }).expect(200)).body.items,
      ).toEqual([]);
    } finally {
      await prisma.category.update({
        where: { id: categoryId },
        data: { isActive: true },
      });
    }
  });

  it('paginates filtered rows without omissions or duplicates', async () => {
    let afterId: number | undefined;
    const seen: number[] = [];
    let ended = false;
    for (let page = 0; page < 30; page++) {
      const response = await list({
        limit: 3,
        categoryId,
        brandId: otherBrandId,
        inStock: true,
        ...(afterId ? { afterId } : {}),
      }).expect(200);
      seen.push(...response.body.items.map((item: { id: number }) => item.id));
      if (response.body.nextCursor === null) {
        ended = true;
        break;
      }
      expect(response.body.nextCursor).toBeGreaterThan(afterId ?? 0);
      afterId = response.body.nextCursor as number;
    }
    expect(ended).toBe(true);
    expect(seen).toEqual(stockedIds.filter((id) => id !== lateId));
    expect(new Set(seen).size).toBe(seen.length);
  });
});
