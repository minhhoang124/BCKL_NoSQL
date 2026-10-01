import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';

const BACKOFF_SECONDS = [30, 120, 300, 900, 3600];
const REQUEST_TIMEOUT_MS = 10_000;
const LEASE_MS = 60_000;
type Event = Prisma.SearchOutboxGetPayload<Record<string, never>>;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function acknowledged(row: Event, value: unknown): boolean {
  const body = object(value);
  if (
    !body ||
    body.productId !== row.productId ||
    body.version !== row.version ||
    body.operation !== row.operation ||
    !['APPLIED', 'NOOP', 'STALE'].includes(String(body.outcome))
  )
    return false;
  const indexes = object(body.indexes);
  if (!indexes) return false;
  return ['elasticsearch', 'faiss'].every((key) => {
    const index = object(indexes[key]);
    if (
      !index ||
      !['SUCCEEDED', 'ALREADY_APPLIED', 'FAILED'].includes(String(index.status))
    )
      return false;
    // STALE acknowledges supersession, not application of the requested version.
    if (body.outcome === 'STALE')
      return (
        index.version === null ||
        (Number.isInteger(index.version) && Number(index.version) >= 1)
      );
    return (
      ['SUCCEEDED', 'ALREADY_APPLIED'].includes(String(index.status)) &&
      index.version === row.version
    );
  });
}

function eligible(now: Date): Prisma.SearchOutboxWhereInput {
  return {
    processedAt: null,
    OR: [
      {
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      {
        status: 'PROCESSING',
        updatedAt: { lte: new Date(now.getTime() - LEASE_MS) },
      },
    ],
  };
}

/**
 * At-least-once delivery. updatedAt is the lease clock, attemptCount is the
 * fencing token incremented at every claim. FAILED with processedAt is terminal.
 * Producers must never reset attemptCount or rewrite an existing event.
 */
@Injectable()
export class SearchSyncWorker {
  private readonly logger = new Logger(SearchSyncWorker.name);
  private readonly aiServiceUrl: string;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.aiServiceUrl =
      config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
  }

  async runBatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.prisma.searchOutbox.findMany({
        where: eligible(new Date()),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 20,
      });
      for (const row of rows) {
        try {
          await this.processOne(row);
        } catch {
          this.logger.error(
            `Outbox ${row.id}: persistence failed; lease will expire`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  protected async tick(): Promise<void> {
    if (this.config.get<string>('SEARCH_SYNC_ENABLED') === 'false') return;
    await this.runBatch();
  }

  private async processOne(row: Event): Promise<void> {
    const attempt = row.attemptCount + 1;
    const claimed = await this.prisma.searchOutbox.updateMany({
      where: {
        id: row.id,
        attemptCount: row.attemptCount,
        ...eligible(new Date()),
      },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (!claimed.count) return;

    let status = 0;
    let body: unknown;
    try {
      const response = await fetch(
        row.operation === 'UPSERT'
          ? `${this.aiServiceUrl}/index/product`
          : `${this.aiServiceUrl}/index/product/${row.productId}?version=${row.version}`,
        {
          method: row.operation === 'UPSERT' ? 'POST' : 'DELETE',
          ...(row.operation === 'UPSERT'
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(row.payload),
              }
            : {}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      status = response.status;
      if (status === 200) body = await response.json();
      else await response.body?.cancel();
    } catch {
      /* Never copy remote bodies or sensitive URLs into logs. */
    }

    const success = status === 200 && acknowledged(row, body);
    const terminal = [400, 401, 403, 404, 409, 422].includes(status);
    const delay =
      BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
    await this.prisma.searchOutbox.updateMany({
      // A recovered lease may belong to another worker. Do not overwrite it.
      where: { id: row.id, status: 'PROCESSING', attemptCount: attempt },
      data: {
        status: success ? 'SUCCEEDED' : 'FAILED',
        processedAt: success || terminal ? new Date() : null,
        nextAttemptAt:
          success || terminal ? null : new Date(Date.now() + delay * 1000),
        lastError: success
          ? null
          : status === 409
            ? 'VERSION_CONFLICT (HTTP 409); manual intervention required'
            : status === 200
              ? 'INVALID_ACKNOWLEDGEMENT'
              : status === 0
                ? 'NETWORK_OR_TIMEOUT'
                : `HTTP ${status}${terminal ? '; manual intervention required' : ''}`,
      },
    });
  }
}
