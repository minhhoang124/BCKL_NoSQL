import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { OrderCompletionService } from './order-completion.service.js';

@Injectable()
export class OrderCompletionWorker {
  private readonly logger = new Logger(OrderCompletionWorker.name);
  private running = false;
  private readonly enabled: boolean;
  private readonly delaySeconds: number;
  constructor(
    private readonly prisma: PrismaService,
    private readonly completion: OrderCompletionService,
    config: ConfigService,
  ) {
    const enabled = config.get<string>('ORDER_AUTO_COMPLETE_ENABLED', 'true');
    if (!['true', 'false'].includes(enabled))
      throw new Error('Invalid ORDER_AUTO_COMPLETE_ENABLED');
    this.enabled = enabled === 'true';
    const delay = config.get<string>(
      'ORDER_AUTO_COMPLETE_DELAY_SECONDS',
      '259200',
    );
    if (!/^[1-9][0-9]*$/.test(delay) || Number(delay) > 2592000)
      throw new Error('Invalid ORDER_AUTO_COMPLETE_DELAY_SECONDS');
    this.delaySeconds = Number(delay);
  }
  // Real registered runtime scheduler, no HTTP endpoint accepting SYSTEM identity.
  @Cron('*/15 * * * * *', {
    name: 'order-auto-complete-d07',
    waitForCompletion: true,
  })
  async tick() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      // Persistent Order status/time is discovery checkpoint even if the process
      // died between delivery commit and this scan. No best-effort producer gap.
      await this.database(
        (tx) => tx.$executeRaw`INSERT INTO order_completion_jobs
        ("orderId","deliveredAt","dueAt","nextAttemptAt","updatedAt")
        SELECT o.id,o."deliveredAt",o."deliveredAt"+${this.delaySeconds}*interval '1 second',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        FROM orders o LEFT JOIN order_completion_jobs j ON j."orderId"=o.id
        WHERE o.status='DELIVERED' AND o."deliveredAt" IS NOT NULL
          AND o."deliveredAt"<=CURRENT_TIMESTAMP-${this.delaySeconds}*interval '1 second' AND j.id IS NULL
        ORDER BY o."deliveredAt",o.id LIMIT 100 ON CONFLICT ("orderId") DO NOTHING`,
      );
      // A crash on the last allowed claim must also terminate after lease expiry.
      await this.database(
        (
          tx,
        ) => tx.$executeRaw`UPDATE order_completion_jobs SET status='FAILED',"leaseToken"=NULL,
        "leaseExpiresAt"=NULL,"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP,"lastError"='LEASE_EXHAUSTED'
        WHERE status='RUNNING' AND "leaseExpiresAt"<=CURRENT_TIMESTAMP AND "attemptCount">=6`,
      );
      for (let n = 0; n < 20; n++) {
        const token = randomUUID();
        const jobs = await this.database(
          (tx) => tx.$queryRaw<
            { id: number; orderId: number; attemptCount: number }[]
          >`
          WITH candidate AS (
            SELECT id FROM order_completion_jobs WHERE "attemptCount"<6 AND
              ((status IN ('PENDING','RETRY') AND "nextAttemptAt"<=CURRENT_TIMESTAMP AND "dueAt"<=CURRENT_TIMESTAMP)
                OR (status='RUNNING' AND "leaseExpiresAt"<=CURRENT_TIMESTAMP))
            ORDER BY "nextAttemptAt",id LIMIT 1 FOR UPDATE SKIP LOCKED
          ) UPDATE order_completion_jobs j SET status='RUNNING',"attemptCount"=j."attemptCount"+1,
            "leaseToken"=${token},"leaseExpiresAt"=CURRENT_TIMESTAMP+interval '2 minutes',"updatedAt"=CURRENT_TIMESTAMP
            FROM candidate WHERE j.id=candidate.id RETURNING j.id,j."orderId",j."attemptCount"`,
        );
        const job = jobs[0];
        if (!job) break;
        try {
          const receipt = await this.completion.completeJob(job.id, token);
          this.logger.log(
            `Auto completion job=${job.id} orderId=${job.orderId} outcome=${receipt ? 'SUCCEEDED' : 'SKIPPED'}`,
          );
        } catch (error) {
          const response =
            error instanceof HttpException ? error.getResponse() : null;
          const code =
            response &&
            typeof response === 'object' &&
            'code' in response &&
            typeof response.code === 'string' &&
            /^[A-Z_]{1,64}$/.test(response.code)
              ? response.code
              : 'INTERNAL_ERROR';
          const failed = job.attemptCount >= 6;
          const seconds = Math.min(600, 30 * 2 ** (job.attemptCount - 1));
          // Conditional token update fences a stale worker after another replica
          // reclaimed its lease. No raw error, key, hash, address or token logged.
          await this.database(
            (
              tx,
            ) => tx.$executeRaw`UPDATE order_completion_jobs SET status=${failed ? 'FAILED' : 'RETRY'},
            "nextAttemptAt"=CURRENT_TIMESTAMP+${seconds}*interval '1 second',"lastError"=${code},
            "leaseToken"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP,
            "completedAt"=CASE WHEN ${failed} THEN CURRENT_TIMESTAMP ELSE NULL END
            WHERE id=${job.id} AND status='RUNNING' AND "leaseToken"=${token}`,
          );
          this.logger.warn(
            `Auto completion job=${job.id} orderId=${job.orderId} attempt=${job.attemptCount}/6 code=${code} terminal=${failed}`,
          );
        }
      }
    } catch {
      // Discovery/DB outage: durable Orders/jobs survive. Next cron retries scan.
      this.logger.error('Auto completion batch failed; durable work retained');
    } finally {
      this.running = false;
    }
  }

  private database<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', '2000', true)`;
        await tx.$queryRaw`SELECT set_config('lock_timeout', '1000', true)`;
        return work(tx);
      },
      { maxWait: 2000, timeout: 5000 },
    );
  }
}
