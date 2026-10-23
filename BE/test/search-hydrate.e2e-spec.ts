import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Role, type Product } from '@prisma/client';
import { hash } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { App } from './http-test-types.js';
import { vi } from 'vitest';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { SearchService } from '../src/search/search.service.js';
import { SearchSyncWorker } from '../src/search/search-sync.worker.js';
import { SearchOutboxService } from '../src/search/search-outbox.service.js';
import { SearchReconciliationService } from '../src/search/search-reconciliation.service.js';
import { SearchReconciliationWorker } from '../src/search/search-reconciliation.worker.js';
import { ProductImageStorageService } from '../src/product/product-image-storage.service.js';
import { ProductImageRepairService } from '../src/product/product-image-repair.service.js';
import { ProductImageRepairWorker } from '../src/product/product-image-repair.worker.js';
import { ProductService } from '../src/product/product.service.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const PNG_DISTINCT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4z8DwH4QZYAwAR8oH+Xm0fdIAAAAASUVORK5CYII=',
  'base64',
);

describe('Search Hydrate & Filter API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tempRoot: string;

  // Shared test actors
  let sellerId: number;
  let categoryId: number;
  let rootCategoryId: number;
  let storeId: number;
  const tokens: Record<string, string> = {};
  const marker = `search-hydrate-${Date.now()}`;
  const backlogJobIds: bigint[] = [];
  const backlogCategoryIds: number[] = [];

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bckl-search-'));
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
      admin: Role.ADMIN,
    })) {
      const user = await prisma.user.create({
        data: { email: `${marker}-${key}@example.com`, passwordHash, role },
      });
      if (key === 'seller') sellerId = user.id;
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: 'StrongPass123!' })
        .expect(200);
      tokens[key] = login.body.accessToken as string;
    }

    // Create store, category tree
    const store = await prisma.store.create({
      data: { name: marker, sellerId, status: 'ACTIVE' },
    });
    storeId = store.id;

    const root = await prisma.category.create({
      data: { name: marker, slug: marker },
    });
    rootCategoryId = root.id;
    const leaf = await prisma.category.create({
      data: {
        name: 'SearchLeaf',
        slug: `${marker}-search-leaf`,
        parentId: rootCategoryId,
      },
    });
    categoryId = leaf.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (prisma) {
      await prisma.searchReconciliationJob.deleteMany({
        where: { id: { in: backlogJobIds } },
      });
      await prisma.category.deleteMany({
        where: { id: { in: backlogCategoryIds } },
      });
      if (storeId) {
        await prisma.product.deleteMany({ where: { storeId } });
        await prisma.store.delete({ where: { id: storeId } });
      }
      if (categoryId)
        await prisma.category.delete({ where: { id: categoryId } });
      if (rootCategoryId)
        await prisma.category.delete({ where: { id: rootCategoryId } });
      await prisma.user.deleteMany({
        // Keep actors referenced by immutable Attribute audits.
        where: {
          email: { startsWith: marker },
          attributeAuditActions: { none: {} },
        },
      });
    }
    if (app) await app.close();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // A runtime batch processes at most 20 jobs, not necessarily this request's
  // job. Wait on the durable identity instead of assuming an empty QA queue.
  // Terminal failures are assertions, unless that test explicitly expects one.
  // This never resets backoff or fabricates a successful job.
  async function settleReconciliation(
    jobIds: bigint[],
    runBatch = () => app.get(SearchReconciliationWorker).runBatch(),
    expectedStatus: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED',
  ): Promise<void> {
    expect(jobIds.length).toBeGreaterThan(0);
    for (let pass = 0; pass < 100; pass++) {
      // Run before reading: an explicitly re-eligible FAILED job must retry.
      await runBatch();
      const jobs = await prisma.searchReconciliationJob.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, status: true },
      });
      expect(jobs).toHaveLength(jobIds.length);
      if (
        jobs.every((job) =>
          ['SUCCEEDED', 'FAILED', 'DEAD'].includes(job.status),
        )
      ) {
        for (const job of jobs) expect(job.status).toBe(expectedStatus);
        return;
      }
      if (pass === 99)
        throw new Error(
          `Reconciliation did not settle: ${jobs.map((job) => `${job.id}:${job.status}`).join(', ')}`,
        );
    }
  }

  function reconciliationJobId(response: request.Response): bigint {
    expect(response.body.searchReconciliation?.jobId).toMatch(/^[1-9]\d*$/);
    return BigInt(response.body.searchReconciliation.jobId as string);
  }

  async function createAndApproveProduct(
    name: string,
    stock = 5,
  ): Promise<number> {
    // Create draft
    const created = await request(app.getHttpServer())
      .post('/seller/products')
      .auth(tokens.seller, { type: 'bearer' })
      .send({ name, categoryId })
      .expect(201);
    const id = created.body.id as number;

    // Add image
    await request(app.getHttpServer())
      .post(`/seller/products/${id}/images`)
      .auth(tokens.seller, { type: 'bearer' })
      .attach('file', PNG_1PX, 'test.png')
      .expect(201);

    // Add variant
    await request(app.getHttpServer())
      .post(`/seller/products/${id}/variants`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ price: '100000', stock })
      .expect(201);

    // Add shipping
    await request(app.getHttpServer())
      .patch(`/seller/products/${id}/shipping-profile`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ packageWeightGrams: 300 })
      .expect(200);

    // Submit
    await request(app.getHttpServer())
      .post(`/seller/products/${id}/submit`)
      .auth(tokens.seller, { type: 'bearer' })
      .expect(200);

    // Fetch actual version from DB (version increments on each operation)
    const productAfterSubmit = await prisma.product.findUniqueOrThrow({
      where: { id },
    });

    // Admin approve with the actual current version
    await request(app.getHttpServer())
      .post(`/admin/products/${id}/approve`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({ version: productAfterSubmit.version })
      .expect(200);

    return id;
  }

  // ---------------------------------------------------------------------------
  // Test 1: Filters out hidden products even when search index returns them
  // ---------------------------------------------------------------------------
  it('filters out a hidden product from search results (stale index simulation)', async () => {
    // Create two approved products
    const visibleId = await createAndApproveProduct(`${marker}-visible`);
    const hiddenId = await createAndApproveProduct(`${marker}-hidden`);

    // Hide the second product (Seller hides it)
    const hiddenProduct = await prisma.product.findUniqueOrThrow({
      where: { id: hiddenId },
    });
    await request(app.getHttpServer())
      .patch(`/seller/products/${hiddenId}/visibility`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ version: hiddenProduct.version, sellerStatus: 'HIDDEN' })
      .expect(200);

    // Mock FastAPI to return BOTH productIds (simulating stale index)
    const searchService = app.get(SearchService);
    vi.spyOn(
      searchService as unknown as {
        callFastApiSearch: () => Promise<unknown>;
      },
      'callFastApiSearch',
    ).mockResolvedValueOnce({
      query: { type: 'hybrid_text', text: 'test' },
      items: [
        { productId: visibleId, rank: 1, score: 0.9 },
        { productId: hiddenId, rank: 2, score: 0.8 },
      ],
      responseTimeMs: 5,
    });

    const res = await request(app.getHttpServer())
      .post('/search/hybrid')
      .send({ query: 'test' })
      .expect(200);

    const returnedIds = res.body.items.map(
      (item: { productId: number }) => item.productId,
    );
    expect(returnedIds).toContain(visibleId);
    expect(returnedIds).not.toContain(hiddenId);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Preserves rank order of results
  // ---------------------------------------------------------------------------
  it('preserves the relative rank order from search service', async () => {
    const id1 = await createAndApproveProduct(`${marker}-rank1`);
    const id2 = await createAndApproveProduct(`${marker}-rank2`);
    const id3 = await createAndApproveProduct(`${marker}-rank3`);

    // FastAPI returns rank: id2 > id3 > id1
    const searchService = app.get(SearchService);
    vi.spyOn(
      searchService as unknown as {
        callFastApiSearch: () => Promise<unknown>;
      },
      'callFastApiSearch',
    ).mockResolvedValueOnce({
      query: { type: 'hybrid_text', text: 'rank test' },
      items: [
        { productId: id2, rank: 1, score: 0.95 },
        { productId: id3, rank: 2, score: 0.85 },
        { productId: id1, rank: 3, score: 0.75 },
      ],
      responseTimeMs: 3,
    });

    const res = await request(app.getHttpServer())
      .post('/search/hybrid')
      .send({ query: 'rank test' })
      .expect(200);

    const returnedIds = res.body.items.map(
      (item: { productId: number }) => item.productId,
    );
    // Order must be preserved: id2, id3, id1
    expect(returnedIds.indexOf(id2)).toBeLessThan(returnedIds.indexOf(id3));
    expect(returnedIds.indexOf(id3)).toBeLessThan(returnedIds.indexOf(id1));
  });

  // ---------------------------------------------------------------------------
  // Test 3: Empty query returns 400
  // ---------------------------------------------------------------------------
  it('rejects empty search query with 400', async () => {
    await request(app.getHttpServer())
      .post('/search/hybrid')
      .send({ query: '   ' })
      .expect(400);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Missing query returns 400
  // ---------------------------------------------------------------------------
  it('rejects missing search query with 400', async () => {
    await request(app.getHttpServer())
      .post('/search/hybrid')
      .send({})
      .expect(400);
  });

  it.each([
    ['missing query envelope', { items: [], responseTimeMs: 1 }],
    [
      'wrong query type literal',
      {
        query: { type: 'text', text: 'test' },
        items: [],
        responseTimeMs: 1,
      },
    ],
    [
      'missing query text',
      { query: { type: 'hybrid_text' }, items: [], responseTimeMs: 1 },
    ],
    [
      'extra envelope field',
      {
        query: { type: 'hybrid_text', text: 'test' },
        items: [],
        responseTimeMs: 1,
        debug: true,
      },
    ],
    [
      'extra query field',
      {
        query: { type: 'hybrid_text', text: 'test', topK: 20 },
        items: [],
        responseTimeMs: 1,
      },
    ],
    [
      'extra item field',
      {
        query: { type: 'hybrid_text', text: 'test' },
        items: [{ productId: 1, rank: 1, score: 1, name: 'drift' }],
        responseTimeMs: 1,
      },
    ],
    [
      'invalid product id range',
      {
        query: { type: 'hybrid_text', text: 'test' },
        items: [{ productId: 0, rank: 1, score: 1 }],
        responseTimeMs: 1,
      },
    ],
    [
      'invalid rank range',
      {
        query: { type: 'hybrid_text', text: 'test' },
        items: [{ productId: 1, rank: 0, score: 1 }],
        responseTimeMs: 1,
      },
    ],
    [
      'non-finite score',
      {
        query: { type: 'hybrid_text', text: 'test' },
        items: [{ productId: 1, rank: 1, score: Number.POSITIVE_INFINITY }],
        responseTimeMs: 1,
      },
    ],
    [
      'non-finite response time',
      {
        query: { type: 'hybrid_text', text: 'test' },
        items: [],
        responseTimeMs: Number.POSITIVE_INFINITY,
      },
    ],
  ])('rejects invalid Search Service response: %s', async (_name, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    try {
      await request(app.getHttpServer())
        .post('/search/hybrid')
        .send({ query: 'test' })
        .expect(500);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { topK: 51 },
    { candidateK: 151 },
    { topK: 30, candidateK: 20 },
    { minPrice: 20, maxPrice: 10 },
  ])('rejects incompatible search bounds %j', async (bounds) => {
    await request(app.getHttpServer())
      .post('/search/hybrid')
      .send({ query: 'headphones', ...bounds })
      .expect(400);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Outbox event is created when Admin approves a product
  // ---------------------------------------------------------------------------
  it('creates a PENDING UPSERT outbox event when Admin approves a product', async () => {
    const id = await createAndApproveProduct(`${marker}-outbox-check`);

    const outbox = await prisma.searchOutbox.findFirst({
      where: { productId: id, operation: 'UPSERT' },
      orderBy: { version: 'desc' },
    });

    expect(outbox).not.toBeNull();
    expect(outbox!.status).toBe('PENDING');
    expect(outbox!.operation).toBe('UPSERT');
    const payload = outbox!.payload as { productId: number };
    expect(payload.productId).toBe(id);
    expect(payload).toMatchObject({
      categoryId,
      categoryName: 'SearchLeaf',
      categoryPathIds: [rootCategoryId, categoryId],
      brandId: null,
    });
    expect(payload).not.toHaveProperty('category');
    expect(payload).not.toHaveProperty('brand');
  });

  it('rolls back product and history when outbox persistence fails', async () => {
    const id = await createAndApproveProduct(`${marker}-atomic-outbox`);
    const before = await prisma.product.findUniqueOrThrow({ where: { id } });
    const historyCount = await prisma.productStatusHistory.count({
      where: { productId: id },
    });
    const outboxCount = await prisma.searchOutbox.count({
      where: { productId: id },
    });
    const fail = vi
      .spyOn(app.get(SearchOutboxService), 'writeOutboxEvent')
      .mockRejectedValueOnce(new Error('injected outbox failure'));
    try {
      await request(app.getHttpServer())
        .patch(`/seller/products/${id}/visibility`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ version: before.version, sellerStatus: 'HIDDEN' })
        .expect(500);
    } finally {
      fail.mockRestore();
    }
    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.version).toBe(before.version);
    expect(after.sellerStatus).toBe(before.sellerStatus);
    expect(
      await prisma.productStatusHistory.count({ where: { productId: id } }),
    ).toBe(historyCount);
    expect(await prisma.searchOutbox.count({ where: { productId: id } })).toBe(
      outboxCount,
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: Outbox event is DELETE when Seller hides an approved product
  // ---------------------------------------------------------------------------
  it('creates a PENDING DELETE outbox event when Seller hides an approved product', async () => {
    const id = await createAndApproveProduct(`${marker}-hide-outbox`);
    const product = await prisma.product.findUniqueOrThrow({ where: { id } });

    await request(app.getHttpServer())
      .patch(`/seller/products/${id}/visibility`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ version: product.version, sellerStatus: 'HIDDEN' })
      .expect(200);

    // After hide, the most recent outbox should be DELETE
    const outbox = await prisma.searchOutbox.findFirst({
      where: { productId: id },
      orderBy: { version: 'desc' },
    });
    expect(outbox).not.toBeNull();
    expect(outbox!.operation).toBe('DELETE');
    expect(outbox!.status).toBe('PENDING');
  });

  // ---------------------------------------------------------------------------
  // Test 7: Worker processes UPSERT successfully (mocked fetch 200)
  // ---------------------------------------------------------------------------
  it('SearchSyncWorker marks outbox as SUCCEEDED on HTTP 200', async () => {
    // Create an outbox record manually
    const productId = await createAndApproveProduct(`${marker}-worker-test`);

    const outboxBefore = await prisma.searchOutbox.findFirst({
      where: { productId, status: 'PENDING' },
    });
    expect(outboxBefore).not.toBeNull();

    // Mock fetch to return 200
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            productId,
            version: outboxBefore!.version,
            operation: 'UPSERT',
            outcome: 'APPLIED',
            indexes: {
              elasticsearch: {
                status: 'SUCCEEDED',
                version: outboxBefore!.version,
              },
              faiss: { status: 'SUCCEEDED', version: outboxBefore!.version },
            },
          }),
      }),
    );

    const syncWorker = app.get(SearchSyncWorker);
    // Keep the worker query real, but restrict it to this test's event.
    const findMany = prisma.searchOutbox.findMany.bind(prisma.searchOutbox);
    const scope = vi
      .spyOn(prisma.searchOutbox, 'findMany')
      .mockImplementation((args) =>
        findMany({ ...args, where: { ...args?.where, id: outboxBefore!.id } }),
      );
    await syncWorker.runBatch();
    scope.mockRestore();

    const outboxAfter = await prisma.searchOutbox.findFirst({
      where: { productId },
      orderBy: { version: 'desc' },
    });
    expect(outboxAfter!.status).toBe('SUCCEEDED');
    expect(outboxAfter!.processedAt).not.toBeNull();

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Test 8: Frozen product -> DELETE outbox event
  // ---------------------------------------------------------------------------
  it('creates a DELETE outbox event when Admin freezes an approved product', async () => {
    const id = await createAndApproveProduct(`${marker}-freeze-outbox`);
    const product = await prisma.product.findUniqueOrThrow({ where: { id } });

    await request(app.getHttpServer())
      .post(`/admin/products/${id}/freeze`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({ version: product.version, reason: 'Policy violation test' })
      .expect(200);

    const outbox = await prisma.searchOutbox.findFirst({
      where: { productId: id },
      orderBy: { version: 'desc' },
    });
    expect(outbox).not.toBeNull();
    expect(outbox!.operation).toBe('DELETE');
  });

  // ===========================================================================
  // PR #23: Product Mutation Invalidation & Transactional Outbox Scenarios
  // ===========================================================================

  describe('Product Mutation Invalidation & Transactional Outbox', () => {
    // 1. Sửa Product APPROVED (PATCH /seller/products/:id) tạo outbox DELETE với version = V + 1
    it('creates a DELETE outbox event at V+1 when APPROVED product is edited via PATCH /seller/products/:id', async () => {
      const id = await createAndApproveProduct(`${marker}-mut-patch-appr`);
      const before = await prisma.product.findUniqueOrThrow({ where: { id } });
      const expectedVersion = before.version + 1;

      await request(app.getHttpServer())
        .patch(`/seller/products/${id}`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ name: `${marker}-mut-patch-appr-updated` })
        .expect(200);

      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(after.version).toBe(expectedVersion);
      expect(after.moderationStatus).toBe('NOT_SUBMITTED');
      expect(after.sellerStatus).toBe('DRAFT');

      const outbox = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: expectedVersion,
          },
        },
      });
      expect(outbox).not.toBeNull();
      expect(outbox!.operation).toBe('DELETE');
      expect(outbox!.status).toBe('PENDING');
      expect(outbox!.payload).toEqual({
        productId: id,
        version: expectedVersion,
      });
    });

    // 2. Sửa Product DRAFT (PATCH /seller/products/:id) không tạo outbox DELETE dư
    it('does not create any outbox event when editing a DRAFT product', async () => {
      const created = await request(app.getHttpServer())
        .post('/seller/products')
        .auth(tokens.seller, { type: 'bearer' })
        .send({ name: `${marker}-draft-mut`, categoryId })
        .expect(201);
      const id = created.body.id as number;

      const before = await prisma.product.findUniqueOrThrow({ where: { id } });
      const expectedVersion = before.version + 1;

      await request(app.getHttpServer())
        .patch(`/seller/products/${id}`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ name: `${marker}-draft-mut-renamed` })
        .expect(200);

      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(after.version).toBe(expectedVersion);

      const outbox = await prisma.searchOutbox.findFirst({
        where: { productId: id, version: expectedVersion },
      });
      expect(outbox).toBeNull();
    });

    // 3. Tạo Variant trên Product APPROVED (POST /seller/products/:id/variants) tạo outbox DELETE với version = V + 1
    it('creates a DELETE outbox event at V+1 when creating a variant on an APPROVED product', async () => {
      // Create product with option group and first option value
      const created = await request(app.getHttpServer())
        .post('/seller/products')
        .auth(tokens.seller, { type: 'bearer' })
        .send({ name: `${marker}-mut-var`, categoryId })
        .expect(201);
      const id = created.body.id as number;

      const groupRes = await request(app.getHttpServer())
        .post(`/seller/products/${id}/option-groups`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ name: 'Color' })
        .expect(201);
      const groupId = groupRes.body.id as number;

      const valRedRes = await request(app.getHttpServer())
        .post(`/seller/products/${id}/option-groups/${groupId}/values`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ value: 'Red' })
        .expect(201);
      const valRedId = valRedRes.body.id as number;

      const valBlueRes = await request(app.getHttpServer())
        .post(`/seller/products/${id}/option-groups/${groupId}/values`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ value: 'Blue' })
        .expect(201);
      const valBlueId = valBlueRes.body.id as number;

      // Add variant for Red
      await request(app.getHttpServer())
        .post(`/seller/products/${id}/variants`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ price: '100000', stock: 10, optionValueIds: [valRedId] })
        .expect(201);

      // Add image & shipping
      await request(app.getHttpServer())
        .post(`/seller/products/${id}/images`)
        .auth(tokens.seller, { type: 'bearer' })
        .attach('file', PNG_1PX, 'test.png')
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/seller/products/${id}/shipping-profile`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ packageWeightGrams: 300 })
        .expect(200);

      // Submit and approve
      await request(app.getHttpServer())
        .post(`/seller/products/${id}/submit`)
        .auth(tokens.seller, { type: 'bearer' })
        .expect(200);

      const prodAfterSubmit = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      await request(app.getHttpServer())
        .post(`/admin/products/${id}/approve`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ version: prodAfterSubmit.version })
        .expect(200);

      const before = await prisma.product.findUniqueOrThrow({ where: { id } });
      const expectedVersion = before.version + 1;

      // Create new variant for Blue on APPROVED product
      await request(app.getHttpServer())
        .post(`/seller/products/${id}/variants`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ price: '120000', stock: 15, optionValueIds: [valBlueId] })
        .expect(201);

      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(after.version).toBe(expectedVersion);
      expect(after.moderationStatus).toBe('NOT_SUBMITTED');

      const outbox = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: expectedVersion,
          },
        },
      });
      expect(outbox).not.toBeNull();
      expect(outbox!.operation).toBe('DELETE');
      expect(outbox!.status).toBe('PENDING');
    });

    // 4. Sửa Shipping profile trên Product APPROVED (PATCH /seller/products/:id/shipping-profile) tạo outbox DELETE với version = V + 1
    it('creates a DELETE outbox event at V+1 when updating shipping profile on an APPROVED product', async () => {
      const id = await createAndApproveProduct(`${marker}-mut-ship`);
      const before = await prisma.product.findUniqueOrThrow({ where: { id } });
      const expectedVersion = before.version + 1;

      await request(app.getHttpServer())
        .patch(`/seller/products/${id}/shipping-profile`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ packageWeightGrams: 450 })
        .expect(200);

      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(after.version).toBe(expectedVersion);
      expect(after.moderationStatus).toBe('NOT_SUBMITTED');

      const outbox = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: expectedVersion,
          },
        },
      });
      expect(outbox).not.toBeNull();
      expect(outbox!.operation).toBe('DELETE');
      expect(outbox!.status).toBe('PENDING');
    });

    // 5. Upload ảnh mới trên Product APPROVED (POST /seller/products/:id/images) tạo outbox DELETE với version = V + 1
    it('creates a DELETE outbox event at V+1 when uploading a new image on an APPROVED product', async () => {
      const id = await createAndApproveProduct(`${marker}-mut-img`);
      const before = await prisma.product.findUniqueOrThrow({ where: { id } });
      const expectedVersion = before.version + 1;

      await request(app.getHttpServer())
        .post(`/seller/products/${id}/images`)
        .auth(tokens.seller, { type: 'bearer' })
        .attach('file', PNG_DISTINCT, 'second-image.png')
        .expect(201);

      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(after.version).toBe(expectedVersion);
      expect(after.moderationStatus).toBe('NOT_SUBMITTED');

      const outbox = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: expectedVersion,
          },
        },
      });
      expect(outbox).not.toBeNull();
      expect(outbox!.operation).toBe('DELETE');
      expect(outbox!.status).toBe('PENDING');
    });

    // 6. Ép writeDeleteEvent lỗi (mockRejectedValueOnce) thì mutation database (PATCH) rollback hoàn toàn, version và status không đổi
    it('rolls back database mutation completely when writeDeleteEvent throws an error', async () => {
      const id = await createAndApproveProduct(`${marker}-mut-rollback`);
      const before = await prisma.product.findUniqueOrThrow({ where: { id } });

      const outboxService = app.get(SearchOutboxService);
      const writeDeleteSpy = vi
        .spyOn(outboxService, 'writeDeleteEvent')
        .mockRejectedValueOnce(new Error('Simulated outbox write failure'));

      try {
        await request(app.getHttpServer())
          .patch(`/seller/products/${id}`)
          .auth(tokens.seller, { type: 'bearer' })
          .send({ name: `${marker}-mut-rollback-attempt` })
          .expect(500);

        const after = await prisma.product.findUniqueOrThrow({ where: { id } });
        expect(after.version).toBe(before.version);
        expect(after.moderationStatus).toBe('APPROVED');
        expect(after.sellerStatus).toBe('ACTIVE');
        expect(after.name).toBe(before.name);

        const outbox = await prisma.searchOutbox.findFirst({
          where: { productId: id, version: before.version + 1 },
        });
        expect(outbox).toBeNull();
      } finally {
        writeDeleteSpy.mockRestore();
      }
    });

    // Promise.all alone cannot guarantee both requests observed the same version.
    // Gate AFTER the real ownership/snapshot read, BEFORE either actual DB write.
    it.each(['DRAFT', 'APPROVED'] as const)(
      'same-version concurrent %s edits commit once, with one 409 and consistent outbox',
      async (state) => {
        const id =
          state === 'APPROVED'
            ? await createAndApproveProduct(`${marker}-concurrent-approved`)
            : ((
                await request(app.getHttpServer())
                  .post('/seller/products')
                  .auth(tokens.seller, { type: 'bearer' })
                  .send({ name: `${marker}-concurrent-draft`, categoryId })
                  .expect(201)
              ).body.id as number);
        const initial = await prisma.product.findUniqueOrThrow({
          where: { id },
        });
        const eventsBefore = await prisma.searchOutbox.count({
          where: { productId: id },
        });
        const reader = app.get(ProductService) as unknown as {
          getOwnedEditableProduct(
            sellerId: number,
            productId: number,
          ): Promise<Product>;
        };
        const originalRead = reader.getOwnedEditableProduct.bind(reader);
        const observedVersions: number[] = [];
        let release!: () => void;
        let expired = false;
        const bothSnapshotsRead = new Promise<void>((resolve) => {
          release = resolve;
        });
        // Deadline only: never use elapsed time to choose a winner.
        const deadline = setTimeout(() => {
          expired = true;
          release();
        }, 4000);
        const spy = vi
          .spyOn(reader, 'getOwnedEditableProduct')
          .mockImplementation(async (owner, productId) => {
            const snapshot = await originalRead(owner, productId);
            if (productId !== id) return snapshot;
            observedVersions.push(snapshot.version);
            if (observedVersions.length === 2) release();
            await bothSnapshotsRead;
            if (expired)
              throw new Error(
                'Both real Product snapshots did not reach the test barrier',
              );
            return snapshot;
          });
        const names = [`${marker}-concurrent-a`, `${marker}-concurrent-b`];
        let requests: Promise<request.Response>[] = [];
        try {
          requests = names.map((name) =>
            request(app.getHttpServer())
              .patch(`/seller/products/${id}`)
              .auth(tokens.seller, { type: 'bearer' })
              .send({ name })
              .timeout({ response: 6000, deadline: 7000 })
              .then((response) => response),
          );
          const responses = await Promise.all(requests);
          expect(observedVersions).toEqual([initial.version, initial.version]);
          expect(responses.map(({ status }) => status).sort()).toEqual([
            200, 409,
          ]);
          const winner = responses.findIndex(({ status }) => status === 200);
          const after = await prisma.product.findUniqueOrThrow({
            where: { id },
          });
          expect(after.version).toBe(initial.version + 1);
          expect(after.name).toBe(names[winner]);
          const events = await prisma.searchOutbox.findMany({
            where: { productId: id, version: after.version },
          });
          if (state === 'APPROVED') {
            expect(after).toMatchObject({
              sellerStatus: 'DRAFT',
              moderationStatus: 'NOT_SUBMITTED',
            });
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
              operation: 'DELETE',
              version: after.version,
              productId: id,
            });
          } else {
            expect(events).toHaveLength(0);
          }
          expect(
            await prisma.searchOutbox.count({ where: { productId: id } }),
          ).toBe(eventsBefore + (state === 'APPROVED' ? 1 : 0));
        } finally {
          clearTimeout(deadline);
          release();
          await Promise.allSettled(requests);
          spy.mockRestore();
        }
      },
    );

    it('sequential Product edits can both succeed and increase version twice', async () => {
      const created = await request(app.getHttpServer())
        .post('/seller/products')
        .auth(tokens.seller, { type: 'bearer' })
        .send({ name: `${marker}-sequential`, categoryId })
        .expect(201);
      const id = created.body.id as number;
      const initial = await prisma.product.findUniqueOrThrow({ where: { id } });
      const eventsBefore = await prisma.searchOutbox.count({
        where: { productId: id },
      });
      for (const suffix of ['a', 'b']) {
        await request(app.getHttpServer())
          .patch(`/seller/products/${id}`)
          .auth(tokens.seller, { type: 'bearer' })
          .send({ name: `${marker}-sequential-${suffix}` })
          .expect(200);
      }
      expect(
        await prisma.product.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({
        version: initial.version + 2,
        name: `${marker}-sequential-b`,
      });
      expect(
        await prisma.searchOutbox.count({ where: { productId: id } }),
      ).toBe(eventsBefore);
    });

    // 8. Gọi writeDeleteEvent(tx, productId, version) hai lần trên cùng version không bị ghi đè, không reset attemptCount/status
    it('ensures writeDeleteEvent is idempotent and preserves delivery state on duplicate calls', async () => {
      const testProd = await prisma.product.create({
        data: {
          name: `${marker}-idempotent`,
          categoryId,
          storeId,
          version: 1,
        },
      });
      const testVersion = 88888;
      const outboxService = app.get(SearchOutboxService);

      // First call: creates PENDING outbox row
      await prisma.$transaction(async (tx) => {
        await outboxService.writeDeleteEvent(tx, testProd.id, testVersion);
      });

      // Simulate delivery attempt failed: update to FAILED, attemptCount = 3
      await prisma.searchOutbox.update({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: testProd.id,
            version: testVersion,
          },
        },
        data: {
          status: 'FAILED',
          attemptCount: 3,
          lastError: 'Search Service timeout',
        },
      });

      // Second call: duplicate event must NOT reset status or attemptCount
      await prisma.$transaction(async (tx) => {
        await outboxService.writeDeleteEvent(tx, testProd.id, testVersion);
      });

      const outbox = await prisma.searchOutbox.findUniqueOrThrow({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: testProd.id,
            version: testVersion,
          },
        },
      });

      expect(outbox.status).toBe('FAILED');
      expect(outbox.attemptCount).toBe(3);
      expect(outbox.lastError).toBe('Search Service timeout');

      // Cleanup
      await prisma.product.delete({ where: { id: testProd.id } });
    });

    // 9. APPROVED Product upload ảnh, ép publish thất bại: V -> V+1 (DELETE) -> V+2 (UPSERT)
    it('compensates failed image publish on APPROVED product: V -> V+1 (DELETE) -> V+2 (UPSERT) without decrementing version or colliding on V+3 mutation', async () => {
      const id = await createAndApproveProduct(`${marker}-comp-flow`);
      const initial = await prisma.product.findUniqueOrThrow({
        where: { id },
        include: { images: true },
      });
      const initialVersion = initial.version; // V
      const initialPrimaryImageUrl = initial.images.find(
        (i) => i.isPrimary,
      )!.url;

      const imageStorage = app.get(ProductImageStorageService);
      const publishSpy = vi
        .spyOn(imageStorage, 'publish')
        .mockRejectedValueOnce(new Error('Simulated image publish failure'));

      // Upload second distinct image which will fail publish
      await request(app.getHttpServer())
        .post(`/seller/products/${id}/images`)
        .auth(tokens.seller, { type: 'bearer' })
        .attach('file', PNG_DISTINCT, 'fail-publish.png')
        .expect(500);

      publishSpy.mockRestore();

      // Verify product state
      const productAfter = await prisma.product.findUniqueOrThrow({
        where: { id },
        include: { images: true },
      });

      // 1. Version must be V+2 (not V, not V+1)
      expect(productAfter.version).toBe(initialVersion + 2);

      // 2. Status restored to APPROVED & ACTIVE
      expect(productAfter.moderationStatus).toBe('APPROVED');
      expect(productAfter.sellerStatus).toBe('ACTIVE');

      // 3. Product has no image with PNG_DISTINCT hash
      const distinctHash = createHash('sha256')
        .update(PNG_DISTINCT)
        .digest('hex');
      const badUrlMatch = productAfter.images.find((img) =>
        img.url.includes(distinctHash),
      );
      expect(badUrlMatch).toBeUndefined();
      expect(productAfter.images.length).toBe(1);
      expect(productAfter.images[0].url).toBe(initialPrimaryImageUrl);

      // 4. File is not served / staging discarded
      const destinationPath = path.join(
        tempRoot,
        'products',
        String(id),
        `${distinctHash}.png`,
      );
      await expect(access(destinationPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });

      // 5. Outbox events:
      // - Event at V+1: DELETE
      const outboxV1 = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: initialVersion + 1,
          },
        },
      });
      expect(outboxV1).not.toBeNull();
      expect(outboxV1!.operation).toBe('DELETE');

      // - Event at V+2: UPSERT (because restored product is APPROVED + ACTIVE and public)
      const outboxV2 = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: initialVersion + 2,
          },
        },
      });
      expect(outboxV2).not.toBeNull();
      expect(outboxV2!.operation).toBe('UPSERT');
      const payloadV2 = outboxV2!.payload as { imageUrls: string[] };
      expect(payloadV2.imageUrls).toBeDefined();
      expect(
        payloadV2.imageUrls.some((url) => url.includes(distinctHash)),
      ).toBe(false);
      expect(
        payloadV2.imageUrls.some((url) => url === initialPrimaryImageUrl),
      ).toBe(true);

      // 6. Next mutation uses V+3 and does NOT collide with V+1
      await request(app.getHttpServer())
        .patch(`/seller/products/${id}`)
        .auth(tokens.seller, { type: 'bearer' })
        .send({ name: `${marker}-comp-flow-renamed` })
        .expect(200);

      const productFinal = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(productFinal.version).toBe(initialVersion + 3);

      const outboxV3 = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: initialVersion + 3,
          },
        },
      });
      expect(outboxV3).not.toBeNull();
      expect(outboxV3!.operation).toBe('DELETE');
    });

    // 10. Trường hợp có subsequent mutation: không ghi đè trạng thái mới, tăng version
    it('preserves subsequent mutation state if product version changed before compensation runs', async () => {
      const id = await createAndApproveProduct(`${marker}-comp-subseq`);
      const initial = await prisma.product.findUniqueOrThrow({ where: { id } });

      const imageStorage = app.get(ProductImageStorageService);
      // Hook into publish to execute an interleaved mutation before publish rejects
      const publishSpy = vi
        .spyOn(imageStorage, 'publish')
        .mockImplementationOnce(async () => {
          // Mutate the product directly while upload is in-flight (simulating subsequent mutation)
          await prisma.product.update({
            where: { id },
            data: {
              name: `${marker}-interleaved-mutation`,
              description: 'Interleaved description',
              version: { increment: 1 }, // advances to V+2
            },
          });
          throw new Error('Forced publish failure after interleaved mutation');
        });

      await request(app.getHttpServer())
        .post(`/seller/products/${id}/images`)
        .auth(tokens.seller, { type: 'bearer' })
        .attach('file', PNG_DISTINCT, 'subseq-fail.png')
        .expect(500);

      publishSpy.mockRestore();

      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      // Interleaved mutation set name, compensation must NOT overwrite it with snapshot
      expect(after.name).toBe(`${marker}-interleaved-mutation`);
      expect(after.description).toBe('Interleaved description');
      // Version was initial (V) -> upload (+1 = V+1) -> interleaved (+1 = V+2) -> compensation (+1 = V+3)
      expect(after.version).toBe(initial.version + 3);

      // Compensation outbox event was written at V+3
      const outboxV3 = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: initial.version + 3,
          },
        },
      });
      expect(outboxV3).not.toBeNull();
    });

    // 11. Lỗi outbox tạm thời: retry cùng compensation, không nhảy quá V+2.
    it('retries compensation after a transient outbox error without consuming another version', async () => {
      const id = await createAndApproveProduct(`${marker}-comp-fail-outbox`);
      const initial = await prisma.product.findUniqueOrThrow({
        where: { id },
        include: { images: true },
      });

      const imageStorage = app.get(ProductImageStorageService);
      const outboxService = app.get(SearchOutboxService);

      const publishSpy = vi
        .spyOn(imageStorage, 'publish')
        .mockRejectedValueOnce(new Error('Publish failed'));

      // Force writeOutboxEvent to fail inside compensateFailedImagePublish
      const outboxSpy = vi
        .spyOn(outboxService, 'writeOutboxEvent')
        .mockRejectedValueOnce(
          new Error('Outbox write failure inside compensation'),
        );

      await request(app.getHttpServer())
        .post(`/seller/products/${id}/images`)
        .auth(tokens.seller, { type: 'bearer' })
        .attach('file', PNG_DISTINCT, 'fail-both.png')
        .expect(500);

      expect(outboxSpy).toHaveBeenCalledTimes(2);
      publishSpy.mockRestore();
      outboxSpy.mockRestore();

      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(after.version).toBe(initial.version + 2);
      expect(after.moderationStatus).toBe('APPROVED');
      expect(
        await prisma.productImage.count({
          where: {
            productId: id,
            url: { notIn: initial.images.map(({ url }) => url) },
          },
        }),
      ).toBe(0);
      const outboxV2 = await prisma.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: id,
            version: initial.version + 2,
          },
        },
      });
      expect(outboxV2?.operation).toBe('UPSERT');
    });

    // 12. Lỗi compensation liên tục phải dừng; Product private và không submit được
    // khi database còn tham chiếu tới file ảnh chưa từng publish.
    it('bounds compensation retries and blocks submit while an image file is missing', async () => {
      const id = await createAndApproveProduct(`${marker}-comp-exhausted`);
      const initial = await prisma.product.findUniqueOrThrow({ where: { id } });
      const imageStorage = app.get(ProductImageStorageService);
      const outboxService = app.get(SearchOutboxService);
      const publishSpy = vi
        .spyOn(imageStorage, 'publish')
        .mockRejectedValueOnce(new Error('Publish failed'));
      const outboxSpy = vi
        .spyOn(outboxService, 'writeOutboxEvent')
        .mockRejectedValue(new Error('Persistent outbox failure'));

      try {
        await request(app.getHttpServer())
          .post(`/seller/products/${id}/images`)
          .auth(tokens.seller, { type: 'bearer' })
          .attach('file', PNG_DISTINCT, 'persistent-failure.png')
          .expect(500);
        expect(outboxSpy).toHaveBeenCalledTimes(3);
      } finally {
        publishSpy.mockRestore();
        outboxSpy.mockRestore();
      }

      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(after.version).toBe(initial.version + 1);
      expect(after.moderationStatus).toBe('NOT_SUBMITTED');
      expect(after.sellerStatus).toBe('DRAFT');
      expect(
        await prisma.searchOutbox.findFirst({
          where: { productId: id, version: initial.version + 2 },
        }),
      ).toBeNull();

      await request(app.getHttpServer())
        .post(`/seller/products/${id}/submit`)
        .auth(tokens.seller, { type: 'bearer' })
        .expect(400)
        .expect(({ body }) => {
          expect(String(body.message)).toContain('file ảnh đã tải lên hợp lệ');
        });
    });
  });

  // ===========================================================================
  // Search Reconciliation & Candidate Filtering
  // ===========================================================================
  describe('Search Reconciliation & Candidate Filtering', () => {
    it('skips unindexed draft products and emits no DELETE events', async () => {
      const reconService = app.get(SearchReconciliationService);

      // Create a draft product that is never approved
      const draftRes = await request(app.getHttpServer())
        .post('/seller/products')
        .auth(tokens.seller, { type: 'bearer' })
        .send({ name: `${marker}-draft-never-public`, categoryId })
        .expect(201);
      const draftId = draftRes.body.id as number;

      // Ensure no outbox events exist
      const beforeEvents = await prisma.searchOutbox.findMany({
        where: { productId: draftId },
      });
      expect(beforeEvents).toHaveLength(0);

      const beforeDraft = await prisma.product.findUniqueOrThrow({
        where: { id: draftId },
      });

      // Run reconciliation
      const result = await reconService.reconcileAll();
      expect(result.failed).toBe(0);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(result.scanned).toBeGreaterThan(0);
      expect(result.created + result.skipped + result.failed).toBe(
        result.scanned,
      );

      // Verify no DELETE or UPSERT outbox event was generated for this draft
      const afterEvents = await prisma.searchOutbox.findMany({
        where: { productId: draftId },
      });
      expect(afterEvents).toHaveLength(0);
      const afterDraft = await prisma.product.findUniqueOrThrow({
        where: { id: draftId },
      });
      expect(afterDraft).toEqual(beforeDraft);
    });

    it('reconciles out-of-sync approved product and is idempotent on subsequent runs', async () => {
      const reconService = app.get(SearchReconciliationService);
      const id = await createAndApproveProduct(`${marker}-recon-sync`);

      const prodBefore = await prisma.product.findUniqueOrThrow({
        where: { id },
      });

      // Delete the outbox record to simulate out-of-sync state
      await prisma.searchOutbox.deleteMany({
        where: { productId: id },
      });

      // Run reconciliation: should detect missing outbox UPSERT and heal it
      const run1 = await reconService.reconcileAll();
      expect(run1.created).toBeGreaterThanOrEqual(1);

      const prodAfter = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(prodAfter.version).toBeGreaterThan(prodBefore.version);

      const healedOutbox = await prisma.searchOutbox.findFirst({
        where: { productId: id, version: prodAfter.version },
      });
      expect(healedOutbox?.operation).toBe('UPSERT');

      // Run reconciliation again: should be completely idempotent (0 created for this product)
      const outboxCountBefore = await prisma.searchOutbox.count({
        where: { productId: id },
      });
      await reconService.reconcileAll();
      const outboxCountAfter = await prisma.searchOutbox.count({
        where: { productId: id },
      });
      expect(outboxCountAfter).toBe(outboxCountBefore);
    });

    it('queues concurrent reconciliation passes instead of dropping work', async () => {
      const reconService = app.get(SearchReconciliationService);
      const [first, second] = await Promise.all([
        reconService.reconcileAll({ batchSize: 10 }),
        reconService.reconcileAll({ batchSize: 10 }),
      ]);
      expect(first.scanned).toBeGreaterThan(0);
      expect(second.scanned).toBeGreaterThan(0);
      expect(first.failed + second.failed).toBe(0);
    });
  });

  // ===========================================================================
  // Store & Category Invalidation Cascade
  // ===========================================================================
  describe('Store & Category Invalidation Cascade', () => {
    it('suspending a store cascades DELETE despite a full older batch, and reactivating restores UPSERT', async () => {
      const id = await createAndApproveProduct(`${marker}-store-cascade`);
      const initialProd = await prisma.product.findUniqueOrThrow({
        where: { id },
      });

      // All belong to this fixture. Older no-op CATEGORY jobs deterministically
      // occupy the first batch without touching another suite's parent state.
      const emptyCategory = await prisma.category.create({
        data: { name: `${marker}-backlog`, slug: `${marker}-backlog` },
      });
      backlogCategoryIds.push(emptyCategory.id);
      for (let index = 0; index < 21; index++) {
        const job = await prisma.searchReconciliationJob.create({
          data: {
            scope: 'CATEGORY',
            scopeId: emptyCategory.id,
            createdAt: new Date('1970-01-01T00:00:00.000Z'),
            nextAttemptAt: null,
          },
        });
        backlogJobIds.push(job.id);
      }
      const suspended = await request(app.getHttpServer())
        .patch(`/admin/stores/${storeId}/status`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ status: 'SUSPENDED', reason: 'Tạm khóa để kiểm tra vi phạm' })
        .expect(200)
        .expect(({ body }) =>
          expect(body.searchReconciliation).toMatchObject({
            status: 'PENDING',
          }),
        );
      await app.get(SearchReconciliationWorker).runBatch();
      expect(
        await prisma.searchReconciliationJob.findUniqueOrThrow({
          where: { id: reconciliationJobId(suspended) },
        }),
      ).toMatchObject({ status: 'PENDING', attemptCount: 0 });
      expect(
        await prisma.searchReconciliationJob.count({
          where: { id: { in: backlogJobIds }, status: 'SUCCEEDED' },
        }),
      ).toBe(20);
      await settleReconciliation([reconciliationJobId(suspended)]);

      // Product version must advance and DELETE event must exist
      const suspendedProd = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(suspendedProd.version).toBeGreaterThan(initialProd.version);

      const deleteOutbox = await prisma.searchOutbox.findFirst({
        where: { productId: id, version: suspendedProd.version },
      });
      expect(deleteOutbox?.operation).toBe('DELETE');

      // Admin reactivates the store
      const reactivated = await request(app.getHttpServer())
        .patch(`/admin/stores/${storeId}/status`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ status: 'ACTIVE', reason: 'Cửa hàng đã giải trình xong' })
        .expect(200);
      await settleReconciliation([reconciliationJobId(reactivated)]);

      // Product version must advance again and UPSERT event must exist
      const reactivatedProd = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(reactivatedProd.version).toBeGreaterThan(suspendedProd.version);

      const upsertOutbox = await prisma.searchOutbox.findFirst({
        where: { productId: id, version: reactivatedProd.version },
      });
      expect(upsertOutbox?.operation).toBe('UPSERT');
    });

    it('updating category name cascades UPSERT outbox events with updated name to products', async () => {
      const id = await createAndApproveProduct(`${marker}-cat-cascade`);
      const initialProd = await prisma.product.findUniqueOrThrow({
        where: { id },
      });

      const newCategoryName = `Cat-Renamed-${Date.now()}`;
      const renamed = await request(app.getHttpServer())
        .patch(`/admin/categories/${categoryId}`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ name: newCategoryName })
        .expect(200)
        .expect(({ body }) =>
          expect(body.searchReconciliation).toMatchObject({
            status: 'PENDING',
          }),
        );
      await settleReconciliation([reconciliationJobId(renamed)]);

      const updatedProd = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(updatedProd.version).toBeGreaterThan(initialProd.version);

      const latestOutbox = await prisma.searchOutbox.findFirst({
        where: { productId: id, version: updatedProd.version },
      });
      expect(latestOutbox?.operation).toBe('UPSERT');
      const payload = latestOutbox?.payload as Record<string, unknown>;
      expect(payload?.categoryName).toBe(newCategoryName);
    });

    it('reconciles Brand, Seller eligibility and required-attribute changes through durable jobs', async () => {
      const id = await createAndApproveProduct(`${marker}-parent-dependencies`);
      const brand = await prisma.brand.create({
        data: { name: `${marker}-brand`, slug: `${marker}-brand` },
      });
      await prisma.product.update({
        where: { id },
        data: { brandId: brand.id },
      });
      await app.get(SearchReconciliationService).reconcileProduct(id);

      const renamedBrand = `${marker}-brand-renamed`;
      const renamed = await request(app.getHttpServer())
        .patch(`/admin/brands/${brand.id}`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ name: renamedBrand })
        .expect(200)
        .expect(({ body }) =>
          expect(body.searchReconciliation.status).toBe('PENDING'),
        );
      await settleReconciliation([reconciliationJobId(renamed)]);
      expect(
        (
          await prisma.searchOutbox.findFirstOrThrow({
            where: { productId: id, operation: 'UPSERT' },
            orderBy: { version: 'desc' },
          })
        ).payload,
      ).toMatchObject({ brandName: renamedBrand });

      const disabled = await request(app.getHttpServer())
        .patch(`/admin/accounts/${sellerId}/status`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ isActive: false })
        .expect(200);
      await settleReconciliation([reconciliationJobId(disabled)]);
      expect(
        await prisma.searchOutbox.findFirst({
          where: { productId: id, operation: 'DELETE' },
          orderBy: { version: 'desc' },
        }),
      ).not.toBeNull();

      const enabled = await request(app.getHttpServer())
        .patch(`/admin/accounts/${sellerId}/status`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ isActive: true })
        .expect(200);
      await settleReconciliation([reconciliationJobId(enabled)]);

      const attribute = await request(app.getHttpServer())
        .post(`/admin/categories/${categoryId}/attributes`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({
          name: 'Runtime required field',
          slug: `${marker}-runtime-required`,
          dataType: 'TEXT',
          isRequired: true,
          confirmPolicyChange: true,
          reason: 'QA explicitly require this attribute',
        })
        .expect(201);
      expect(attribute.body.searchReconciliation.status).toBe('PENDING');
      await settleReconciliation([reconciliationJobId(attribute)]);
      const afterRequired = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(
        await prisma.searchOutbox.findUnique({
          where: {
            target_productId_version: {
              target: 'SEARCH_SERVICE',
              productId: id,
              version: afterRequired.version,
            },
          },
        }),
      ).toMatchObject({ operation: 'DELETE' });

      const optional = await request(app.getHttpServer())
        .patch(
          `/admin/categories/${categoryId}/attributes/${attribute.body.definition.id}`,
        )
        .auth(tokens.admin, { type: 'bearer' })
        .send({
          expectedRevision: attribute.body.definition.revision,
          isRequired: false,
          confirmPolicyChange: true,
          reason: 'QA explicitly relax this requirement',
        })
        .expect(200);
      await settleReconciliation([reconciliationJobId(optional)]);
      await prisma.categoryAttributeDefinition.delete({
        where: { id: attribute.body.definition.id as number },
      });
      await prisma.product.update({ where: { id }, data: { brandId: null } });
      await prisma.brand.delete({ where: { id: brand.id } });
    });

    it('keeps partial failure durable, resumes after restart and uses latest canonical state', async () => {
      const id = await createAndApproveProduct(`${marker}-durable-retry`);
      const service = app.get(SearchReconciliationService);
      const firstName = `${marker}-stale-category-name`;
      const firstChange = await request(app.getHttpServer())
        .patch(`/admin/categories/${categoryId}`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ name: firstName })
        .expect(200);

      const original = service.reconcileProduct.bind(service);
      const failure = vi
        .spyOn(service, 'reconcileProduct')
        .mockImplementation((productId) =>
          productId === id
            ? Promise.reject(new Error('simulated mid-batch crash'))
            : original(productId),
        );
      await settleReconciliation(
        [reconciliationJobId(firstChange)],
        undefined,
        'FAILED',
      );
      failure.mockRestore();

      const failedJob = await prisma.searchReconciliationJob.findFirstOrThrow({
        where: { scope: 'CATEGORY', scopeId: categoryId, status: 'FAILED' },
        orderBy: { id: 'desc' },
      });
      expect(failedJob.lastError).toContain('simulated mid-batch crash');

      const latestName = `${marker}-latest-category-name`;
      const latestChange = await request(app.getHttpServer())
        .patch(`/admin/categories/${categoryId}`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ name: latestName })
        .expect(200);
      await prisma.searchReconciliationJob.update({
        where: { id: failedJob.id },
        data: { nextAttemptAt: new Date() },
      });

      const restartedWorker = new SearchReconciliationWorker(
        prisma,
        service,
        app.get(ConfigService),
      );
      const concurrentWorker = new SearchReconciliationWorker(
        prisma,
        service,
        app.get(ConfigService),
      );
      await settleReconciliation(
        [failedJob.id, reconciliationJobId(latestChange)],
        async () => {
          await Promise.all([
            restartedWorker.runBatch(),
            concurrentWorker.runBatch(),
          ]);
        },
      );

      expect(
        await prisma.searchReconciliationJob.findUnique({
          where: { id: failedJob.id },
        }),
      ).toMatchObject({ status: 'SUCCEEDED' });
      const product = await prisma.product.findUniqueOrThrow({ where: { id } });
      const latest = await prisma.searchOutbox.findFirstOrThrow({
        where: { productId: id },
        orderBy: { version: 'desc' },
      });
      expect(latest.version).toBeLessThanOrEqual(product.version);
      expect(latest.payload).toMatchObject({ categoryName: latestName });
      expect(
        await prisma.searchOutbox.count({
          where: { productId: id, version: latest.version },
        }),
      ).toBe(1);
    });
  });

  // ===========================================================================
  // Product Image Repair Service
  // ===========================================================================
  describe('Product Image Repair Service', () => {
    it('removes an orphaned image, promotes primary and invalidates approval', async () => {
      const repairWorker = app.get(ProductImageRepairWorker);
      const id = await createAndApproveProduct(`${marker}-repair-primary`);

      // Add a second image
      await request(app.getHttpServer())
        .post(`/seller/products/${id}/images`)
        .auth(tokens.seller, { type: 'bearer' })
        .attach('file', PNG_DISTINCT, 'second.png')
        .expect(201);

      // Resubmit and re-approve so the product is APPROVED with both images
      await request(app.getHttpServer())
        .post(`/seller/products/${id}/submit`)
        .auth(tokens.seller, { type: 'bearer' })
        .expect(200);

      const prodBeforeApprove = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      await request(app.getHttpServer())
        .post(`/admin/products/${id}/approve`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ version: prodBeforeApprove.version })
        .expect(200);

      const imagesBefore = await prisma.productImage.findMany({
        where: { productId: id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      expect(imagesBefore).toHaveLength(2);
      const primaryImage = imagesBefore.find((img) => img.isPrimary)!;
      const secondImage = imagesBefore.find((img) => !img.isPrimary)!;
      const productVersionBeforeRepair = (
        await prisma.product.findUniqueOrThrow({ where: { id } })
      ).version;

      // Delete the physical file of the primary image from disk storage
      const storageService = app.get(ProductImageStorageService);
      const managedPath = (
        storageService as unknown as { resolveManagedPath(url: string): string }
      ).resolveManagedPath(primaryImage.url);
      await rm(managedPath, { force: true });

      // Exercise the production runtime entry point used by the scheduler.
      const run = await repairWorker.runBatch();
      expect(run.status).toBe('COMPLETED');
      if (run.status !== 'COMPLETED')
        throw new Error('repair pass did not run');
      expect(run.summary.repairedProducts).toBeGreaterThanOrEqual(1);

      // Verify remaining image is promoted to primary
      const imagesAfter = await prisma.productImage.findMany({
        where: { productId: id },
      });
      expect(imagesAfter).toHaveLength(1);
      expect(imagesAfter[0].id).toBe(secondImage.id);
      expect(imagesAfter[0].isPrimary).toBe(true);

      // Verify product version advanced monotonically
      const prodAfter = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(prodAfter.version).toBe(productVersionBeforeRepair + 1);
      expect(prodAfter.sellerStatus).toBe('DRAFT');
      expect(prodAfter.moderationStatus).toBe('NOT_SUBMITTED');

      // An automated image mutation follows the same re-review invariant.
      const outbox = await prisma.searchOutbox.findFirst({
        where: { productId: id, version: prodAfter.version },
      });
      expect(outbox?.operation).toBe('DELETE');

      const outboxCountBeforeSecondRun = await prisma.searchOutbox.count({
        where: { productId: id },
      });
      const secondRun = await repairWorker.runBatch();
      expect(secondRun.status).toBe('COMPLETED');
      const unchanged = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(unchanged.version).toBe(prodAfter.version);
      expect(
        await prisma.searchOutbox.count({ where: { productId: id } }),
      ).toBe(outboxCountBeforeSecondRun);
    });

    it('if all images are missing physical files, removes them and writes DELETE outbox event', async () => {
      const repairService = app.get(ProductImageRepairService);
      const id = await createAndApproveProduct(`${marker}-repair-all-missing`);

      const images = await prisma.productImage.findMany({
        where: { productId: id },
      });
      expect(images).toHaveLength(1);

      // Delete the physical file from disk storage
      const storageService = app.get(ProductImageStorageService);
      const managedPath = (
        storageService as unknown as { resolveManagedPath(url: string): string }
      ).resolveManagedPath(images[0].url);
      await rm(managedPath, { force: true });

      // Run repair on this product
      const result = await repairService.repairProduct(id);
      expect(result.removedImages).toBe(1);
      expect(result.promotedPrimary).toBe(false);
      expect(result.outboxEvent).toBe('DELETE');

      // Verify 0 images in DB
      const imagesAfter = await prisma.productImage.findMany({
        where: { productId: id },
      });
      expect(imagesAfter).toHaveLength(0);

      // Verify product version advanced monotonically and DELETE outbox event exists
      const prodAfter = await prisma.product.findUniqueOrThrow({
        where: { id },
      });
      expect(prodAfter.version).toBe(result.newVersion);

      const outbox = await prisma.searchOutbox.findFirst({
        where: { productId: id, version: prodAfter.version },
      });
      expect(outbox?.operation).toBe('DELETE');
    });

    it('keeps image URLs outside managed upload storage', async () => {
      const repairService = app.get(ProductImageRepairService);
      const id = await createAndApproveProduct(`${marker}-repair-unmanaged`);
      const before = await prisma.product.findUniqueOrThrow({ where: { id } });
      const external = await prisma.productImage.create({
        data: {
          productId: id,
          url: `https://cdn.example.test/${marker}.jpg`,
          sortOrder: 99,
          isPrimary: false,
        },
      });

      const result = await repairService.repairProduct(id);
      expect(result.removedImages).toBe(0);
      expect(
        await prisma.productImage.findUnique({ where: { id: external.id } }),
      ).not.toBeNull();
      const after = await prisma.product.findUniqueOrThrow({ where: { id } });
      expect(after.version).toBe(before.version);
    });

    it('runtime pass isolates one product failure and repairs another product', async () => {
      const repairWorker = app.get(ProductImageRepairWorker);
      const repairService = app.get(ProductImageRepairService);
      const failingId = await createAndApproveProduct(
        `${marker}-repair-runtime-failure`,
      );
      const healthyId = await createAndApproveProduct(
        `${marker}-repair-runtime-healthy`,
      );

      for (const productId of [failingId, healthyId]) {
        const image = await prisma.productImage.findFirstOrThrow({
          where: { productId },
        });
        const storageService = app.get(ProductImageStorageService);
        const managedPath = (
          storageService as unknown as {
            resolveManagedPath(url: string): string;
          }
        ).resolveManagedPath(image.url);
        await rm(managedPath, { force: true });
      }

      const originalRepair = repairService.repairProduct.bind(repairService);
      const repairSpy = vi
        .spyOn(repairService, 'repairProduct')
        .mockImplementation((productId) => {
          if (productId === failingId) {
            return Promise.reject(new Error('simulated product repair error'));
          }
          return originalRepair(productId);
        });

      try {
        const run = await repairWorker.runBatch();
        expect(run.status).toBe('COMPLETED');
        if (run.status !== 'COMPLETED')
          throw new Error('repair pass did not run');
        expect(run.summary.failedProducts).toBeGreaterThanOrEqual(1);
        expect(repairSpy).toHaveBeenCalledWith(failingId);
        expect(repairSpy).toHaveBeenCalledWith(healthyId);
        expect(
          await prisma.productImage.count({ where: { productId: failingId } }),
        ).toBe(1);
        expect(
          await prisma.productImage.count({ where: { productId: healthyId } }),
        ).toBe(0);

        const healthyProduct = await prisma.product.findUniqueOrThrow({
          where: { id: healthyId },
        });
        expect(healthyProduct.sellerStatus).toBe('DRAFT');
        expect(healthyProduct.moderationStatus).toBe('NOT_SUBMITTED');
        expect(
          await prisma.searchOutbox.findUnique({
            where: {
              target_productId_version: {
                target: 'SEARCH_SERVICE',
                productId: healthyId,
                version: healthyProduct.version,
              },
            },
          }),
        ).toMatchObject({ operation: 'DELETE' });
      } finally {
        repairSpy.mockRestore();
      }
    });
  });
});
