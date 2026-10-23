// Composition checks for the real policy/kernel/unique-index/worker modules.
// HTTP authorization/shared writers are checked in the runtime suite separately;
// neither suite is evidence of live Elasticsearch/FAISS integration.
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { AttributeTransactionBoundary } from '../src/catalog/attribute-transaction-boundary.js';
import {
  parseAttributeWrite,
  planDefinitionCreate,
  planDefinitionPatch,
} from '../src/catalog/attribute-write-policy.js';
import { rethrowAttributeUniqueError } from '../src/catalog/attribute-unique-error.js';
import { SearchOutboxService } from '../src/search/search-outbox.service.js';
import { SearchReconciliationService } from '../src/search/search-reconciliation.service.js';
import { SearchReconciliationWorker } from '../src/search/search-reconciliation.worker.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

describe('Attribute write policy + kernel + unique indexes + reconciliation', () => {
  let db: PrismaService;
  let other: PrismaService;
  let admin: number;
  let otherAdmin: number;
  let storeId: number;
  let categoryId: number;
  let definitionId: number;
  let reconciliation: SearchReconciliationService;
  let boundary: AttributeTransactionBoundary;
  let otherBoundary: AttributeTransactionBoundary;
  let worker: SearchReconciliationWorker;
  const marker = `local-policy-kernel-${randomUUID()}`;
  const reason = 'QA explicit policy decision';

  beforeAll(async () => {
    assertAttributeReadQaTarget(process.env.DATABASE_URL);
    db = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    other = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await Promise.all([db.$connect(), other.$connect()]);
    const a = await db.user.create({
      data: {
        email: `${marker}-a@example.com`,
        role: 'ADMIN',
        passwordHash: 'not-an-auth-test',
      },
    });
    const b = await db.user.create({
      data: {
        email: `${marker}-b@example.com`,
        role: 'ADMIN',
        passwordHash: 'not-an-auth-test',
      },
    });
    const seller = await db.user.create({
      data: {
        email: `${marker}-s@example.com`,
        role: 'SELLER',
        passwordHash: 'not-an-auth-test',
      },
    });
    admin = a.id;
    otherAdmin = b.id;
    storeId = (
      await db.store.create({
        data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
      })
    ).id;
    reconciliation = new SearchReconciliationService(
      db,
      new SearchOutboxService(db),
    );
    boundary = new AttributeTransactionBoundary(db, reconciliation);
    otherBoundary = new AttributeTransactionBoundary(
      other,
      new SearchReconciliationService(other, new SearchOutboxService(other)),
    );
    worker = new SearchReconciliationWorker(
      db,
      reconciliation,
      new ConfigService({ SEARCH_RECONCILIATION_ENABLED: 'false' }),
    );
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    categoryId = (
      await db.category.create({ data: { name: marker, slug: randomUUID() } })
    ).id;
    definitionId = (
      await db.categoryAttributeDefinition.create({
        data: {
          categoryId,
          name: 'Connection',
          slug: 'connection',
          dataType: 'TEXT',
        },
      })
    ).id;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    // Immutable audit fixtures intentionally remain in the private QA database.
    await Promise.all([db?.$disconnect(), other?.$disconnect()]);
  });

  async function snapshot() {
    return {
      category: await db.category.findUniqueOrThrow({
        where: { id: categoryId },
      }),
      definitions: await db.categoryAttributeDefinition.findMany({
        where: { categoryId },
        orderBy: { id: 'asc' },
      }),
      values: await db.productAttributeValue.findMany({
        where: { attributeDefinitionId: definitionId },
        orderBy: { id: 'asc' },
      }),
      audits: await db.categoryAttributeAudit.findMany({
        where: { categoryId },
        orderBy: { id: 'asc' },
      }),
      jobs: await db.searchReconciliationJob.findMany({
        where: { scope: 'CATEGORY', scopeId: categoryId },
        orderBy: { id: 'asc' },
      }),
    };
  }
  async function create(raw: unknown, engine = boundary, actorId = admin) {
    const input = parseAttributeWrite(raw, 'definition', 'create');
    try {
      return await engine.createDefinition(
        { actorId, categoryId },
        async (ctx) => {
          const plan = planDefinitionCreate(input, ctx.categoryProductCount);
          return {
            values: plan.next,
            reason: input.reason,
            searchMayBeAffected: plan.searchMayBeAffected,
          };
        },
      );
    } catch (error) {
      rethrowAttributeUniqueError(error);
    }
  }
  async function patch(raw: unknown, engine = boundary, actorId = admin) {
    const input = parseAttributeWrite(raw, 'definition', 'patch');
    return engine.run(
      {
        actorId,
        categoryId,
        definitionId,
        expectedRevision: input.expectedRevision!,
      },
      async (ctx) => {
        const plan = planDefinitionPatch(ctx.definition, input, ctx.usage);
        if (!plan.changed) return null;
        await ctx.tx.categoryAttributeDefinition.update({
          where: { id: definitionId },
          data: plan.next,
        });
        return ctx.recordChange({
          reason: input.reason,
          searchMayBeAffected: plan.searchMayBeAffected,
        });
      },
    );
  }
  async function product(publicListing = false) {
    const item = await db.product.create({
      data: {
        storeId,
        categoryId,
        name: 'Local policy probe product',
        sellerStatus: publicListing ? 'ACTIVE' : 'DRAFT',
        moderationStatus: publicListing ? 'APPROVED' : 'NOT_SUBMITTED',
        images: {
          create: { url: 'https://qa.invalid/catalog.png', isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    await db.productVariant.create({
      data: {
        productId: item.id,
        storeId,
        skuCode: randomUUID(),
        optionSignature: '',
        price: '10000',
        stock: 5,
      },
    });
    return item.id;
  }
  async function settle(jobId: string) {
    for (let pass = 0; pass < 100; pass++) {
      await worker.runBatch();
      const job = await db.searchReconciliationJob.findUniqueOrThrow({
        where: { id: BigInt(jobId) },
      });
      if (job.status === 'SUCCEEDED') return;
      expect(['FAILED', 'DEAD']).not.toContain(job.status);
    }
    throw new Error('Local probe job did not settle within 100 batches');
  }

  it('creates through the real planner with one audit and no irrelevant Search job', async () => {
    const result = await create({
      name: '  Nhãn   hiệu ',
      slug: 'brand-label',
      dataType: 'TEXT',
    });
    expect(result.definition).toMatchObject({
      name: 'Nhãn hiệu',
      revision: 1,
      isRequired: false,
    });
    expect(result.searchReconciliation).toBeNull();
    const state = await snapshot();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      command: 'CREATE_DEFINITION',
      definitionId: result.definition.id,
    });
    expect(state.jobs).toHaveLength(0);
  });
  it('rejects a normalized collision after parsing without a second audit or job', async () => {
    await create({ name: 'Nhãn hiệu', slug: 'first-label', dataType: 'TEXT' });
    const before = await snapshot();
    await expect(
      create({ name: '  NHÃN  HIỆU ', slug: 'second-label', dataType: 'TEXT' }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'ATTRIBUTE_NAME_CONFLICT' },
    });
    expect(await snapshot()).toEqual(before);
  });
  it('allows only one concurrent normalized create across two pools', async () => {
    const results = await Promise.allSettled([
      create({ name: 'Màu sắc', slug: 'color-one', dataType: 'TEXT' }),
      create(
        { name: '  MÀU  SẮC ', slug: 'color-two', dataType: 'TEXT' },
        otherBoundary,
        otherAdmin,
      ),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = results.find((item) => item.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      status: 409,
      response: { code: 'ATTRIBUTE_NAME_CONFLICT' },
    });
    const state = await snapshot();
    expect(state.definitions).toHaveLength(2);
    expect(state.audits).toHaveLength(1);
    expect(state.jobs).toHaveLength(0);
  });
  it('uses canonical DRAFT Product values to reject a type change with zero side effects', async () => {
    const productId = await product();
    await db.productAttributeValue.create({
      data: {
        productId,
        attributeDefinitionId: definitionId,
        textValue: 'USB',
      },
    });
    const before = await snapshot();
    await expect(
      patch({ expectedRevision: 1, dataType: 'NUMBER' }),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_TYPE_IN_USE', status: 409 });
    expect(await snapshot()).toEqual(before);
  });
  it('rejects a policy change without confirmation inside the transaction', async () => {
    const before = await snapshot();
    await expect(
      patch({ expectedRevision: 1, isRequired: true, reason }),
    ).rejects.toMatchObject({
      code: 'ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED',
      status: 409,
    });
    expect(await snapshot()).toEqual(before);
  });
  it('rejects a confirmed policy change without a reason with zero mutation', async () => {
    const before = await snapshot();
    await expect(
      patch({
        expectedRevision: 1,
        isRequired: true,
        confirmPolicyChange: true,
      }),
    ).rejects.toMatchObject({
      code: 'ATTRIBUTE_POLICY_REASON_REQUIRED',
      status: 400,
    });
    expect(await snapshot()).toEqual(before);
  });
  it('writes sort order with exactly one revision/audit but no Search job', async () => {
    expect(await patch({ expectedRevision: 1, sortOrder: 7 })).toBeNull();
    const state = await snapshot();
    expect(state.definitions[0]).toMatchObject({ revision: 2, sortOrder: 7 });
    expect(state.audits).toHaveLength(1);
    expect(state.jobs).toHaveLength(0);
    await patch({ expectedRevision: 2, sortOrder: 7 });
    expect(await snapshot()).toEqual(state);
    await expect(
      patch({ expectedRevision: 1, sortOrder: 7 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(state);
  });
  it('keeps one successful decision when two Admins use the same revision', async () => {
    const results = await Promise.allSettled([
      patch({ expectedRevision: 1, sortOrder: 4 }),
      patch({ expectedRevision: 1, sortOrder: 9 }, otherBoundary, otherAdmin),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = results.find((item) => item.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      status: 409,
    });
    const state = await snapshot();
    expect(state.definitions[0].revision).toBe(2);
    expect(state.audits).toHaveLength(1);
    expect(state.jobs).toHaveLength(0);
  });
  it('rolls back definition/revision/audit when the real planner requires a job but enqueue fails', async () => {
    await product();
    const before = await snapshot();
    vi.spyOn(reconciliation, 'enqueueCategory').mockRejectedValueOnce(
      new Error('local job fault'),
    );
    await expect(
      patch({
        expectedRevision: 1,
        isRequired: true,
        confirmPolicyChange: true,
        reason,
      }),
    ).rejects.toThrow('local job fault');
    expect(await snapshot()).toEqual(before);
  });
  it('required-policy fanout emits DELETE then UPSERT without replay events or moderation changes', async () => {
    const productId = await product(true);
    await reconciliation.reconcileProduct(productId);
    const initial = await db.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(
      await db.searchOutbox.findFirst({
        where: { productId },
        orderBy: { version: 'desc' },
      }),
    ).toMatchObject({ operation: 'UPSERT' });
    const blockedJob = await patch({
      expectedRevision: 1,
      isRequired: true,
      confirmPolicyChange: true,
      reason,
    });
    expect(blockedJob?.status).toBe('PENDING');
    await settle(blockedJob!.jobId);
    const blocked = await db.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(blocked.version).toBe(initial.version + 1);
    expect(blocked).toMatchObject({
      moderationStatus: 'APPROVED',
      sellerStatus: 'ACTIVE',
    });
    expect(
      await db.searchOutbox.findFirst({
        where: { productId },
        orderBy: { version: 'desc' },
      }),
    ).toMatchObject({ operation: 'DELETE', version: blocked.version });
    const restoredJob = await patch({
      expectedRevision: 2,
      isRequired: false,
      confirmPolicyChange: true,
      reason,
    });
    await settle(restoredJob!.jobId);
    const restored = await db.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(restored.version).toBe(blocked.version + 1);
    const events = await db.searchOutbox.findMany({
      where: { productId },
      orderBy: { version: 'asc' },
    });
    expect(events.map((event) => event.operation)).toEqual([
      'UPSERT',
      'DELETE',
      'UPSERT',
    ]);
    await worker.runBatch();
    expect(
      await db.product.findUniqueOrThrow({ where: { id: productId } }),
    ).toEqual(restored);
    expect(
      await db.searchOutbox.findMany({
        where: { productId },
        orderBy: { version: 'asc' },
      }),
    ).toEqual(events);
    expect((await snapshot()).audits).toHaveLength(2);
  });
});
