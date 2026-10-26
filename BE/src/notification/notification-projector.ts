import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { notificationSources } from './notification-sources.js';
import { isAccountStatusConflict } from '../auth/account-status-sql.js';
import { waitForTransactionRetry } from '../product/transaction-conflict.js';
export const NOTIFICATION_LOCK_NAMESPACE = 721035;
type Candidate = {
  recipientId: number;
  audience: string;
  sourceId: bigint;
  title: string;
  text: string;
  link: string;
  eventAt: Date;
};
@Injectable()
export class NotificationProjector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationProjector.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private readonly db: PrismaService) {}
  onModuleInit() {
    if (
      process.env.NOTIFICATIONS_ENABLED === 'true' &&
      process.env.NOTIFICATIONS_WORKER_ENABLED === 'true'
    ) {
      this.timer = setInterval(() => void this.tick(), 15000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.project();
    } finally {
      this.running = false;
    }
  }
  async project(recipientId?: number): Promise<{ syncPending: boolean }> {
    if (process.env.NOTIFICATIONS_ENABLED !== 'true')
      return { syncPending: false };
    let syncPending = false;
    for (const source of notificationSources) {
      try {
        let complete = false;
        for (let attempt = 0; attempt < 3; attempt++)
          try {
            const result = await this.db.$transaction(
              async (tx) => {
                await tx.$executeRaw`SET LOCAL statement_timeout='2s'`;
                await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
                const rows = await tx.$queryRaw<Candidate[]>(Prisma.sql`
       WITH events AS (${source.query}), candidates AS (
        SELECT DISTINCT ON (e."recipientId",e."sourceId") e.* FROM events e
        WHERE ${recipientId === undefined ? Prisma.sql`TRUE` : Prisma.sql`e."recipientId"=${recipientId}`}
        ORDER BY e."recipientId",e."sourceId",CASE e.audience WHEN 'ACCOUNT' THEN 1 WHEN 'BUYER' THEN 2 WHEN 'SELLER' THEN 3 ELSE 4 END
       )
       SELECT c.* FROM candidates c WHERE NOT EXISTS(SELECT 1 FROM notifications n
         WHERE n."recipientId"=c."recipientId" AND n."sourceKind"=${source.kind} AND n."sourceId"=c."sourceId" AND n.channel='IN_APP')
       ORDER BY ${recipientId === undefined ? Prisma.sql`c."eventAt" ASC,c."sourceId" ASC,c."recipientId" ASC` : Prisma.sql`c."eventAt" DESC,c."sourceId" DESC,c."recipientId" ASC`}
       LIMIT 101`);
                const batch = rows.slice(0, 100);
                if (batch.length) {
                  // All notification writers and read-state commands use this namespace.
                  // Lock before allocating IDs: per-recipient cursors cannot jump an uncommitted lower ID.
                  const ids = [
                    ...new Set(batch.map((x) => x.recipientId)),
                  ].sort((a, b) => a - b);
                  for (const id of ids)
                    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${NOTIFICATION_LOCK_NAMESPACE}::integer,${id}::integer)`;
                  batch.sort(
                    (a, b) =>
                      a.recipientId - b.recipientId ||
                      (a.sourceId < b.sourceId
                        ? -1
                        : a.sourceId > b.sourceId
                          ? 1
                          : 0),
                  );
                  await tx.$executeRaw(Prisma.sql`INSERT INTO notifications("recipientId",audience,"sourceKind","sourceId",channel,title,text,link,"eventAt") VALUES
        ${Prisma.join(batch.map((r) => Prisma.sql`(${r.recipientId},${r.audience},${source.kind},${r.sourceId},'IN_APP',${r.title},${r.text},${r.link},${r.eventAt})`))}
        ON CONFLICT("recipientId","sourceKind","sourceId",channel) DO NOTHING`);
                }
                return rows.length >= 100;
              },
              { maxWait: 2000, timeout: 5000 },
            );
            syncPending ||= result;
            complete = true;
            break;
          } catch (error) {
            if (isAccountStatusConflict(error)) {
              await waitForTransactionRetry(attempt);
              continue;
            }
            throw error;
          }
        if (!complete) syncPending = true;
      } catch {
        // Source event remains in its committed history; never leak content/credentials in logs.
        this.logger.warn('NOTIFICATION_PROJECTION_RETRY_PENDING');
        syncPending = true;
      }
    }
    return { syncPending };
  }
}
