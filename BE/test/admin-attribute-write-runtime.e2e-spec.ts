import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { SearchReconciliationService } from '../src/search/search-reconciliation.service.js';
import { SearchReconciliationWorker } from '../src/search/search-reconciliation.worker.js';
import { fenceAttributeCategory } from '../src/catalog/attribute-transaction-boundary.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';
import type { App } from './http-test-types.js';

describe('Attributes writes: HTTP, real PostgreSQL, audit and durable Search work', () => {
  let a: INestApplication<App>;
  let b: INestApplication<App>;
  let db: PrismaService;
  let other: PrismaService;
  let categoryId: number;
  let definitionId: number;
  let storeId: number;
  let adminId: number;
  let buyerId: number;
  const tokens: Record<string, string> = {};
  const marker = `attribute-runtime-${randomUUID()}`;
  const reason = 'QA explicit configuration decision';
  const base = () => `/admin/categories/${categoryId}/attributes`;
  const definitionPath = () => `${base()}/${definitionId}`;
  const auth = (app = a) => request(app.getHttpServer());
  const patch = (body: object, app = a, who = 'admin') =>
    auth(app)
      .patch(definitionPath())
      .auth(tokens[who], { type: 'bearer' })
      .send(body);
  beforeAll(async () => {
    assertAttributeReadQaTarget(process.env.DATABASE_URL);
    const create = async () => {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const app: INestApplication<App> = module.createNestApplication();
      configureApp(app);
      await app.init();
      return app;
    };
    a = await create();
    b = await create();
    db = a.get(PrismaService);
    other = b.get(PrismaService);
    for (const [label, role] of [
      ['admin', 'ADMIN'],
      ['other', 'ADMIN'],
      ['buyer', 'USER'],
      ['seller', 'SELLER'],
    ] as const) {
      const actor = await db.user.create({
        data: {
          email: `${marker}-${label}@example.com`,
          role,
          passwordHash: await hash('QA-only-runtime-password', 4),
        },
      });
      const logged = await auth()
        .post('/auth/login')
        .send({ email: actor.email, password: 'QA-only-runtime-password' })
        .expect(200);
      tokens[label] = logged.body.accessToken;
      if (label === 'admin') adminId = actor.id;
      if (label === 'buyer') buyerId = actor.id;
      if (label === 'seller')
        storeId = (
          await db.store.create({
            data: { sellerId: actor.id, name: marker, status: 'ACTIVE' },
          })
        ).id;
    }
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
          name: 'Kết nối',
          slug: 'ket-noi',
          dataType: 'TEXT',
        },
      })
    ).id;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    // Retain test-owned fixtures in disposable QA: audit and its actor are immutable.
    await b?.close();
    await a?.close();
  });
  async function snapshot() {
    return {
      category: await db.category.findUnique({ where: { id: categoryId } }),
      definitions: await db.categoryAttributeDefinition.findMany({
        where: { categoryId },
        orderBy: { id: 'asc' },
      }),
      options: await db.categoryAttributeOption.findMany({
        where: { attributeDefinition: { categoryId } },
        orderBy: { id: 'asc' },
      }),
      values: await db.productAttributeValue.findMany({
        where: { product: { categoryId } },
        orderBy: { id: 'asc' },
      }),
      products: await db.product.findMany({
        where: { categoryId },
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
  async function product(publicState = false) {
    return db.product.create({
      data: {
        categoryId,
        storeId,
        name: 'Runtime QA product',
        ...(publicState
          ? {
              sellerStatus: 'ACTIVE' as const,
              moderationStatus: 'APPROVED' as const,
              images: {
                create: {
                  url: 'http://127.0.0.1:3001/uploads/qa-runtime.png',
                  isPrimary: true,
                },
              },
              shippingProfile: { create: { packageWeightGrams: 100 } },
              variants: {
                create: {
                  skuCode: randomUUID(),
                  optionSignature: 'default',
                  price: '10000',
                  stock: 2,
                },
              },
            }
          : {}),
      },
    });
  }
  async function selectDefinition() {
    await db.categoryAttributeDefinition.update({
      where: { id: definitionId },
      data: { dataType: 'SINGLE_SELECT' },
    });
    return (
      await db.categoryAttributeDefinition.findUniqueOrThrow({
        where: { id: definitionId },
      })
    ).revision;
  }
  async function settle(jobId: string) {
    for (let pass = 0; pass < 100; pass++) {
      const job = await db.searchReconciliationJob.findUniqueOrThrow({
        where: { id: BigInt(jobId) },
      });
      if (job.status === 'SUCCEEDED') return;
      expect(['PENDING', 'PROCESSING']).toContain(job.status);
      await a.get(SearchReconciliationWorker).runBatch();
    }
    throw Error('Target reconciliation job did not settle');
  }

  it('rejects guests, Buyer and Seller without a mutation', async () => {
    const before = await snapshot();
    await auth()
      .post(base())
      .send({ name: 'Forbidden', slug: 'forbidden', dataType: 'TEXT' })
      .expect('Cache-Control', 'no-store')
      .expect(401);
    for (const who of ['buyer', 'seller'])
      await patch({ expectedRevision: 1, sortOrder: 3 }, a, who).expect(403);
    expect(await snapshot()).toEqual(before);
  });
  it.each(['create', 'patch'] as const)(
    'returns503 on real %s lock timeout, rolls back, and permits an explicit later attempt',
    async (operation) => {
      const before = await snapshot();
      let release!: () => void, locked!: () => void;
      const acquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = other.$transaction(
        async (tx) => {
          await fenceAttributeCategory(tx, categoryId);
          locked();
          await gate;
        },
        { timeout: 6000 },
      );
      await acquired;
      const send = () =>
        operation === 'create'
          ? auth()
              .post(base())
              .auth(tokens.other, { type: 'bearer' })
              .send({
                name: 'Explicit retry QA',
                slug: 'explicit-retry',
                dataType: 'TEXT',
              })
          : patch({ expectedRevision: 1, sortOrder: 7 }, a, 'other');
      try {
        const unavailable = await send()
          .expect(503)
          .expect('Retry-After', '1')
          .expect('Cache-Control', 'no-store');
        expect(unavailable.body).toEqual({
          statusCode: 503,
          code: 'ATTRIBUTE_WRITE_UNAVAILABLE',
          message: 'ATTRIBUTE_WRITE_UNAVAILABLE',
        });
        expect(JSON.stringify(unavailable.body)).not.toMatch(
          /P2010|55P03|Prisma|queryRaw|UPDATE categories/i,
        );
      } finally {
        release();
        await blocker;
      }
      expect(await snapshot()).toEqual(before);
      await send().expect(operation === 'create' ? 201 : 200);
      const after = await snapshot();
      expect(after.audits).toHaveLength(1);
      expect(after.jobs).toHaveLength(0);
      if (operation === 'patch')
        expect(after.definitions[0]).toMatchObject({
          revision: 2,
          sortOrder: 7,
        });
      else expect(after.definitions).toHaveLength(2);
    },
  );
  it.each([
    {},
    { expectedRevision: 1 },
    { expectedRevision: '1', name: 'Other' },
    { expectedRevision: 1, isActive: 'false' },
    { expectedRevision: 1, name: null },
    { expectedRevision: 1, actorId: 999, sortOrder: 3 },
  ])('rejects strict invalid PATCH %o atomically', async (body) => {
    const before = await snapshot();
    await patch(body).expect(400);
    expect(await snapshot()).toEqual(before);
  });
  it.each(['0', '01', '2e1', '-1', '2147483648'])(
    'rejects noncanonical category ID %s',
    async (id) => {
      await auth()
        .post(`/admin/categories/${id}/attributes`)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ name: 'Valid', slug: 'valid', dataType: 'TEXT' })
        .expect(400);
    },
  );
  it('rejects query overrides, malformed JSON and oversized bodies without write', async () => {
    const before = await snapshot();
    for (const query of ['?actorId=1', '?limit=1&limit=2'])
      await auth()
        .patch(definitionPath() + query)
        .auth(tokens.admin, { type: 'bearer' })
        .send({ expectedRevision: 1, sortOrder: 2 })
        .expect(400);
    await auth()
      .patch(definitionPath())
      .auth(tokens.admin, { type: 'bearer' })
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    await auth()
      .post(base())
      .auth(tokens.admin, { type: 'bearer' })
      .send({ name: 'x'.repeat(17000) })
      .expect('Cache-Control', 'no-store')
      .expect(413);
    expect(await snapshot()).toEqual(before);
  });
  it('creates a definition via the real controller with revision-one audit and allowlisted envelope', async () => {
    const response = await auth()
      .post(base())
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        name: '  MÀU  SẮC ',
        slug: 'mau-sac',
        dataType: 'TEXT',
        isActive: false,
      })
      .expect(201);
    expect(Object.keys(response.body).sort()).toEqual([
      'definition',
      'option',
      'searchReconciliation',
    ]);
    expect(response.body).toMatchObject({
      definition: {
        name: 'MÀU SẮC',
        revision: 1,
        isActive: false,
        usage: { referencedProductCount: 0 },
      },
      option: null,
      searchReconciliation: null,
    });
    const state = await snapshot();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      actorId: adminId,
      command: 'CREATE_DEFINITION',
      revision: 1,
    });
    expect(state.jobs).toHaveLength(0);
  });
  it('updates slug/filter/order, does not create work for harmless metadata, and makes no-op idempotent', async () => {
    const changed = await patch({
      expectedRevision: 1,
      slug: 'new-connectivity',
      isFilterable: true,
      sortOrder: 3,
    }).expect(200);
    expect(changed.body.definition).toMatchObject({
      revision: 2,
      slug: 'new-connectivity',
      isFilterable: true,
      sortOrder: 3,
    });
    expect(changed.body.searchReconciliation).toBeNull();
    const before = await snapshot();
    await patch({ expectedRevision: 2, sortOrder: 3 }).expect(200);
    expect(await snapshot()).toEqual(before);
    const stale = await patch({ expectedRevision: 1, sortOrder: 3 }).expect(
      409,
    );
    expect(stale.body.code).toBe('ATTRIBUTE_REVISION_CONFLICT');
    expect(await snapshot()).toEqual(before);
  });
  it('returns safe name and slug conflicts, including inactive labels', async () => {
    const before = await snapshot();
    const duplicate = await auth()
      .post(base())
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        name: '  KẾT NỐI ',
        slug: 'other-key',
        dataType: 'TEXT',
        isActive: false,
      })
      .expect(409);
    expect(duplicate.body.code).toBe('ATTRIBUTE_NAME_CONFLICT');
    const slug = await auth()
      .post(base())
      .auth(tokens.admin, { type: 'bearer' })
      .send({ name: 'Other name', slug: 'ket-noi', dataType: 'TEXT' })
      .expect(409);
    expect(slug.body.code).toBe('SLUG_CONFLICT');
    expect(await snapshot()).toEqual(before);
  });
  it('requires both consent and reason, then atomically records policy, audit and durable work', async () => {
    await product();
    const before = await snapshot();
    const noConsent = await patch({
      expectedRevision: 1,
      isRequired: true,
      reason,
    }).expect(409);
    expect(noConsent.body.code).toBe('ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED');
    const noReason = await patch({
      expectedRevision: 1,
      isRequired: true,
      confirmPolicyChange: true,
    }).expect(400);
    expect(noReason.body.code).toBe('ATTRIBUTE_POLICY_REASON_REQUIRED');
    expect(await snapshot()).toEqual(before);
    const response = await patch({
      expectedRevision: 1,
      isRequired: true,
      confirmPolicyChange: true,
      reason,
    }).expect(200);
    expect(response.body.searchReconciliation).toMatchObject({
      status: 'PENDING',
    });
    expect(response.body.searchReconciliation.jobId).toMatch(/^[1-9][0-9]*$/);
    const after = await snapshot();
    expect(after.definitions[0].revision).toBe(2);
    expect(after.audits).toHaveLength(1);
    expect(after.jobs).toHaveLength(1);
    expect(after.products).toEqual(before.products);
  });
  it('preserves DRAFT values and rejects changing used type or slug', async () => {
    const item = await product();
    await db.productAttributeValue.create({
      data: {
        productId: item.id,
        attributeDefinitionId: definitionId,
        textValue: 'saved value',
      },
    });
    const before = await snapshot();
    expect(
      (await patch({ expectedRevision: 1, dataType: 'NUMBER' }).expect(409))
        .body.code,
    ).toBe('ATTRIBUTE_TYPE_IN_USE');
    expect(
      (await patch({ expectedRevision: 1, slug: 'replacement' }).expect(409))
        .body.code,
    ).toBe('ATTRIBUTE_SLUG_IN_USE');
    expect(await snapshot()).toEqual(before);
  });
  it('creates/edits options through shared parent revision; rejects wrong nesting and used label changes', async () => {
    const revision = await selectDefinition();
    const response = await auth()
      .post(`${definitionPath()}/options`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        expectedRevision: revision,
        value: 'Bluetooth',
        slug: 'bluetooth',
      })
      .expect(201);
    const option = response.body.option;
    expect(response.body.definition.revision).toBe(revision + 1);
    const item = await product();
    await db.productAttributeValue.create({
      data: {
        productId: item.id,
        attributeDefinitionId: definitionId,
        optionId: option.id,
      },
    });
    const before = await snapshot();
    const used = await auth()
      .patch(`${definitionPath()}/options/${option.id}`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({ expectedRevision: revision + 1, value: 'Different' })
      .expect(409);
    expect(used.body.code).toBe('ATTRIBUTE_OPTION_IN_USE');
    await auth()
      .patch(`${definitionPath()}/options/2147483647`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({ expectedRevision: revision + 1, sortOrder: 1 })
      .expect(404);
    expect(await snapshot()).toEqual(before);
  });
  it('serializes two Admin HTTP writes through independent app pools to one revision/audit', async () => {
    const responses = await Promise.all([
      patch({ expectedRevision: 1, sortOrder: 4 }),
      patch({ expectedRevision: 1, sortOrder: 9 }, b, 'other'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const state = await snapshot();
    expect(state.definitions[0].revision).toBe(2);
    expect(state.audits).toHaveLength(1);
    expect(state.jobs).toHaveLength(0);
  });
  it('allows only one concurrent option insert at the same parent revision without a raw deadlock', async () => {
    const revision = await selectDefinition();
    const responses = await Promise.all(
      [a, b].map((app, index) =>
        auth(app)
          .post(`${definitionPath()}/options`)
          .auth(tokens[index ? 'other' : 'admin'], { type: 'bearer' })
          .send({
            expectedRevision: revision,
            value: `Choice ${index}`,
            slug: `choice-${index}`,
          }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const state = await snapshot();
    expect(state.options).toHaveLength(1);
    expect(state.definitions[0].revision).toBe(revision + 1);
    expect(state.audits).toHaveLength(1);
  });
  it('rolls metadata, revision and audit back when durable enqueue fails', async () => {
    await product();
    const before = await snapshot();
    vi.spyOn(
      a.get(SearchReconciliationService),
      'enqueueCategory',
    ).mockRejectedValueOnce(new Error('private fault must not leak'));
    const response = await patch({
      expectedRevision: 1,
      isRequired: true,
      confirmPolicyChange: true,
      reason,
    }).expect(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('private fault');
    expect(await snapshot()).toEqual(before);
  });
  it('rolls the actual PostgreSQL mutation back when audit persistence is rejected', async () => {
    const before = await snapshot();
    const constraint = `qa_audit_fault_${randomUUID().replaceAll('-', '')}`;
    // Scoped, temporary fault injection on this private QA DB only. Do not
    // disable immutable audit or any real invariant, and remove only our CHECK.
    await db.$executeRawUnsafe(
      `ALTER TABLE category_attribute_audits ADD CONSTRAINT "${constraint}" CHECK ("categoryId" <> ${categoryId}) NOT VALID`,
    );
    try {
      const response = await patch({
        expectedRevision: 1,
        name: 'Audit must fail',
      }).expect(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain(constraint);
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.$executeRawUnsafe(
        `ALTER TABLE category_attribute_audits DROP CONSTRAINT "${constraint}"`,
      );
    }
  });
  it('rejects non-SELECT options and invalid required SELECT configuration without side effects', async () => {
    const before = await snapshot();
    const unsupported = await auth()
      .post(`${definitionPath()}/options`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({ expectedRevision: 1, value: 'Choice', slug: 'choice' })
      .expect(400);
    expect(unsupported.body.code).toBe('ATTRIBUTE_OPTIONS_NOT_SUPPORTED');
    const invalid = await auth()
      .post(base())
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        name: 'Invalid selection',
        slug: 'invalid-select',
        dataType: 'SINGLE_SELECT',
        allowsCustom: false,
        isRequired: true,
        confirmPolicyChange: true,
        reason,
      })
      .expect(409);
    expect(invalid.body.code).toBe('ATTRIBUTE_REQUIRED_OPTIONS_EMPTY');
    expect(await snapshot()).toEqual(before);
  });
  it('rejects option normalized aliases and does not advance parent revision on conflict', async () => {
    const revision = await selectDefinition();
    await auth()
      .post(`${definitionPath()}/options`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        expectedRevision: revision,
        value: 'Màu Đen',
        slug: 'den',
        isActive: false,
      })
      .expect(201);
    const before = await snapshot();
    const conflict = await auth()
      .post(`${definitionPath()}/options`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        expectedRevision: revision + 1,
        value: ' MÀU  ĐEN ',
        slug: 'different',
      })
      .expect(409);
    expect(conflict.body.code).toBe('ATTRIBUTE_OPTION_VALUE_CONFLICT');
    expect(await snapshot()).toEqual(before);
  });
  it('omits a disabled optional option from both public HTTP and Search payload without deleting the stored value', async () => {
    const revision = await selectDefinition();
    const option = await auth()
      .post(`${definitionPath()}/options`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        expectedRevision: revision,
        value: 'Bluetooth',
        slug: 'bluetooth',
      })
      .expect(201);
    const item = await product(true);
    await db.productAttributeValue.create({
      data: {
        productId: item.id,
        attributeDefinitionId: definitionId,
        optionId: option.body.option.id,
      },
    });
    await a.get(SearchReconciliationService).reconcileProduct(item.id);
    const before = await auth().get(`/products/${item.id}`).expect(200);
    expect(before.body.attributes).toContainEqual({
      id: definitionId,
      name: 'Kết nối',
      value: 'Bluetooth',
    });
    const path = `${definitionPath()}/options/${option.body.option.id}`;
    const denied = await auth()
      .patch(path)
      .auth(tokens.admin, { type: 'bearer' })
      .send({ expectedRevision: revision + 1, isActive: false })
      .expect(409);
    expect(denied.body.code).toBe('ATTRIBUTE_POLICY_CONFIRMATION_REQUIRED');
    const disabled = await auth()
      .patch(path)
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        expectedRevision: revision + 1,
        isActive: false,
        confirmPolicyChange: true,
        reason,
      })
      .expect(200);
    expect(disabled.body.option).toMatchObject({
      isActive: false,
      referencedProductCount: 1,
    });
    const publicAfter = await auth().get(`/products/${item.id}`).expect(200);
    expect(publicAfter.body.attributes).toEqual([]);
    await settle(disabled.body.searchReconciliation.jobId);
    const event = await db.searchOutbox.findFirstOrThrow({
      where: { productId: item.id },
      orderBy: { version: 'desc' },
    });
    expect(event).toMatchObject({
      operation: 'UPSERT',
      payload: { attributes: {} },
    });
    expect(
      await db.productAttributeValue.count({
        where: { productId: item.id, optionId: option.body.option.id },
      }),
    ).toBe(1);
  });
  it('fails closed at maximum revision but permits a true no-op', async () => {
    const full = await db.categoryAttributeDefinition.create({
      data: {
        categoryId,
        name: 'Maximum revision',
        slug: 'maximum-revision',
        dataType: 'TEXT',
        revision: 2147483647,
      },
    });
    const before = await snapshot();
    const response = await auth()
      .patch(`${base()}/${full.id}`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({ expectedRevision: 2147483647, sortOrder: 2 })
      .expect(409);
    expect(response.body.code).toBe('ATTRIBUTE_REVISION_EXHAUSTED');
    await auth()
      .patch(`${base()}/${full.id}`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({ expectedRevision: 2147483647, sortOrder: 0 })
      .expect(200);
    expect(await snapshot()).toEqual(before);
  });
  it('rechecks active account and role even with an otherwise valid old JWT', async () => {
    const before = await snapshot();
    try {
      await db.user.update({
        where: { id: adminId },
        data: { isActive: false },
      });
      await patch({ expectedRevision: 1, sortOrder: 2 }).expect(401);
      await db.user.update({
        where: { id: adminId },
        data: { isActive: true, role: 'USER' },
      });
      await patch({ expectedRevision: 1, sortOrder: 2 }).expect(403);
    } finally {
      await db.user.update({
        where: { id: adminId },
        data: { isActive: true, role: 'ADMIN' },
      });
    }
    expect(await snapshot()).toEqual(before);
  });
  it('uses current rules when Seller waits behind Admin and does not persist a now-invalid value', async () => {
    const item = await product();
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = other.$transaction(
      async (tx) => {
        await fenceAttributeCategory(tx, categoryId);
        await tx.categoryAttributeDefinition.update({
          where: { id: definitionId },
          data: { dataType: 'NUMBER' },
        });
        locked();
        await gate;
      },
      { timeout: 8000 },
    );
    await acquired;
    const sending = auth()
      .put(`/seller/products/${item.id}/attributes/${definitionId}`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ textValue: 'old TEXT input' })
      .then((response) => response);
    try {
      // Observe actual DB lock-wait, not just a Promise scheduling assumption.
      let observed = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const [row] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0) AS waiting`;
        if (row.waiting) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observed).toBe(true);
    } finally {
      release();
      await transaction;
    }
    expect((await sending).status).toBe(400);
    expect(
      await db.productAttributeValue.count({ where: { productId: item.id } }),
    ).toBe(0);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } })).version,
    ).toBe(item.version);
  });
  it('orders actual Admin PATCH versus actual Seller PUT without changing stored value meaning', async () => {
    const item = await product();
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await fenceAttributeCategory(tx, categoryId);
        locked();
        await gate;
      },
      { timeout: 8000 },
    );
    await acquired;
    const admin = patch({ expectedRevision: 1, dataType: 'NUMBER' }).then(
      (response) => response,
    );
    const seller = auth(b)
      .put(`/seller/products/${item.id}/attributes/${definitionId}`)
      .auth(tokens.seller, { type: 'bearer' })
      .send({ textValue: 'Seller text value' })
      .then((response) => response);
    try {
      let observed = 0;
      for (let attempt = 0; attempt < 80; attempt++) {
        const [row] = await other.$queryRaw<
          Array<{ waiting: bigint }>
        >`SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0`;
        observed = Number(row.waiting);
        if (observed >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observed).toBeGreaterThanOrEqual(2);
    } finally {
      release();
      await blocker;
    }
    const [adminResult, sellerResult] = await Promise.all([admin, seller]);
    const state = await snapshot();
    if (adminResult.status === 200) {
      expect(sellerResult.status).toBe(400);
      expect(state.definitions[0]).toMatchObject({
        dataType: 'NUMBER',
        revision: 2,
      });
      expect(state.values).toHaveLength(0);
      expect(state.audits).toHaveLength(1);
      expect(state.products[0].version).toBe(item.version);
    } else {
      expect(adminResult.status).toBe(409);
      expect(adminResult.body.code).toBe('ATTRIBUTE_TYPE_IN_USE');
      expect(sellerResult.status).toBe(200);
      expect(state.definitions[0]).toMatchObject({
        dataType: 'TEXT',
        revision: 1,
      });
      expect(state.values).toHaveLength(1);
      expect(state.audits).toHaveLength(0);
      expect(state.products[0].version).toBe(item.version + 1);
    }
    expect(state.jobs).toHaveLength(0);
  });
  it('keeps a real COD order and replay receipt unchanged after definition and used option changes', async () => {
    const revision = await selectDefinition();
    const createdOption = await auth()
      .post(`${definitionPath()}/options`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        expectedRevision: revision,
        value: 'Bluetooth',
        slug: 'bluetooth',
      })
      .expect(201);
    const item = await product(true);
    await db.productAttributeValue.create({
      data: {
        productId: item.id,
        attributeDefinitionId: definitionId,
        optionId: createdOption.body.option.id,
      },
    });
    const variant = await db.productVariant.findFirstOrThrow({
      where: { productId: item.id },
    });
    // SKU options and Category attributes are separate concepts. Include a
    // non-empty SKU snapshot so this test does not only protect an empty array.
    const group = await db.productOptionGroup.create({
      data: { productId: item.id, name: 'Màu SKU lúc mua' },
    });
    const value = await db.productOptionValue.create({
      data: { productId: item.id, groupId: group.id, value: 'Đen lúc mua' },
    });
    await db.productVariantOptionValue.create({
      data: {
        variantId: variant.id,
        productId: item.id,
        optionGroupId: group.id,
        optionValueId: value.id,
      },
    });
    const address = await db.userAddress.create({
      data: {
        userId: buyerId,
        recipientName: 'Người nhận lúc mua',
        phone: '0901234567',
        province: 'Province QA',
        ward: 'Ward QA',
        addressLine: 'Địa chỉ lúc mua',
      },
    });
    const cart = await db.cart.upsert({
      where: { userId: buyerId },
      create: { userId: buyerId },
      update: {},
    });
    await db.cartItem.create({
      data: { cartId: cart.id, variantId: variant.id, quantity: 1 },
    });
    const key = `attributes_order_${randomUUID()}`;
    const body = {
      addressId: address.id,
      paymentProvider: 'COD',
      items: [
        { variantId: variant.id, quantity: 1, expectedUnitPrice: '10000' },
      ],
    };
    const checkout = (app = a) =>
      auth(app)
        .post('/checkouts')
        .auth(tokens.buyer, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body);
    const first = await checkout().expect(201);
    const orderId: number = first.body.orders[0].id;
    const readOrder = () =>
      db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: { orderBy: { id: 'asc' } },
          payment: true,
          statusHistory: { orderBy: { id: 'asc' } },
          checkout: true,
          commands: true,
          commandResolutions: true,
        },
      });
    const readStock = async () => ({
      variant: await db.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
      }),
      movements: await db.stockMovement.findMany({
        where: { variantId: variant.id },
        orderBy: { id: 'asc' },
      }),
    });
    const detail = async (seller = false) =>
      (
        await auth()
          .get(`${seller ? '/seller' : ''}/orders/${orderId}`)
          .auth(tokens[seller ? 'seller' : 'buyer'], { type: 'bearer' })
          .expect(200)
      ).body;
    const beforeOrder = await readOrder();
    const beforeStock = await readStock();
    const beforeBuyer = await detail();
    const beforeSeller = await detail(true);
    expect(beforeOrder.items[0].optionSnapshot).toEqual([
      {
        groupId: group.id,
        groupName: group.name,
        valueId: value.id,
        value: value.value,
      },
    ]);
    expect(beforeBuyer.items[0]).toMatchObject({
      options: ['Đen lúc mua'],
      unitPrice: '10000.00',
      lineTotal: '10000.00',
    });
    expect(beforeStock.variant.stock).toBe(1);
    expect(beforeStock.movements).toHaveLength(1);

    const renamed = await patch({
      expectedRevision: createdOption.body.definition.revision,
      name: 'Tên thuộc tính mới sau mua',
    }).expect(200);
    const disabled = await auth()
      .patch(`${definitionPath()}/options/${createdOption.body.option.id}`)
      .auth(tokens.admin, { type: 'bearer' })
      .send({
        expectedRevision: renamed.body.definition.revision,
        isActive: false,
        confirmPolicyChange: true,
        reason,
      })
      .expect(200);
    const hidden = await patch({
      expectedRevision: disabled.body.definition.revision,
      isActive: false,
      confirmPolicyChange: true,
      reason,
    }).expect(200);
    for (const response of [renamed, disabled, hidden])
      await settle(response.body.searchReconciliation.jobId);
    expect(
      (await auth().get(`/products/${item.id}`).expect(200)).body.attributes,
    ).toEqual([]);
    expect(await readOrder()).toEqual(beforeOrder);
    expect(await readStock()).toEqual(beforeStock);
    expect(await detail()).toEqual(beforeBuyer);
    expect(await detail(true)).toEqual(beforeSeller);

    // Existing successful Checkout must replay its receipt, not re-check the
    // removed cart line or consume stock a second time under the new rules.
    const replay = await checkout(b).expect(200);
    expect(replay.body).toEqual({ ...first.body, replayed: true });
    expect(await readOrder()).toEqual(beforeOrder);
    expect(await readStock()).toEqual(beforeStock);
  });
  it('blocks public reads, Cart and a new COD checkout immediately when a required rule changes before the worker', async () => {
    const item = await product(true);
    const variant = await db.productVariant.findFirstOrThrow({
      where: { productId: item.id },
    });
    const address = await db.userAddress.create({
      data: {
        userId: buyerId,
        recipientName: 'QA rule change',
        phone: '0901234567',
        province: 'Province QA',
        ward: 'Ward QA',
        addressLine: 'QA address',
      },
    });
    const cart = await db.cart.upsert({
      where: { userId: buyerId },
      create: { userId: buyerId },
      update: {},
    });
    await db.cartItem.create({
      data: { cartId: cart.id, variantId: variant.id, quantity: 1 },
    });
    await auth().get(`/products/${item.id}`).expect(200);
    const changed = await patch({
      expectedRevision: 1,
      isRequired: true,
      confirmPolicyChange: true,
      reason,
    }).expect(200);
    const jobId = BigInt(changed.body.searchReconciliation.jobId);
    expect(
      (
        await db.searchReconciliationJob.findUniqueOrThrow({
          where: { id: jobId },
        })
      ).status,
    ).toBe('PENDING');
    const commercialState = async () => ({
      orders: await db.order.findMany({
        where: { items: { some: { productId: item.id } } },
      }),
      checkouts: await db.checkout.findMany({
        where: { buyerId },
        orderBy: { id: 'asc' },
      }),
      variant: await db.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
      }),
      movements: await db.stockMovement.findMany({
        where: { variantId: variant.id },
      }),
      cartItems: await db.cartItem.findMany({
        where: { cartId: cart.id },
        orderBy: { id: 'asc' },
      }),
      outbox: await db.searchOutbox.findMany({ where: { productId: item.id } }),
    });
    const before = await commercialState();
    expect(before.orders).toHaveLength(0);
    expect(before.movements).toHaveLength(0);
    await auth().get(`/products/${item.id}`).expect(404);
    const currentCart = await auth()
      .get('/cart')
      .auth(tokens.buyer, { type: 'bearer' })
      .expect(200);
    expect(currentCart.body.unavailableItems).toContainEqual({
      variantId: variant.id,
      quantity: 1,
      available: false,
      unavailableReason: 'PRODUCT_UNAVAILABLE',
    });
    const body = {
      addressId: address.id,
      paymentProvider: 'COD',
      items: [
        { variantId: variant.id, quantity: 1, expectedUnitPrice: '10000' },
      ],
    };
    const preview = await auth()
      .post('/checkout/preview')
      .auth(tokens.buyer, { type: 'bearer' })
      .send(body)
      .expect(200);
    expect(preview.body).toMatchObject({
      canCheckout: false,
      totals: null,
      unavailableItems: [
        {
          variantId: variant.id,
          quantity: 1,
          errors: ['VARIANT_NOT_AVAILABLE'],
        },
      ],
    });
    const denied = await auth()
      .post('/checkouts')
      .auth(tokens.buyer, { type: 'bearer' })
      .set('Idempotency-Key', `attributes_invalid_${randomUUID()}`)
      .send(body)
      .expect(409);
    expect(denied.body.code).toBe('VARIANT_NOT_AVAILABLE');
    expect(await commercialState()).toEqual(before);
    expect(
      (
        await db.searchReconciliationJob.findUniqueOrThrow({
          where: { id: jobId },
        })
      ).status,
    ).toBe('PENDING');
  });
  it('required change sends DELETE then relax sends UPSERT, worker replay does not duplicate', async () => {
    const item = await product(true);
    await a.get(SearchReconciliationService).reconcileProduct(item.id);
    const before = await db.product.findUniqueOrThrow({
      where: { id: item.id },
    });
    const required = await patch({
      expectedRevision: 1,
      isRequired: true,
      confirmPolicyChange: true,
      reason,
    }).expect(200);
    await settle(required.body.searchReconciliation.jobId);
    const removed = await db.product.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(removed).toMatchObject({
      version: before.version + 1,
      sellerStatus: 'ACTIVE',
      moderationStatus: 'APPROVED',
    });
    expect(
      await db.searchOutbox.findUnique({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId: item.id,
            version: removed.version,
          },
        },
      }),
    ).toMatchObject({
      operation: 'DELETE',
      payload: { productId: item.id, version: removed.version },
    });
    const relaxed = await patch({
      expectedRevision: 2,
      isRequired: false,
      confirmPolicyChange: true,
      reason,
    }).expect(200);
    await settle(relaxed.body.searchReconciliation.jobId);
    const restored = await db.product.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(restored.version).toBe(removed.version + 1);
    const events = await db.searchOutbox.findMany({
      where: { productId: item.id },
      orderBy: { version: 'asc' },
    });
    expect(events.map((event) => event.operation)).toEqual([
      'UPSERT',
      'DELETE',
      'UPSERT',
    ]);
    await a.get(SearchReconciliationService).reconcileProduct(item.id);
    expect(
      await db.searchOutbox.findMany({
        where: { productId: item.id },
        orderBy: { version: 'asc' },
      }),
    ).toEqual(events);
  });
});
