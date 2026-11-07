import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { SearchReconciliationService } from './search-reconciliation.service.js';

const BACKOFF_SECONDS = [30, 120, 300, 900, 3600, 7200, 14400, 28800];
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

function eligible(now: Date): Prisma.SearchReconciliationJobWhereInput {
  return {
    OR: [
      {
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
    ],
  };
}

@Injectable()
export class SearchReconciliationWorker {
  private readonly logger = new Logger(SearchReconciliationWorker.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: SearchReconciliationService,
    private readonly config: ConfigService,
  ) {}

  async runBatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = await this.prisma.searchReconciliationJob.findMany({
        where: eligible(new Date()),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 20,
      });
      for (const job of jobs) await this.processOne(job);
    } finally {
      this.running = false;
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'search-reconciliation' })
  protected async tick(): Promise<void> {
    if (this.config.get<string>('SEARCH_RECONCILIATION_ENABLED') === 'false')
      return;
    await this.runBatch();
  }

  private async processOne(job: {
    id: bigint;
    attemptCount: number;
    scope: string;
    scopeId: number | null;
  }) {
    const attempt = job.attemptCount + 1;
    const claimed = await this.prisma.searchReconciliationJob.updateMany({
      where: {
        id: job.id,
        attemptCount: job.attemptCount,
        ...eligible(new Date()),
      },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        lastError: null,
      },
    });
    if (!claimed.count) return;

    try {
      const stats = await this.reconciliation.processClaimedJob(
        job.id,
        attempt,
      );
      await this.prisma.searchReconciliationJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', attemptCount: attempt },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          nextAttemptAt: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      this.logger.log(
        `Reconciliation job=${job.id} scope=${job.scope}:${job.scopeId ?? 'all'} scanned=${stats.scanned} created=${stats.created} skipped=${stats.skipped}`,
      );
    } catch (error: unknown) {
      const terminal = attempt >= MAX_ATTEMPTS;
      const delay =
        BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
      await this.prisma.searchReconciliationJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', attemptCount: attempt },
        data: {
          status: terminal ? 'DEAD' : 'FAILED',
          nextAttemptAt: terminal ? null : new Date(Date.now() + delay * 1000),
          leaseExpiresAt: null,
          completedAt: terminal ? new Date() : null,
          lastError: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 500),
        },
      });
      this.logger.error(
        `Reconciliation job=${job.id} attempt=${attempt}/${MAX_ATTEMPTS} status=${terminal ? 'DEAD' : 'FAILED'}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
