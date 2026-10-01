import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  SearchReconciliationScope,
  type SearchReconciliationJob,
} from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import {
  isPublicListing,
  listingInclude,
} from '../product/product-public-policy.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import {
  buildUpsertPayload,
  SearchOutboxService,
} from './search-outbox.service.js';

export interface ReconciliationStats {
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
}

type ReconciliationFilter = {
  storeId?: number;
  sellerId?: number;
  brandId?: number;
  categoryIds?: number[];
  batchSize: number;
};

@Injectable()
export class SearchReconciliationService {
  private readonly logger = new Logger(SearchReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SearchOutboxService,
  ) {}

  enqueueAll(tx: Prisma.TransactionClient) {
    return this.enqueue(tx, SearchReconciliationScope.ALL, null);
  }
  enqueueStore(tx: Prisma.TransactionClient, storeId: number) {
    return this.enqueue(tx, SearchReconciliationScope.STORE, storeId);
  }
  enqueueCategory(tx: Prisma.TransactionClient, categoryId: number) {
    return this.enqueue(tx, SearchReconciliationScope.CATEGORY, categoryId);
  }
  enqueueBrand(tx: Prisma.TransactionClient, brandId: number) {
    return this.enqueue(tx, SearchReconciliationScope.BRAND, brandId);
  }
  enqueueSeller(tx: Prisma.TransactionClient, sellerId: number) {
    return this.enqueue(tx, SearchReconciliationScope.SELLER, sellerId);
  }

  /** Diagnostic/manual path. Runtime fan-out uses durable jobs and the worker. */
  reconcileAll(options?: { batchSize?: number }): Promise<ReconciliationStats> {
    return this.runLoop({
      batchSize: this.batchSize(options?.batchSize ?? 100),
    });
  }

  async processClaimedJob(jobId: bigint, attemptCount: number, batchSize = 50) {
    const job = await this.prisma.searchReconciliationJob.findFirstOrThrow({
      where: { id: jobId, status: 'PROCESSING', attemptCount },
    });
    const filter = await this.filterForJob(job, this.batchSize(batchSize));
    let cursor = job.cursorProductId ?? undefined;
    const total: ReconciliationStats = {
      scanned: 0,
      created: 0,
      skipped: 0,
      failed: 0,
    };
    while (true) {
      const page = await this.reconcileBatch({
        ...filter,
        cursor,
        failFast: true,
      });
      this.addStats(total, page.stats);
      if (page.nextCursor === null) break;
      const checkpoint = await this.prisma.searchReconciliationJob.updateMany({
        where: { id: jobId, status: 'PROCESSING', attemptCount },
        data: { cursorProductId: page.nextCursor },
      });
      if (!checkpoint.count) throw new Error('RECONCILIATION_LEASE_LOST');
      cursor = page.nextCursor;
    }
    return total;
  }

