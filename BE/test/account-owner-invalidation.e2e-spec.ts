import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { SearchReconciliationService } from '../src/search/search-reconciliation.service.js';

// Actual service/transaction/PostgreSQL, not HTTP authorization or index proof.
describe('Account Store-owner invalidation transaction', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let jobs: SearchReconciliationService;
  const ids: number[] = [];
  const productIds: number[] = [];
  const categoryIds: number[] = [];
  let admin: {
    userId: number;
    role: 'ADMIN';
    email: string;
    credentialVersion: number;
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    jobs = app.get(SearchReconciliationService);
    const actor = await prisma.user.create({
      data: {
        email: `status-admin-${randomUUID()}@example.test`,
        passwordHash: 'NOT_A_LOGIN_FIXTURE',
        role: 'ADMIN',
      },
    });
    ids.push(actor.id);
    admin = {
      userId: actor.id,
      role: 'ADMIN',
      email: actor.email,
      credentialVersion: actor.credentialVersion,
    };
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma && ids.length) {
      await prisma.searchReconciliationJob.deleteMany({
        where: { scope: 'SELLER', scopeId: { in: ids } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
      await prisma.store.deleteMany({ where: { sellerId: { in: ids } } });
      // Immutable status history survives. Retain its QA actors/targets in this isolated DB.
      await prisma.user.deleteMany({
        where: {
          id: { in: ids },
          accountStatusActions: { none: {} },
          accountStatusHistory: { none: {} },
        },
      });
    }
    await app?.close();
  });
  async function owner(role: Role) {
    const row = await prisma.user.create({
      data: {
        email: `ownership-${randomUUID()}@example.test`,
        passwordHash: 'NOT_A_LOGIN_FIXTURE',
        role,
      },
    });
    ids.push(row.id);
    await prisma.store.create({
      data: {
        sellerId: row.id,
        name: 'Owner invalidation QA',
        status: 'SUSPENDED',
      },
    });
    return row;
  }
  async function status(userId: number, isActive: boolean) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return auth.updateAccountStatus(admin, userId, {
      isActive,
      expectedRevision: user.statusRevision,
      reason: 'QA canonical owner status change',
    });
  }
  it.each([Role.USER, Role.ADMIN, Role.SELLER])(
    'lock/unlock current-role %s owner records durable work without unsuspending Store',
    async (role) => {
      const user = await owner(role);
      for (const isActive of [false, true]) {
        const result = await status(user.id, isActive);
        expect(result.searchReconciliation).not.toBeNull();
        const job = await prisma.searchReconciliationJob.findUniqueOrThrow({
          where: { id: BigInt(result.searchReconciliation!.jobId) },
        });
        expect(job).toMatchObject({
          scope: 'SELLER',
          scopeId: user.id,
          status: 'PENDING',
        });
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
            .isActive,
        ).toBe(isActive);
        expect(
          (
            await prisma.store.findUniqueOrThrow({
              where: { sellerId: user.id },
            })
          ).status,
        ).toBe('SUSPENDED');
      }
    },
  );
  it('enqueue failure rolls the account update back in PostgreSQL', async () => {
    const user = await owner(Role.USER);
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const spy = vi
      .spyOn(jobs, 'enqueueSeller')
      .mockRejectedValueOnce(new Error('QA enqueue failure'));
    try {
      await expect(status(user.id, false)).rejects.toMatchObject({
        status: 503,
      });
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).toEqual(before);
      expect(
        await prisma.searchReconciliationJob.count({
          where: { scope: 'SELLER', scopeId: user.id },
        }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it('no-op does not update timestamps or enqueue work', async () => {
    const user = await owner(Role.USER);
    await status(user.id, true);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toEqual(user);
    expect(
      await prisma.searchReconciliationJob.count({
        where: { scope: 'SELLER', scopeId: user.id },
      }),
    ).toBe(0);
  });
  it('a USER Store owner lock/unlock produces DELETE then canonical UPSERT without replay mutation', async () => {
    const user = await owner(Role.USER);
    const store = await prisma.store.update({
      where: { sellerId: user.id },
      data: { status: 'ACTIVE' },
    });
    const category = await prisma.category.create({
      data: { name: 'QA ownership category', slug: `owner-${randomUUID()}` },
    });
    categoryIds.push(category.id);
    // Synthetic listing fixture; no image is served, and no HTTP index worker runs.
    const image = 'http://127.0.0.1:9/qa-not-served.jpg';
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: 'QA ownership public product',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: { create: { url: image, isPrimary: true } },
        shippingProfile: { create: { packageWeightGrams: 100 } },
        variants: {
          create: {
            skuCode: `QA-${randomUUID()}`,
            optionSignature: 'DEFAULT',
            price: '100000.00',
            stock: 2,
          },
        },
      },
    });
    productIds.push(product.id);
    const beforeVariant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    expect(await jobs.reconcileProduct(product.id)).toBe('CREATED');
    const initial = await prisma.searchOutbox.findFirstOrThrow({
      where: { productId: product.id },
    });
    const expectedPayload = {
      productId: product.id,
      version: 2,
      name: product.name,
      description: '',
      categoryId: category.id,
      categoryName: category.name,
      categoryPathIds: [category.id],
      brandId: null,
      brandName: null,
      attributes: {},
      imageUrls: [image],
      minPrice: '100000',
      maxPrice: '100000',
      inStock: true,
    };
    expect(initial).toMatchObject({
      operation: 'UPSERT',
      version: 2,
      payload: expectedPayload,
    });

    const claim = async (id: bigint) => {
      expect(
        (
          await prisma.searchReconciliationJob.updateMany({
            where: { id, status: 'PENDING', attemptCount: 0 },
            data: {
              status: 'PROCESSING',
              attemptCount: 1,
              leaseExpiresAt: new Date(Date.now() + 60_000),
            },
          })
        ).count,
      ).toBe(1);
    };
    // Controlled fixture-scoped claim + actual durable-job fan-out, not cron proof.
    const locked = await status(user.id, false);
    expect(locked.searchReconciliation).not.toBeNull();
    const lockJob = BigInt(locked.searchReconciliation!.jobId);
    await claim(lockJob);
    expect(await jobs.processClaimedJob(lockJob, 1)).toMatchObject({
      scanned: 1,
      created: 1,
      failed: 0,
    });
    const removed = await prisma.searchOutbox.findFirstOrThrow({
      where: { productId: product.id, version: 3 },
    });
    expect(removed.operation).toBe('DELETE');
    expect(removed.payload).toEqual({ productId: product.id, version: 3 });
    expect(await jobs.processClaimedJob(lockJob, 1)).toMatchObject({
      scanned: 1,
      created: 0,
      skipped: 1,
      failed: 0,
    });

    const unlocked = await status(user.id, true);
    expect(unlocked.searchReconciliation).not.toBeNull();
    const unlockJob = BigInt(unlocked.searchReconciliation!.jobId);
    await claim(unlockJob);
    expect(await jobs.processClaimedJob(unlockJob, 1)).toMatchObject({
      scanned: 1,
      created: 1,
      failed: 0,
    });
    const restored = await prisma.searchOutbox.findFirstOrThrow({
      where: { productId: product.id, version: 4 },
    });
    expect(restored.operation).toBe('UPSERT');
    expect(restored.payload).toEqual({ ...expectedPayload, version: 4 });
    expect(await jobs.processClaimedJob(unlockJob, 1)).toMatchObject({
      created: 0,
      skipped: 1,
      failed: 0,
    });
    expect(
      await prisma.searchOutbox.count({ where: { productId: product.id } }),
    ).toBe(3);
    expect(
      await prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).toMatchObject({
      version: 4,
      sellerStatus: 'ACTIVE',
      moderationStatus: 'APPROVED',
    });
    expect(
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: beforeVariant.id },
      }),
    ).toEqual(beforeVariant);
    expect(
      (await prisma.store.findUniqueOrThrow({ where: { id: store.id } }))
        .status,
    ).toBe('ACTIVE');
  });
});
