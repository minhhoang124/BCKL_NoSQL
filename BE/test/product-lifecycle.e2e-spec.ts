import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { ProductImageStorageService } from '../src/product/product-image-storage.service.js';
import { ProductLifecycleService } from '../src/product/product-lifecycle.service.js';
import { vi } from 'vitest';

describe('Product moderation and public visibility (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tempRoot: string;
  let categoryId: number;
  let rootId: number;
  let storeId: number;
  let sellerId: number;
  let adminId: number;
  const tokens: Record<string, string> = {};
  const marker = `lifecycle-${Date.now()}`;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bckl-lifecycle-'));
    process.env.UPLOAD_ROOT = tempRoot;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const passwordHash = await hash('StrongPass123!', 12);
    for (const [key, role] of Object.entries({
      seller: Role.SELLER,
      other: Role.SELLER,
      admin: Role.ADMIN,
      buyer: Role.USER,
    })) {
      const user = await prisma.user.create({
        data: { email: `${marker}-${key}@example.com`, passwordHash, role },
      });
      if (key === 'seller') sellerId = user.id;
      if (key === 'admin') adminId = user.id;
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: 'StrongPass123!' })
        .expect(200);
      tokens[key] = login.body.accessToken as string;
    }
    const store = await prisma.store.create({
      data: { name: marker, sellerId, status: 'ACTIVE' },
    });
    storeId = store.id;
    const root = await prisma.category.create({
      data: { name: marker, slug: marker },
    });
    rootId = root.id;
    const leaf = await prisma.category.create({
      data: { name: 'Leaf', slug: `${marker}-leaf`, parentId: rootId },
    });
    categoryId = leaf.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) {
      if (storeId) {
        await prisma.product.deleteMany({ where: { storeId } });
        await prisma.store.delete({ where: { id: storeId } });
      }
      if (categoryId)
        await prisma.category.delete({ where: { id: categoryId } });
      if (rootId) await prisma.category.delete({ where: { id: rootId } });
      await prisma.user.deleteMany({
        where: { email: { startsWith: marker } },
      });
    }
    if (app) await app.close();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  async function fixture(stock = 0) {
    const created = await request(app.getHttpServer())
      .post('/seller/products')
      .auth(tokens.seller, { type: 'bearer' })
      .send({ name: 'Lifecycle test product', categoryId })
      .expect(201);
    const id = created.body.id as number;
    await request(app.getHttpServer())
      .post(`/seller/products/${id}/images`)
      .auth(tokens.seller, { type: 'bearer' })
      .attach('file', png, 'demo.png')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/seller/products/${id}/variants`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ price: '120000', stock })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/seller/products/${id}/shipping-profile`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ packageWeightGrams: 500 })
      .expect(200);
    return id;
  }

  async function submit(id: number) {
    const response = await request(app.getHttpServer())
      .post(`/seller/products/${id}/submit`)
      .auth(tokens.seller, { type: 'bearer' })
      .expect(200);
    return response.body.version as number;
  }
  function decision(
    id: number,
    version: number,
    action = 'approve',
    token = tokens.admin,
    reason?: string,
  ) {
    return request(app.getHttpServer())
      .post(`/admin/products/${id}/${action}`)
      .auth(token, { type: 'bearer' })
      .send({ version, ...(reason === undefined ? {} : { reason }) });
  }
  async function approved(stock = 0) {
    const id = await fixture(stock);
    const version = await submit(id);
    const response = await decision(id, version).expect(200);
    return { id, version: response.body.version as number };
  }
  async function assertInvisible(id: number) {
    await request(app.getHttpServer()).get(`/products/${id}`).expect(404);
    const list = await request(app.getHttpServer())
      .get('/products')
      .query({ storeId, afterId: id - 1, limit: 50 })
      .expect(200);
    expect(list.body.items.some((item: { id: number }) => item.id === id)).toBe(
      false,
    );
  }

  it('enforces Admin roles and version/reason validation', async () => {
    const id = await fixture();
    const version = await submit(id);
    await request(app.getHttpServer())
      .get('/admin/products/review-queue')
      .expect(401);
    await decision(id, version, 'approve', tokens.seller).expect(403);
    await decision(id, version, 'approve', tokens.buyer).expect(403);
    await request(app.getHttpServer())
      .post(`/admin/products/${id}/approve`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({})
      .expect(400);
    await decision(id, version, 'reject', tokens.admin, '   ').expect(400);
    await decision(id, version - 1).expect(409);
    const detail = await request(app.getHttpServer())
      .get(`/admin/products/${id}`)
      .auth(tokens.admin, { type: 'bearer' })
      .expect(200);
    expect(detail.body.version).toBe(version);
    const queue = await request(app.getHttpServer())
      .get('/admin/products/review-queue')
      .query({ afterId: id - 1 })
      .auth(tokens.admin, { type: 'bearer' })
      .expect(200);
    expect(
      queue.body.items.some((item: { id: number }) => item.id === id),
    ).toBe(true);
  });

  it('keeps DRAFT/PENDING private, publishes approved out-of-stock products and excludes private fields', async () => {
    const id = await fixture();
    await assertInvisible(id);
    const version = await submit(id);
    await assertInvisible(id);
    await decision(id, version).expect(200);
    const detail = await request(app.getHttpServer())
      .get(`/products/${id}`)
      .expect(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(detail.body).toMatchObject({
      id,
      inStock: false,
      minPrice: '120000',
      maxPrice: '120000',
      brand: null,
    });
    for (const key of [
      'externalId',
      'reviewedBy',
      'rejectionReason',
      'statusHistory',
      'version',
    ])
      expect(detail.body).not.toHaveProperty(key);
    expect(detail.body.store).not.toHaveProperty('sellerId');
    expect(detail.body.variants[0]).not.toHaveProperty('sellerSku');
    const history = await prisma.productStatusHistory.findMany({
      where: { productId: id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorId: adminId,
      fromModerationStatus: 'PENDING',
      toModerationStatus: 'APPROVED',
      version: version + 1,
    });
  });

  it('allows only one of competing approve/reject decisions and rejects replay', async () => {
    const id = await fixture();
    const version = await submit(id);
    const results = await Promise.all([
      decision(id, version),
      decision(id, version, 'reject', tokens.admin, 'Needs corrections'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.productStatusHistory.count({ where: { productId: id } }),
    ).toBe(1);
    await decision(id, version).expect(409);
  });

  it('uses DB version checks across service instances without a shared process lock', async () => {
    const id = await fixture();
    const version = await submit(id);
    const first = new ProductLifecycleService(
      prisma,
      new ProductImageStorageService(),
    );
    const second = new ProductLifecycleService(
      prisma,
      new ProductImageStorageService(),
    );
    const results = await Promise.allSettled([
      first.moderate(id, adminId, version, 'APPROVED'),
      second.moderate(id, adminId, version, 'REJECTED', 'Concurrent review'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failure = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failure.reason.getStatus()).toBe(409);
    expect(
      await prisma.productStatusHistory.count({ where: { productId: id } }),
    ).toBe(1);
  });

  it('rolls back the decision if audit insertion fails', async () => {
    const id = await fixture();
    const version = await submit(id);
    // Reserve the next audit version to simulate a transactional write failure.
    await prisma.productStatusHistory.create({
      data: {
        productId: id,
        actorId: adminId,
        version: version + 1,
        fromSellerStatus: 'ACTIVE',
        toSellerStatus: 'ACTIVE',
        fromModerationStatus: 'PENDING',
        toModerationStatus: 'APPROVED',
      },
    });
    await decision(id, version).expect(409);
    expect(await prisma.product.findUnique({ where: { id } })).toMatchObject({
      version,
      moderationStatus: 'PENDING',
    });
  });

  it('supports reject, correction, resubmit; previous version cannot approve new content', async () => {
    const id = await fixture();
    const oldVersion = await submit(id);
    await decision(
      id,
      oldVersion,
      'reject',
      tokens.admin,
      'Fix the name',
    ).expect(200);
    await request(app.getHttpServer())
      .patch(`/seller/products/${id}`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ name: 'Corrected name' })
      .expect(200);
    const newVersion = await submit(id);
    await decision(id, oldVersion).expect(409);
    await decision(id, newVersion).expect(200);
    const history = await prisma.productStatusHistory.findMany({
      where: { productId: id },
      orderBy: { version: 'asc' },
    });
    expect(history.map((row) => row.toModerationStatus)).toEqual([
      'REJECTED',
      'APPROVED',
    ]);
    expect(history[0].reason).toBe('Fix the name');
  });

  it('hides/shows immediately, checks owner and version, and blocks Seller unfreezing', async () => {
    const product = await approved(2);
    const visibility = (token: string, version: number, sellerStatus: string) =>
      request(app.getHttpServer())
        .patch(`/seller/products/${product.id}/visibility`)
        .auth(token, { type: 'bearer' })
        .send({ version, sellerStatus });
    await visibility(tokens.other, product.version, 'HIDDEN').expect(404);
    const hidden = await visibility(
      tokens.seller,
      product.version,
      'HIDDEN',
    ).expect(200);
    await assertInvisible(product.id);
    await visibility(tokens.seller, product.version, 'ACTIVE').expect(409);
    const shown = await visibility(
      tokens.seller,
      hidden.body.version as number,
      'ACTIVE',
    ).expect(200);
    await request(app.getHttpServer())
      .get(`/products/${product.id}`)
      .expect(200);
    await decision(
      product.id,
      shown.body.version as number,
      'freeze',
      tokens.admin,
      'Policy violation',
    ).expect(200);
    await assertInvisible(product.id);
    await visibility(
      tokens.seller,
      (shown.body.version as number) + 1,
      'ACTIVE',
    ).expect(403);
    await request(app.getHttpServer())
      .patch(`/seller/products/${product.id}`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ name: 'Cannot bypass freeze' })
      .expect(403);
  });

  it('content edits reset approval and remove the listing immediately', async () => {
    const product = await approved();
    const edit = await request(app.getHttpServer())
      .patch(`/seller/products/${product.id}`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ description: 'New unreviewed description' })
      .expect(200);
    expect(edit.body).toMatchObject({
      moderationStatus: 'NOT_SUBMITTED',
      sellerStatus: 'DRAFT',
    });
    await assertInvisible(product.id);
    await decision(product.id, product.version).expect(409);
  });

  it('rechecks Store, owner and category ancestors on every public read', async () => {
    const { id } = await approved();
    try {
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });
      await assertInvisible(id);
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'ACTIVE' },
      });
      await prisma.user.update({
        where: { id: sellerId },
        data: { isActive: false },
      });
      await assertInvisible(id);
      await prisma.user.update({
        where: { id: sellerId },
        data: { isActive: true },
      });
      await prisma.category.update({
        where: { id: rootId },
        data: { isActive: false },
      });
      await assertInvisible(id);
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
    }
    await request(app.getHttpServer()).get(`/products/${id}`).expect(200);
  });

  it('new required attributes immediately block public reads and approval; false and zero are valid values', async () => {
    const product = await approved();
    const pendingId = await fixture();
    const version = await submit(pendingId);
    const definition = await prisma.categoryAttributeDefinition.create({
      data: {
        categoryId,
        name: 'Required switch',
        slug: `${marker}-switch`,
        dataType: 'BOOLEAN',
        isRequired: true,
      },
    });
    try {
      await assertInvisible(product.id);
      await decision(pendingId, version).expect(400);
      await prisma.productAttributeValue.create({
        data: {
          productId: product.id,
          attributeDefinitionId: definition.id,
          booleanValue: false,
        },
      });
      await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .expect(200);
      await prisma.categoryAttributeDefinition.update({
        where: { id: definition.id },
        data: { dataType: 'NUMBER' },
      });
      await assertInvisible(product.id);
      await prisma.productAttributeValue.updateMany({
        where: { productId: product.id, attributeDefinitionId: definition.id },
        data: { booleanValue: null, numberValue: 0 },
      });
      await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .expect(200);
    } finally {
      await prisma.productAttributeValue.deleteMany({
        where: { attributeDefinitionId: definition.id },
      });
      await prisma.categoryAttributeDefinition.delete({
        where: { id: definition.id },
      });
    }
  });

  it('rejects approval if listing prerequisites change after submission', async () => {
    const id = await fixture();
    const version = await submit(id);
    await prisma.productShippingProfile.update({
      where: { productId: id },
      data: { packageWeightGrams: null },
    });
    await decision(id, version).expect(400);
    expect(
      await prisma.productStatusHistory.count({ where: { productId: id } }),
    ).toBe(0);
  });

  it.each(['image', 'variant', 'shipping', 'option-structure'])(
    'filters an approved product when %s becomes invalid',
    async (part) => {
      const { id } = await approved();
      if (part === 'image')
        await prisma.productImage.updateMany({
          where: { productId: id },
          data: { isPrimary: false },
        });
      if (part === 'variant')
        await prisma.productVariant.updateMany({
          where: { productId: id },
          data: { isActive: false },
        });
      if (part === 'shipping')
        await prisma.productShippingProfile.update({
          where: { productId: id },
          data: { packageWeightGrams: null },
        });
      if (part === 'option-structure')
        await prisma.productOptionGroup.create({
          data: { productId: id, name: 'New color' },
        });
      await assertInvisible(id);
    },
  );

  it('does not reveal drafts through visibility or approve without submission', async () => {
    const id = await fixture();
    const product = await prisma.product.findUniqueOrThrow({ where: { id } });
    await decision(id, product.version).expect(409);
    await request(app.getHttpServer())
      .patch(`/seller/products/${id}/visibility`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ version: product.version, sellerStatus: 'ACTIVE' })
      .expect(403);
    await assertInvisible(id);
  });

  it('visibility no-op does not create another audit and suspended Store cannot show', async () => {
    const product = await approved();
    const url = `/seller/products/${product.id}/visibility`;
    const unchanged = await request(app.getHttpServer())
      .patch(url)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ version: product.version, sellerStatus: 'ACTIVE' })
      .expect(200);
    expect(unchanged.body.version).toBe(product.version);
    expect(
      await prisma.productStatusHistory.count({
        where: { productId: product.id },
      }),
    ).toBe(1);
    try {
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });
      const hidden = await request(app.getHttpServer())
        .patch(url)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ version: product.version, sellerStatus: 'HIDDEN' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(url)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ version: hidden.body.version, sellerStatus: 'ACTIVE' })
        .expect(400);
      await assertInvisible(product.id);
    } finally {
      await prisma.store.update({
        where: { id: storeId },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('waits for image publish/compensation before a moderation decision', async () => {
    const id = await fixture();
    const version = await submit(id);
    const storage = app.get(ProductImageStorageService);
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = storage.withProductImageLock(id, async () => {
      started();
      await gate;
    });
    await ready;
    let finished = false;
    const response = decision(id, version).then((result) => {
      finished = true;
      return result;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(finished).toBe(false);
    } finally {
      release();
    }
    await locked;
    expect((await response).status).toBe(200);
  });

  it('paginates public products without returning hidden records or duplicate IDs', async () => {
    await approved();
    await approved();
    let afterId: number | undefined;
    const seen = new Set<number>();
    for (let page = 0; page < 30; page++) {
      const response = await request(app.getHttpServer())
        .get('/products')
        .query({
          storeId,
          categoryId,
          limit: 1,
          ...(afterId ? { afterId } : {}),
        })
        .expect(200);
      for (const item of response.body.items as { id: number }[]) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
        await request(app.getHttpServer())
          .get(`/products/${item.id}`)
          .expect(200);
      }
      if (response.body.nextCursor === null) break;
      expect(response.body.nextCursor).toBeGreaterThan(afterId ?? 0);
      afterId = response.body.nextCursor as number;
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
    await request(app.getHttpServer()).get('/products?limit=51').expect(400);
    await request(app.getHttpServer()).get('/products?afterId=-1').expect(400);
    await request(app.getHttpServer())
      .get('/products/99999999999999999')
      .expect(400);
    await request(app.getHttpServer())
      .get('/products?storeId=99999999999999999')
      .expect(400);
  });
});