  async reconcileBatch(
    options: ReconciliationFilter & {
      cursor?: number;
      failFast?: boolean;
    },
  ): Promise<{ stats: ReconciliationStats; nextCursor: number | null }> {
    const batchSize = this.batchSize(options.batchSize ?? 50);
    const products = await this.prisma.product.findMany({
      where: {
        ...(options.cursor ? { id: { gt: options.cursor } } : {}),
        ...(options.storeId ? { storeId: options.storeId } : {}),
        ...(options.sellerId ? { store: { sellerId: options.sellerId } } : {}),
        ...(options.brandId ? { brandId: options.brandId } : {}),
        ...(options.categoryIds?.length
          ? { categoryId: { in: options.categoryIds } }
          : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    const stats: ReconciliationStats = {
      scanned: products.length,
      created: 0,
      skipped: 0,
      failed: 0,
    };
    for (const product of products) {
      try {
        const outcome = await this.reconcileProduct(product.id);
        stats[outcome === 'CREATED' ? 'created' : 'skipped'] += 1;
      } catch (error) {
        stats.failed += 1;
        this.logger.error(
          `Search reconciliation failed product=${product.id}: ${this.message(error)}`,
        );
        if (options.failFast) throw error;
      }
    }
    return {
      stats,
      nextCursor:
        products.length === batchSize ? products[products.length - 1].id : null,
    };
  }

  async reconcileProduct(productId: number) {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const product = await tx.product.findUniqueOrThrow({
              where: { id: productId },
              include: listingInclude,
            });
            const categories = await tx.category.findMany({
              select: { id: true, parentId: true, isActive: true },
            });
            const latest = await tx.searchOutbox.findFirst({
              where: { target: 'SEARCH_SERVICE', productId },
              orderBy: [{ version: 'desc' }, { id: 'desc' }],
            });
            const publicNow = isPublicListing(product, categories);
            if (publicNow) {
              const payload = buildUpsertPayload(product, categories) as Record<
                string,
                unknown
              >;
              if (
                latest?.operation === 'UPSERT' &&
                this.samePayload(
                  payload,
                  latest.payload as Record<string, unknown>,
                )
              )
                return 'SKIPPED' as const;
            } else if (!latest || latest.operation === 'DELETE') {
              return 'SKIPPED' as const;
            }
            const nextVersion =
              Math.max(product.version, latest?.version ?? 0) + 1;
            const changed = await tx.product.updateMany({
              where: { id: product.id, version: product.version },
              data: { version: nextVersion },
            });
            if (!changed.count)
              throw new Prisma.PrismaClientKnownRequestError(
                'Product changed during reconciliation',
                { code: 'P2034', clientVersion: Prisma.prismaVersion.client },
              );
            if (publicNow) {
              await this.outbox.writeOutboxEvent(
                tx,
                { ...product, version: nextVersion },
                categories,
                nextVersion,
              );
            } else {
              await this.outbox.writeDeleteEvent(tx, product.id, nextVersion);
            }
            return 'CREATED' as const;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isTransactionConflict(error) || attempt === maxAttempts - 1)
          throw error;
        await waitForTransactionRetry(attempt);
      }
    }
    throw new Error('Search reconciliation retries exhausted');
  }

  private enqueue(
    tx: Prisma.TransactionClient,
    scope: SearchReconciliationScope,
    scopeId: number | null,
  ) {
    return tx.searchReconciliationJob.create({
      data: { scope, scopeId, status: 'PENDING', nextAttemptAt: new Date() },
    });
  }

  private async runLoop(filter: ReconciliationFilter) {
    let cursor: number | undefined;
    const total: ReconciliationStats = {
      scanned: 0,
      created: 0,
      skipped: 0,
      failed: 0,
    };
    while (true) {
      const page = await this.reconcileBatch({ ...filter, cursor });
      this.addStats(total, page.stats);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    this.logger.log(`Search reconciliation ${JSON.stringify(total)}`);
    return total;
  }

  private async filterForJob(
    job: SearchReconciliationJob,
    batchSize: number,
  ): Promise<ReconciliationFilter> {
    switch (job.scope) {
      case 'ALL':
        return { batchSize };
      case 'STORE':
        return { storeId: job.scopeId!, batchSize };
      case 'BRAND':
        return { brandId: job.scopeId!, batchSize };
      case 'SELLER':
        return { sellerId: job.scopeId!, batchSize };
      case 'CATEGORY': {
        const categories = await this.prisma.category.findMany({
          select: { id: true, parentId: true },
        });
        return {
          categoryIds: this.descendants(job.scopeId!, categories),
          batchSize,
        };
      }
    }
  }

  private addStats(target: ReconciliationStats, source: ReconciliationStats) {
    target.scanned += source.scanned;
    target.created += source.created;
    target.skipped += source.skipped;
    target.failed += source.failed;
  }

  private samePayload(a: Record<string, unknown>, b: Record<string, unknown>) {
    const keys = [
      'name',
      'description',
      'categoryId',
      'categoryName',
      'categoryPathIds',
      'brandId',
      'brandName',
      'attributes',
      'imageUrls',
      'minPrice',
      'maxPrice',
      'inStock',
    ];
    return keys.every(
      (key) => JSON.stringify(a[key]) === JSON.stringify(b[key]),
    );
  }

  private descendants(
    rootId: number,
    categories: Array<{ id: number; parentId: number | null }>,
  ) {
    const result = new Set([rootId]);
    const queue = [rootId];
    while (queue.length) {
      const parentId = queue.shift()!;
      for (const category of categories) {
        if (category.parentId === parentId && !result.has(category.id)) {
          result.add(category.id);
          queue.push(category.id);
        }
      }
    }
    return [...result];
  }

  private batchSize(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 200)
      throw new RangeError('batchSize must be an integer from 1 to 200');
    return value;
  }
  private message(error: unknown) {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      500,
    );
  }
}
