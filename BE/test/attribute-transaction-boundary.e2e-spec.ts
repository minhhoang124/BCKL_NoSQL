import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  AttributeTransactionBoundary,
  fenceAttributeCategory,
} from '../src/catalog/attribute-transaction-boundary.js';
import type {
  AttributeTransactionContext,
  AttributeCreatePlan,
} from '../src/catalog/attribute-transaction-boundary.js';
import { PrismaService } from '../src/prisma.service.js';
import { SearchOutboxService } from '../src/search/search-outbox.service.js';
import { SearchReconciliationService } from '../src/search/search-reconciliation.service.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

// Actual migrated tables/triggers and two independent Prisma pools. Internal
// boundary only: NOT HTTP, production Seller integration or live AI evidence.
// Audits are immutable: retain suite-owned fixtures on this disposable QA DB.
describe('Prepared attribute transaction boundary on migrated PostgreSQL', () => {
  let a: PrismaService;
  let b: PrismaService;
  let adminA: number;
  let adminB: number;
  let buyer: number;
  let inactiveAdmin: number;
  let storeId: number;
  let categoryId: number;
  let definitionId: number;
  let boundaryA: AttributeTransactionBoundary;
  let boundaryB: AttributeTransactionBoundary;
  let reconciliation: SearchReconciliationService;
  const marker = `attr-boundary-${randomUUID()}`;
  const scope = (actorId = adminA, expectedRevision = 1) => ({
    actorId,
    categoryId,
    definitionId,
    expectedRevision,
  });

  beforeAll(async () => {
    assertAttributeReadQaTarget(process.env.DATABASE_URL);
    a = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    b = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await Promise.all([a.$connect(), b.$connect()]);
    const actor = async (
      suffix: string,
      role: 'ADMIN' | 'USER' | 'SELLER',
      isActive = true,
    ) =>
      (
        await a.user.create({
          data: {
            email: `${marker}-${suffix}@example.com`,
            passwordHash: 'not-an-auth-test',
            role,
            isActive,
          },
        })
      ).id;
    adminA = await actor('a', 'ADMIN');
    adminB = await actor('b', 'ADMIN');
    buyer = await actor('buyer', 'USER');
    inactiveAdmin = await actor('inactive', 'ADMIN', false);
    const seller = await actor('seller', 'SELLER');
    storeId = (
      await a.store.create({ data: { sellerId: seller, name: marker } })
    ).id;
    reconciliation = new SearchReconciliationService(
      a,
      new SearchOutboxService(a),
    );
    boundaryA = new AttributeTransactionBoundary(a, reconciliation);
    boundaryB = new AttributeTransactionBoundary(
      b,
      new SearchReconciliationService(b, new SearchOutboxService(b)),
    );
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    categoryId = (
      await a.category.create({ data: { name: marker, slug: randomUUID() } })
    ).id;
    definitionId = (
      await a.categoryAttributeDefinition.create({
        data: {
          categoryId,
          name: 'Connection',
          slug: 'connection',
          dataType: 'SINGLE_SELECT',
        },
      })
    ).id;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await Promise.all([a?.$disconnect(), b?.$disconnect()]);
  });

  async function state() {
    return {
      definition: await a.categoryAttributeDefinition.findUniqueOrThrow({
        where: { id: definitionId },
      }),
      audits: await a.categoryAttributeAudit.findMany({
        where: { definitionId },
        orderBy: { id: 'asc' },
      }),
      jobs: await a.searchReconciliationJob.findMany({
        where: { scope: 'CATEGORY', scopeId: categoryId },
        orderBy: { id: 'asc' },
      }),
      options: await a.categoryAttributeOption.findMany({
        where: { attributeDefinitionId: definitionId },
        orderBy: { id: 'asc' },
      }),
    };
  }
  const rename = async (
    ctx: AttributeTransactionContext,
    name: string,
    searchMayBeAffected = true,
  ) => {
    await ctx.tx.categoryAttributeDefinition.update({
      where: { id: definitionId },
      data: { name },
    });
    return ctx.recordChange({
      searchMayBeAffected,
      reason: 'Update configuration for QA',
    });
  };

  const creation = (
    slug = 'new-definition',
    effect = false,
    name = 'New definition',
  ): AttributeCreatePlan => ({
    values: {
      name,
      slug,
      dataType: 'TEXT',
      isRequired: false,
      isFilterable: false,
      allowsCustom: true,
      isActive: true,
      sortOrder: 0,
    },
    searchMayBeAffected: effect,
  });
  async function creationState() {
    return {
      category: await a.category.findUniqueOrThrow({
        where: { id: categoryId },
      }),
      definitions: await a.categoryAttributeDefinition.findMany({
        where: { categoryId },
        orderBy: { id: 'asc' },
      }),
      audits: await a.categoryAttributeAudit.findMany({
        where: { categoryId },
        orderBy: { id: 'asc' },
      }),
      jobs: await a.searchReconciliationJob.findMany({
        where: { scope: 'CATEGORY', scopeId: categoryId },
        orderBy: { id: 'asc' },
      }),
    };
  }
  it('creates a revision-one definition and exactly one creation audit without unrelated Search work', async () => {
    const before = await creationState();
    const result = await boundaryA.createDefinition(
      { actorId: adminA, categoryId },
      async (ctx) => {
        expect(ctx.categoryProductCount).toBe(0);
        return creation();
      },
    );
    expect(result.definition).toMatchObject({
      categoryId,
      slug: 'new-definition',
      revision: 1,
    });
    expect(result.searchReconciliation).toBeNull();
    const after = await creationState();
    expect(after.category).toEqual(before.category);
    expect(after.definitions).toHaveLength(before.definitions.length + 1);
    expect(after.definitions[0]).toEqual(before.definitions[0]);
    expect(after.audits).toHaveLength(1);
    expect(after.audits[0]).toMatchObject({
      actorId: adminA,
      categoryId,
      definitionId: result.definition.id,
      revision: 1,
      command: 'CREATE_DEFINITION',
      entityType: 'DEFINITION',
      optionId: null,
      oldValues: null,
      newValues: creation().values,
    });
    expect(after.audits[0].correlationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(after.jobs).toHaveLength(0);
  });
  it('provides canonical category usage to a trusted creation planner and commits its job atomically', async () => {
    const product = await a.product.create({
      data: { storeId, categoryId, name: marker },
    });
    const beforeProduct = await a.product.findUniqueOrThrow({
      where: { id: product.id },
    });
    const result = await boundaryA.createDefinition(
      { actorId: adminA, categoryId },
      async (ctx) => {
        expect(ctx.categoryProductCount).toBe(1);
        return {
          ...creation('required-definition', true),
          values: {
            ...creation().values,
            slug: 'required-definition',
            isRequired: true,
          },
          reason: '  Require configuration for QA  ',
        };
      },
    );
    const state = await creationState();
    expect(state.jobs).toHaveLength(1);
    expect(result.searchReconciliation).toEqual({
      jobId: state.jobs[0].id.toString(),
      status: 'PENDING',
    });
    expect(state.audits[0].reason).toBe('Require configuration for QA');
    expect(
      await a.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).toEqual(beforeProduct);
    expect(
      await a.searchOutbox.count({ where: { productId: product.id } }),
    ).toBe(0);
  });
  it('rolls back a new definition and its audit if creation job insertion fails', async () => {
    const before = await creationState();
    vi.spyOn(reconciliation, 'enqueueCategory').mockRejectedValueOnce(
      new Error('create job fault'),
    );
    await expect(
      boundaryA.createDefinition({ actorId: adminA, categoryId }, async () =>
        creation('job-fault', true),
      ),
    ).rejects.toThrow('create job fault');
    expect(await creationState()).toEqual(before);
  });
  it('rolls back the new definition on a real SQL audit failure', async () => {
    const name = `attr_create_fault_${randomUUID().replaceAll('-', '')}`;
    await a.$executeRawUnsafe(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected creation audit failure'; END $$`,
    );
    await a.$executeRawUnsafe(
      `CREATE TRIGGER "${name}" BEFORE INSERT ON category_attribute_audits FOR EACH ROW WHEN (NEW."categoryId"=${categoryId}) EXECUTE FUNCTION "${name}"()`,
    );
    const before = await creationState();
    try {
      await expect(
        boundaryA.createDefinition({ actorId: adminA, categoryId }, async () =>
          creation('audit-fault', true),
        ),
      ).rejects.toThrow();
      expect(await creationState()).toEqual(before);
    } finally {
      await a.$executeRawUnsafe(
        `DROP TRIGGER "${name}" ON category_attribute_audits`,
      );
      await a.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
    }
  });
  it('does not invoke creation policy for a missing, inactive or non-Admin actor or missing Category', async () => {
    const prepare = vi.fn();
    const before = await creationState();
    await expect(
      boundaryA.createDefinition(
        { actorId: inactiveAdmin, categoryId },
        prepare,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      boundaryA.createDefinition({ actorId: buyer, categoryId }, prepare),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      boundaryA.createDefinition({ actorId: 2147483647, categoryId }, prepare),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      boundaryA.createDefinition(
        { actorId: adminA, categoryId: 2147483647 },
        prepare,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(prepare).not.toHaveBeenCalled();
    expect(await creationState()).toEqual(before);
  });
  it('rejects a creation planner failure without retaining partial work', async () => {
    const before = await creationState();
    await expect(
      boundaryA.createDefinition({ actorId: adminA, categoryId }, async () => {
        throw new ConflictException({
          code: 'ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED',
        });
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await creationState()).toEqual(before);
  });
  it('does not forward caller-supplied identity/revision/timestamps into the definition insert', async () => {
    const plan = creation();
    const hostile = {
      ...plan,
      values: {
        ...plan.values,
        id: 2147483647,
        categoryId: 2147483647,
        revision: 200,
        createdAt: new Date('2000-01-01T00:00:00Z'),
      },
    };
    const result = await boundaryA.createDefinition(
      { actorId: adminA, categoryId },
      async () => hostile,
    );
    expect(result.definition.id).not.toBe(2147483647);
    expect(result.definition.categoryId).toBe(categoryId);
    expect(result.definition.revision).toBe(1);
    expect(result.definition.createdAt.getUTCFullYear()).toBeGreaterThan(2000);
    expect((await creationState()).audits[0].actorId).toBe(adminA);
  });
  it('snapshots the creation actor and category before asynchronous authorization', async () => {
    const input = { actorId: adminA, categoryId };
    const pending = boundaryA.createDefinition(input, async () => creation());
    input.actorId = buyer;
    input.categoryId = 2147483647;
    const result = await pending;
    expect(result.definition.categoryId).toBe(categoryId);
    expect((await creationState()).audits[0].actorId).toBe(adminA);
  });
  it('allows only one concurrent same-slug create and records no losing audit or job', async () => {
    const results = await Promise.allSettled([
      boundaryA.createDefinition({ actorId: adminA, categoryId }, async () =>
        creation('same-slug', true),
      ),
      boundaryB.createDefinition({ actorId: adminB, categoryId }, async () =>
        creation('same-slug', true),
      ),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((row) => row.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toMatchObject({
      code: 'P2002',
    });
    const state = await creationState();
    expect(
      state.definitions.filter((row) => row.slug === 'same-slug'),
    ).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
  });
  it('commits both concurrent distinct-name and distinct-slug definitions with independent revision-one audits', async () => {
    await Promise.all([
      boundaryA.createDefinition({ actorId: adminA, categoryId }, async () =>
        creation('first-distinct', false, 'First distinct definition'),
      ),
      boundaryB.createDefinition({ actorId: adminB, categoryId }, async () =>
        creation('second-distinct', false, 'Second distinct definition'),
      ),
    ]);
    const state = await creationState();
    expect(state.audits).toHaveLength(2);
    expect(
      state.audits.every(
        (row) => row.command === 'CREATE_DEFINITION' && row.revision === 1,
      ),
    ).toBe(true);
    expect(new Set(state.audits.map((row) => row.correlationId)).size).toBe(2);
    expect(state.jobs).toHaveLength(0);
  });
  it('rejects invalid internal creation metadata, effect or audit reason before insert', async () => {
    const before = await creationState();
    for (const override of [
      { searchMayBeAffected: undefined },
      { reason: 'short' },
      { values: { ...creation().values, sortOrder: -1 } },
      { values: { ...creation().values, isActive: 'false' } },
    ]) {
      await expect(
        boundaryA.createDefinition(
          { actorId: adminA, categoryId },
          async () =>
            ({ ...creation(), ...override }) as unknown as AttributeCreatePlan,
        ),
      ).rejects.toThrow();
    }
    expect(await creationState()).toEqual(before);
  });

  it('commits metadata, exactly one revision, allowlisted audit and durable job together', async () => {
    const job = await boundaryA.run(scope(), (ctx) =>
      rename(ctx, 'Connectivity'),
    );
    const result = await state();
    expect(result.definition).toMatchObject({
      name: 'Connectivity',
      revision: 2,
    });
    expect(result.audits).toHaveLength(1);
    expect(result.audits[0]).toMatchObject({
      actorId: adminA,
      categoryId,
      definitionId,
      entityType: 'DEFINITION',
      command: 'UPDATE_DEFINITION',
      revision: 2,
    });
    expect(result.audits[0].oldValues).toMatchObject({ name: 'Connection' });
    expect(result.audits[0].newValues).toMatchObject({ name: 'Connectivity' });
    expect(Object.keys(result.audits[0].newValues as object).sort()).toEqual(
      [
        'allowsCustom',
        'dataType',
        'isActive',
        'isFilterable',
        'isRequired',
        'name',
        'slug',
        'sortOrder',
      ].sort(),
    );
    expect(result.jobs).toHaveLength(1);
    expect(job).toEqual({
      jobId: result.jobs[0].id.toString(),
      status: 'PENDING',
    });
  });
  it('allows only one of two Admin decisions using the same revision', async () => {
    const results = await Promise.allSettled([
      boundaryA.run(scope(), async (ctx) => {
        await delay(50);
        return rename(ctx, 'A');
      }),
      boundaryB.run(scope(adminB), (ctx) => rename(ctx, 'B')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      ConflictException,
    );
    const result = await state();
    expect(result.definition.revision).toBe(2);
    expect(result.audits).toHaveLength(1);
    expect(result.jobs).toHaveLength(1);
  });
  it('locks the parent before concurrent child inserts and advances it only once', async () => {
    const insert = (ctx: AttributeTransactionContext, value: string) =>
      (async () => {
        const option = await ctx.tx.categoryAttributeOption.create({
          data: {
            attributeDefinitionId: definitionId,
            value,
            slug: value.toLowerCase(),
          },
        });
        return ctx.recordChange({
          optionId: option.id,
          searchMayBeAffected: false,
        });
      })();
    const results = await Promise.allSettled([
      boundaryA.run(scope(), (ctx) => insert(ctx, 'USB')),
      boundaryB.run(scope(adminB), (ctx) => insert(ctx, 'Wifi')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictException),
    });
    const result = await state();
    expect(result.options).toHaveLength(1);
    expect(result.definition.revision).toBe(2);
    expect(result.audits).toHaveLength(1);
    expect(result.audits[0]).toMatchObject({
      entityType: 'OPTION',
      command: 'CREATE_OPTION',
      oldValues: null,
    });
    expect(result.jobs).toHaveLength(0);
  });
  it('returns current usage from the same transaction, including a DRAFT Product', async () => {
    const product = await a.product.create({
      data: { storeId, categoryId, name: marker },
    });
    const option = await a.categoryAttributeOption.create({
      data: { attributeDefinitionId: definitionId, value: 'USB', slug: 'usb' },
    });
    await a.productAttributeValue.create({
      data: {
        productId: product.id,
        attributeDefinitionId: definitionId,
        optionId: option.id,
      },
    });
    await boundaryA.run(
      { ...scope(adminA, 2), optionId: option.id },
      async (ctx) => {
        expect(ctx.usage).toEqual({
          referencedProductCount: 1,
          optionReferencedProductCount: 1,
          optionCount: 1,
          activeOptionCount: 1,
          categoryProductCount: 1,
        });
        expect(Object.isFrozen(ctx)).toBe(true);
        expect(Object.isFrozen(ctx.definition)).toBe(true);
      },
    );
  });
  it('provides immutable canonical counts for an unused definition without creating audit or Search work', async () => {
    const before = await state();
    const categoryBefore = await a.category.findUniqueOrThrow({
      where: { id: categoryId },
    });
    await boundaryA.run(scope(), async (ctx) => {
      expect(ctx.usage).toEqual({
        referencedProductCount: 0,
        optionReferencedProductCount: 0,
        optionCount: 0,
        activeOptionCount: 0,
        categoryProductCount: 0,
      });
      expect(Object.isFrozen(ctx.usage)).toBe(true);
      expect(Reflect.set(ctx.usage, 'categoryProductCount', 999)).toBe(false);
    });
    expect(await state()).toEqual(before);
    expect(
      await a.category.findUniqueOrThrow({ where: { id: categoryId } }),
    ).toEqual(categoryBefore);
  });
  it('scopes canonical counts to this definition/category and includes inactive references and products without values', async () => {
    const active = await a.categoryAttributeOption.create({
      data: { attributeDefinitionId: definitionId, value: 'USB', slug: 'usb' },
    });
    const inactive = await a.categoryAttributeOption.create({
      data: {
        attributeDefinitionId: definitionId,
        value: 'HDMI',
        slug: 'hdmi',
        isActive: false,
      },
    });
    await a.categoryAttributeOption.create({
      data: {
        attributeDefinitionId: definitionId,
        value: 'WiFi',
        slug: 'wifi',
      },
    });
    const otherDefinition = await a.categoryAttributeDefinition.create({
      data: {
        categoryId,
        name: 'Other',
        slug: 'other',
        dataType: 'SINGLE_SELECT',
      },
    });
    await a.categoryAttributeOption.create({
      data: {
        attributeDefinitionId: otherDefinition.id,
        value: 'Other',
        slug: 'other',
      },
    });
    for (const optionId of [active.id, inactive.id, null]) {
      const product = await a.product.create({
        data: { storeId, categoryId, name: marker },
      });
      if (optionId !== null)
        await a.productAttributeValue.create({
          data: {
            productId: product.id,
            attributeDefinitionId: definitionId,
            optionId,
          },
        });
    }
    const otherCategory = await a.category.create({
      data: { name: marker, slug: randomUUID() },
    });
    await a.product.create({
      data: { storeId, categoryId: otherCategory.id, name: marker },
    });
    const before = await state();
    await boundaryA.run(
      { ...scope(adminA, 4), optionId: inactive.id },
      async (ctx) => {
        expect(ctx.usage).toEqual({
          referencedProductCount: 2,
          optionReferencedProductCount: 1,
          optionCount: 3,
          activeOptionCount: 2,
          categoryProductCount: 3,
        });
      },
    );
    expect(await state()).toEqual(before);
  });
  it('keeps all business values, audit and jobs unchanged for a no-op', async () => {
    const before = await state();
    const category = await a.category.findUniqueOrThrow({
      where: { id: categoryId },
    });
    await boundaryA.run(scope(), async () => 'read only work');
    expect(await state()).toEqual(before);
    expect(
      await a.category.findUniqueOrThrow({ where: { id: categoryId } }),
    ).toEqual(category);
  });
  it('snapshots scope before awaiting the database', async () => {
    const input = scope();
    const expectedId = definitionId;
    const pending = boundaryA.run(input, async (ctx) => {
      expect(ctx.definition.id).toBe(expectedId);
    });
    input.actorId = buyer;
    input.definitionId = 2147483647;
    input.expectedRevision = 10;
    await pending;
  });
  it('snapshots internal effect/reason before recordChange awaits', async () => {
    await boundaryA.run(scope(), async (ctx) => {
      await ctx.tx.categoryAttributeDefinition.update({
        where: { id: definitionId },
        data: { name: 'Snapshots' },
      });
      const change = {
        searchMayBeAffected: true,
        reason: 'Original configuration reason',
      };
      const pending = ctx.recordChange(change);
      change.searchMayBeAffected = false;
      change.reason = 'short';
      await pending;
    });
    const result = await state();
    expect(result.jobs).toHaveLength(1);
    expect(result.audits[0].reason).toBe('Original configuration reason');
  });
  it('rolls back metadata and audit if durable job creation fails', async () => {
    const before = await state();
    vi.spyOn(reconciliation, 'enqueueCategory').mockRejectedValueOnce(
      new Error('injected job failure'),
    );
    await expect(
      boundaryA.run(scope(), (ctx) => rename(ctx, 'Must rollback')),
    ).rejects.toThrow('injected job failure');
    expect(await state()).toEqual(before);
  });
  it('rolls back metadata when the real audit insert fails', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const name = `attr_boundary_fault_${suffix}`;
    await a.$executeRawUnsafe(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$`,
    );
    await a.$executeRawUnsafe(
      `CREATE TRIGGER "${name}" BEFORE INSERT ON category_attribute_audits FOR EACH ROW WHEN (NEW."definitionId"=${definitionId}) EXECUTE FUNCTION "${name}"()`,
    );
    const before = await state();
    try {
      await expect(
        boundaryA.run(scope(), (ctx) => rename(ctx, 'Must rollback')),
      ).rejects.toThrow();
      expect(await state()).toEqual(before);
    } finally {
      await a.$executeRawUnsafe(
        `DROP TRIGGER "${name}" ON category_attribute_audits`,
      );
      await a.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
    }
  });
  it('rejects an inactive actor, wrong role and wrong category before invoking work', async () => {
    const work = vi.fn();
    await expect(
      boundaryA.run(scope(inactiveAdmin), work),
    ).rejects.toMatchObject({ status: 401 });
    await expect(boundaryA.run(scope(buyer), work)).rejects.toMatchObject({
      status: 403,
    });
    const other = await a.category.create({
      data: { name: marker, slug: randomUUID() },
    });
    await expect(
      boundaryA.run({ ...scope(), categoryId: other.id }, work),
    ).rejects.toMatchObject({ status: 404 });
    expect(work).not.toHaveBeenCalled();
  });
  it('rejects a stale revision even if the intended operation is a no-op', async () => {
    await boundaryA.run(scope(), (ctx) => rename(ctx, 'New name'));
    const work = vi.fn();
    await expect(boundaryA.run(scope(), work)).rejects.toMatchObject({
      status: 409,
    });
    expect(work).not.toHaveBeenCalled();
    expect((await state()).audits).toHaveLength(1);
  });
  it('rolls back a callback that changes configuration without recording an audit', async () => {
    const before = await state();
    await expect(
      boundaryA.run(scope(), async (ctx) => {
        await ctx.tx.categoryAttributeDefinition.update({
          where: { id: definitionId },
          data: { name: 'Unrecorded' },
        });
      }),
    ).rejects.toThrow('mutation/audit mismatch');
    expect(await state()).toEqual(before);
  });
  it('does not mint duplicate audits when recordChange is called twice in one tick', async () => {
    const before = await state();
    await expect(
      boundaryA.run(scope(), async (ctx) => {
        await ctx.tx.categoryAttributeDefinition.update({
          where: { id: definitionId },
          data: { name: 'Duplicate' },
        });
        const results = await Promise.allSettled([
          ctx.recordChange({ searchMayBeAffected: true }),
          ctx.recordChange({ searchMayBeAffected: true }),
        ]);
        const failed = results.find((r) => r.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      }),
    ).rejects.toThrow('once');
    expect(await state()).toEqual(before);
  });
  it('does not let a swallowed record error commit a partial transaction', async () => {
    const before = await state();
    await expect(
      boundaryA.run(scope(), async (ctx) => {
        await ctx.tx.categoryAttributeDefinition.update({
          where: { id: definitionId },
          data: { name: 'No valid reason' },
        });
        try {
          await ctx.recordChange({
            searchMayBeAffected: true,
            reason: 'short',
          });
        } catch {
          /* Deliberate hostile internal callback. */
        }
      }),
    ).rejects.toThrow('mutation/audit mismatch');
    expect(await state()).toEqual(before);
  });
  it('does not reuse an escaped context after its transaction has completed', async () => {
    let escaped!: AttributeTransactionContext;
    await boundaryA.run(scope(), async (ctx) => {
      escaped = ctx;
    });
    await expect(
      escaped.recordChange({ searchMayBeAffected: false }),
    ).rejects.toThrow('active transaction');
  });
  it('preserves revision at Int max and rolls back an overflowing mutation', async () => {
    const full = await a.categoryAttributeDefinition.create({
      data: {
        categoryId,
        name: 'At maximum',
        slug: 'at-maximum',
        dataType: 'TEXT',
        revision: 2147483647,
      },
    });
    await expect(
      boundaryA.run(
        { ...scope(adminA, 2147483647), definitionId: full.id },
        async (ctx) => {
          await ctx.tx.categoryAttributeDefinition.update({
            where: { id: full.id },
            data: { name: 'Overflow' },
          });
        },
      ),
    ).rejects.toThrow();
    expect(
      await a.categoryAttributeDefinition.findUniqueOrThrow({
        where: { id: full.id },
      }),
    ).toMatchObject({ name: 'At maximum', revision: 2147483647 });
    expect(
      await a.categoryAttributeAudit.count({
        where: { definitionId: full.id },
      }),
    ).toBe(0);
  });
  it('serializes different definitions through the same category fence without losing either audit', async () => {
    const other = await a.categoryAttributeDefinition.create({
      data: { categoryId, name: 'Other', slug: 'other', dataType: 'TEXT' },
    });
    await Promise.all([
      boundaryA.run(scope(), (ctx) => rename(ctx, 'First')),
      boundaryB.run(
        { ...scope(adminB), definitionId: other.id },
        async (ctx) => {
          await ctx.tx.categoryAttributeDefinition.update({
            where: { id: other.id },
            data: { name: 'Second' },
          });
          await ctx.recordChange({ searchMayBeAffected: false });
        },
      ),
    ]);
    expect(
      await a.categoryAttributeAudit.count({ where: { categoryId } }),
    ).toBe(2);
  });
  it('shares the category fence with a value-writer harness, not yet the production Seller service', async () => {
    const product = await a.product.create({
      data: { storeId, categoryId, name: marker },
    });
    // Participating harness uses SERIALIZABLE + fence; an old outside-tx read is
    // not used. This does not prove existing production writers participate.
    await a.$transaction(
      async (tx) => {
        await fenceAttributeCategory(tx, categoryId);
        const canonical =
          await tx.categoryAttributeDefinition.findUniqueOrThrow({
            where: { id: definitionId },
          });
        expect(canonical.dataType).toBe('SINGLE_SELECT');
        await tx.productAttributeValue.create({
          data: {
            productId: product.id,
            attributeDefinitionId: definitionId,
            textValue: 'custom',
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await expect(
      boundaryB.run(scope(adminB), async (ctx) => {
        if (ctx.usage.referencedProductCount)
          throw new ConflictException({ code: 'ATTRIBUTE_TYPE_IN_USE' });
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await state()).definition.dataType).toBe('SINGLE_SELECT');
  });
  it('retries the canonical usage snapshot after an actually blocked concurrent value-writer harness', async () => {
    const product = await a.product.create({
      data: { storeId, categoryId, name: marker },
    });
    let release!: () => void;
    let entered!: (pid: number) => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<number>((resolve) => {
      entered = resolve;
    });
    const writer = b.$transaction(
      async (tx) => {
        await fenceAttributeCategory(tx, categoryId);
        const [row] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        entered(row.pid);
        await hold;
        await tx.productAttributeValue.create({
          data: {
            productId: product.id,
            attributeDefinitionId: definitionId,
            textValue: 'custom',
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 5000,
      },
    );
    const pid = await started;
    const decision = boundaryA
      .run(scope(), async (ctx) => {
        if (ctx.usage.referencedProductCount)
          throw new ConflictException({ code: 'ATTRIBUTE_TYPE_IN_USE' });
        await ctx.tx.categoryAttributeDefinition.update({
          where: { id: definitionId },
          data: { dataType: 'NUMBER' },
        });
        await ctx.recordChange({ searchMayBeAffected: true });
      })
      .then(
        () => null,
        (error) => error,
      );
    let observedBlocked = false;
    try {
      const deadline = Date.now() + 600;
      while (Date.now() < deadline) {
        const [row] = await a.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type='Lock' AND query LIKE '%UPDATE categories SET%'
            AND ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (row.blocked) {
          observedBlocked = true;
          break;
        }
        await delay(10);
      }
    } finally {
      release();
    }
    await writer;
    expect(await decision).toBeInstanceOf(ConflictException);
    expect(observedBlocked).toBe(true);
    expect((await state()).definition).toMatchObject({
      dataType: 'SINGLE_SELECT',
      revision: 1,
    });
    expect((await state()).audits).toHaveLength(0);
  });
  it('reads the latest category Product count after waiting for a participating writer, not a pre-lock count', async () => {
    const before = await state();
    let release!: () => void;
    let entered!: (pid: number) => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<number>((resolve) => {
      entered = resolve;
    });
    const writer = b.$transaction(
      async (tx) => {
        await fenceAttributeCategory(tx, categoryId);
        const [row] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        entered(row.pid);
        await hold;
        await tx.product.create({
          data: { storeId, categoryId, name: marker },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 5000,
      },
    );
    const pid = await started;
    const decision = boundaryA.run(scope(), async (ctx) => ({ ...ctx.usage }));
    // Handle failures immediately while the observer connection probes real locks.
    const settled = decision.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    let observedBlocked = false;
    try {
      const deadline = Date.now() + 600;
      while (Date.now() < deadline) {
        const [row] = await a.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type='Lock' AND query LIKE '%UPDATE categories SET%'
            AND ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (row.blocked) {
          observedBlocked = true;
          break;
        }
        await delay(10);
      }
    } finally {
      release();
    }
    await writer;
    expect(await settled).toEqual({
      value: {
        referencedProductCount: 0,
        optionReferencedProductCount: 0,
        optionCount: 0,
        activeOptionCount: 0,
        categoryProductCount: 1,
      },
    });
    expect(observedBlocked).toBe(true);
    expect(await state()).toEqual(before);
  });
  it('does not mislabel an existing-option update as option creation', async () => {
    const existing = await a.categoryAttributeOption.create({
      data: { attributeDefinitionId: definitionId, value: 'USB', slug: 'usb' },
    });
    const before = await state();
    await expect(
      boundaryA.run(scope(adminA, 2), async (ctx) => {
        await ctx.tx.categoryAttributeOption.update({
          where: { id: existing.id },
          data: { value: 'Different' },
        });
        await ctx.recordChange({
          optionId: existing.id,
          searchMayBeAffected: false,
        });
      }),
    ).rejects.toThrow('creation audit');
    expect(await state()).toEqual(before);
  });
  it('rejects an option deletion after its creation audit was recorded', async () => {
    const before = await state();
    await expect(
      boundaryA.run(scope(), async (ctx) => {
        const option = await ctx.tx.categoryAttributeOption.create({
          data: {
            attributeDefinitionId: definitionId,
            value: 'USB',
            slug: 'usb',
          },
        });
        await ctx.recordChange({
          optionId: option.id,
          searchMayBeAffected: false,
        });
        await ctx.tx.categoryAttributeOption.delete({
          where: { id: option.id },
        });
      }),
    ).rejects.toThrow('changed after audit');
    expect(await state()).toEqual(before);
  });
  it('does not hide a child deletion inside a definition update audit', async () => {
    const option = await a.categoryAttributeOption.create({
      data: { attributeDefinitionId: definitionId, value: 'USB', slug: 'usb' },
    });
    const before = await state();
    await expect(
      boundaryA.run(scope(adminA, 2), async (ctx) => {
        await ctx.tx.categoryAttributeOption.delete({
          where: { id: option.id },
        });
        await ctx.tx.categoryAttributeDefinition.update({
          where: { id: definitionId },
          data: { name: 'Other name' },
        });
        await ctx.recordChange({ searchMayBeAffected: true });
      }),
    ).rejects.toThrow('operation changed option set');
    expect(await state()).toEqual(before);
  });
});
