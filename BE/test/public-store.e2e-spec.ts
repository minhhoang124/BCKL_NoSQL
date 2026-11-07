import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';
describe('Public storefront — real read-only HTTP/PostgreSQL', () => {
  let app: INestApplication, db: PrismaService;
  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  async function fixture(withProduct = true) {
    const seller = await db.user.create({
      data: {
        email: `store-${randomUUID()}@example.invalid`,
        passwordHash: 'NOT_A_LOGIN_FIXTURE',
        role: 'SELLER',
      },
    });
    const store = await db.store.create({
      data: {
        sellerId: seller.id,
        name: 'Public QA Shop',
        description: 'Giới thiệu công khai',
        status: 'ACTIVE',
      },
    });
    const category = await db.category.create({
      data: { name: 'Public QA category', slug: randomUUID() },
    });
    const product = async (name = 'Public QA product') =>
      db.product.create({
        data: {
          storeId: store.id,
          categoryId: category.id,
          name,
          sellerStatus: 'ACTIVE',
          moderationStatus: 'APPROVED',
          images: {
            create: { url: '/uploads/synthetic-store.png', isPrimary: true },
          },
          shippingProfile: { create: { packageWeightGrams: 100 } },
          variants: {
            create: {
              skuCode: randomUUID(),
              optionSignature: '[]',
              price: '10000.00',
              stock: 2,
            },
          },
        },
        include: { variants: true },
      });
    return {
      seller,
      store,
      category,
      product,
      initial: withProduct ? await product() : null,
    };
  }
  const get = (id: number | string, q = '') =>
    request(app.getHttpServer()).get(`/stores/${id}${q}`);
  it('guest receives only public Store fields and shared public Product projection', async () => {
    const f = await fixture(),
      before = await db.store.findUniqueOrThrow({ where: { id: f.store.id } }),
      counts = [
        await db.order.count(),
        await db.stockMovement.count(),
        await db.searchOutbox.count(),
        await db.searchReconciliationJob.count(),
      ];
    const r = await get(f.store.id).expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.store).toEqual({
      id: f.store.id,
      name: f.store.name,
      description: f.store.description,
    });
    expect(r.body.items.map((p: { id: number }) => p.id)).toEqual([
      f.initial!.id,
    ]);
    const text = JSON.stringify(r.body);
    for (const key of [
      'sellerId',
      'passwordHash',
      'email',
      'contactPhone',
      'pickupAddress',
      'statusHistory',
      'externalId',
      'rejectionReason',
    ])
      expect(text).not.toContain(`"${key}"`);
    expect(
      await db.store.findUniqueOrThrow({ where: { id: f.store.id } }),
    ).toEqual(before);
    expect([
      await db.order.count(),
      await db.stockMovement.count(),
      await db.searchOutbox.count(),
      await db.searchReconciliationJob.count(),
    ]).toEqual(counts);
  });
  it.each(['PENDING', 'REJECTED', 'SUSPENDED', 'CLOSED'] as const)(
    'does not disclose %s Store',
    async (status) => {
      const f = await fixture();
      await db.store.update({ where: { id: f.store.id }, data: { status } });
      const r = await get(f.store.id).expect(404);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(r.body)).not.toContain(f.store.name);
    },
  );
  it('does not disclose a Store whose owner is inactive', async () => {
    const f = await fixture();
    await db.user.update({
      where: { id: f.seller.id },
      data: { isActive: false },
    });
    await get(f.store.id).expect(404);
  });
  it('active Store with no public Product is an empty profile, not a fabricated listing', async () => {
    const f = await fixture(false),
      r = await get(f.store.id).expect(200);
    expect(r.body).toEqual({
      store: {
        id: f.store.id,
        name: f.store.name,
        description: f.store.description,
      },
      items: [],
      nextCursor: null,
    });
  });
  it('hides own drafts/rejections and never mixes another Store', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.product.create({
      data: {
        storeId: f.store.id,
        categoryId: f.category.id,
        name: 'PRIVATE DRAFT',
        sellerStatus: 'DRAFT',
      },
    });
    const rejected = await f.product('PRIVATE REJECTED');
    await db.product.update({
      where: { id: rejected.id },
      data: { moderationStatus: 'REJECTED' },
    });
    const r = await get(f.store.id).expect(200);
    expect(r.body.items.map((p: { id: number }) => p.id)).toEqual([
      f.initial!.id,
    ]);
    expect(JSON.stringify(r.body)).not.toContain('PRIVATE');
    expect(
      r.body.items.every(
        (p: { store: { id: number } }) => p.store.id !== other.store.id,
      ),
    ).toBe(true);
  });
  it('shares inactive-ancestor, Brand and missing-required-attribute rules with public Product', async () => {
    const f = await fixture(),
      parent = await db.category.create({
        data: { name: 'Disabled parent', slug: randomUUID(), isActive: false },
      });
    await db.category.update({
      where: { id: f.category.id },
      data: { parentId: parent.id },
    });
    expect((await get(f.store.id).expect(200)).body.items).toEqual([]);
    await db.category.update({
      where: { id: parent.id },
      data: { isActive: true },
    });
    const brand = await db.brand.create({
      data: {
        name: 'Hidden brand ' + randomUUID(),
        slug: randomUUID(),
        isActive: false,
      },
    });
    await db.product.update({
      where: { id: f.initial!.id },
      data: { brandId: brand.id },
    });
    expect((await get(f.store.id).expect(200)).body.items).toEqual([]);
    await db.product.update({
      where: { id: f.initial!.id },
      data: { brandId: null },
    });
    await db.categoryAttributeDefinition.create({
      data: {
        categoryId: f.category.id,
        name: 'Required QA field',
        slug: 'required-qa',
        dataType: 'TEXT',
        isRequired: true,
      },
    });
    expect((await get(f.store.id).expect(200)).body.items).toEqual([]);
  });
  it('shows a valid out-of-stock Product accurately', async () => {
    const f = await fixture();
    await db.productVariant.update({
      where: { id: f.initial!.variants[0].id },
      data: { stock: 0 },
    });
    const r = await get(f.store.id).expect(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].inStock).toBe(false);
    expect(r.body.items[0].minPrice).toBe('10000');
  });
  it('keyset pagination stays in Store and immediately drops newly hidden Product', async () => {
    const f = await fixture(),
      second = await f.product('Second QA'),
      third = await f.product('Third QA');
    const first = await get(f.store.id, '?limit=1').expect(200);
    expect(first.body.nextCursor).toBe(f.initial!.id);
    await db.product.update({
      where: { id: second.id },
      data: { sellerStatus: 'HIDDEN' },
    });
    const next = await get(
      f.store.id,
      `?limit=1&afterId=${first.body.nextCursor}`,
    ).expect(200);
    expect(next.body.items.map((p: { id: number }) => p.id)).toEqual([
      third.id,
    ]);
    expect(next.body.nextCursor).toBeNull();
  });
  it('bounded empty scan returns a cursor so a later valid Product remains reachable', async () => {
    const f = await fixture(false);
    await db.product.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        storeId: f.store.id,
        categoryId: f.category.id,
        name: 'Incomplete approved fixture ' + i,
        sellerStatus: 'ACTIVE' as const,
        moderationStatus: 'APPROVED' as const,
      })),
    });
    const valid = await f.product('Reachable valid Product');
    const first = await get(f.store.id).expect(200);
    expect(first.body.items).toEqual([]);
    expect(first.body.nextCursor).toBeGreaterThan(0);
    const next = await get(
      f.store.id,
      `?afterId=${first.body.nextCursor}`,
    ).expect(200);
    expect(next.body.items.map((p: { id: number }) => p.id)).toEqual([
      valid.id,
    ]);
  });
  it.each(['0', '01', '2147483648', '-1', 'abc'])(
    'rejects bad Store ID %s',
    async (id) => {
      const r = await get(id).expect(400);
      expect(r.headers['cache-control']).toBe('no-store');
    },
  );
  it.each([
    '?limit=0',
    '?limit=49',
    '?limit=1&limit=2',
    '?afterId[]=1',
    '?storeId=1',
    '?sellerId=1',
  ])('rejects query %s', async (q) => {
    const f = await fixture(false);
    await get(f.store.id, q).expect(400);
  });
  it('rejects GET body before controller and preserves no-store on HEAD', async () => {
    const f = await fixture(false);
    await request(app.getHttpServer())
      .get(`/stores/${f.store.id}`)
      .send({ amount: 1 })
      .expect(400);
    const r = await request(app.getHttpServer())
      .head(`/stores/${f.store.id}`)
      .expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
