import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, type NotificationEmailJob } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';
import { NotificationProjector } from './notification-projector.js';
import { NotificationEmailTransport } from './notification-email-transport.js';
import {
  EMAIL_KINDS,
  digest,
  emailConfig,
  eligibleEmail,
  emailPayload,
  retryAllowed,
  retryDelayMs,
  type EmailConfig,
} from './notification-email-policy.js';

@Injectable()
export class NotificationEmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEmailWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private flight: Promise<void> | null = null;
  constructor(
    private readonly db: PrismaService,
    private readonly projector: NotificationProjector,
    private readonly transport: NotificationEmailTransport,
  ) {}
  onModuleInit() {
    if (
      process.env.NOTIFICATION_EMAIL_ENABLED === 'true' &&
      process.env.NOTIFICATION_EMAIL_WORKER_ENABLED === 'true'
    ) {
      // Invalid configuration disables this worker; it never prevents Order/bootstrap commits.
      try {
        emailConfig();
      } catch {
        this.logger.warn('NOTIFICATION_EMAIL_NOT_CONFIGURED');
        return;
      }
      this.timer = setInterval(() => {
        if (!this.flight) {
          this.flight = this.cycle()
            .catch(() => {
              this.logger.warn('NOTIFICATION_EMAIL_CYCLE_PENDING');
            })
            .finally(() => {
              this.flight = null;
            });
        }
      }, 15000);
      this.timer.unref();
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flight;
  }
  // Optional recipient scope is internal operational/QA control, never an HTTP capability.
  async cycle(recipientId?: number) {
    if (
      process.env.NOTIFICATION_EMAIL_ENABLED !== 'true' ||
      process.env.NOTIFICATIONS_ENABLED !== 'true'
    )
      return;
    const config = emailConfig();
    await this.projector.project(recipientId);
    await this.enqueue(config, recipientId);
    // One bounded batch/cycle, each network operation outside transactions.
    for (let i = 0; i < 10; i++) {
      const job = await this.claim(recipientId);
      if (!job) break;
      await this.deliver(job, config);
    }
  }
  async enqueue(config = emailConfig(), recipientId?: number) {
    if (
      process.env.NOTIFICATION_EMAIL_ENABLED !== 'true' ||
      process.env.NOTIFICATIONS_ENABLED !== 'true'
    )
      return 0;
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout='2s'`;
        const rows = await tx.notification.findMany({
          where: {
            ...(recipientId === undefined ? {} : { recipientId }),
            channel: 'IN_APP',
            sourceKind: { in: EMAIL_KINDS },
            eventAt: { gte: config.startAt },
            emailJob: { is: null },
          },
          include: { recipient: true },
          orderBy: { id: 'asc' },
          take: 100,
        });
        if (!rows.length) return 0;
        const values = rows.map((n) => {
          const eligible = eligibleEmail(n.recipient, n.audience),
            target = eligible ? n.recipient.email : '',
            payload = emailPayload(config, target, n.sourceKind);
          return Prisma.sql`(${n.id},${config.provider},${payload.from},${target},${payload.subject},${payload.text},${digest(payload)},${config.fingerprint},${eligible ? 'QUEUED' : 'SUPPRESSED'},${eligible ? null : 'EMAIL_RECIPIENT_INELIGIBLE'})`;
        });
        // Omit timestamps explicitly: PostgreSQL defaults, never ORM/host clock defaults.
        return tx.$executeRaw(
          Prisma.sql`INSERT INTO notification_email_jobs("notificationId",provider,"fromEmail","toEmail",subject,"bodyText","payloadHash","configFingerprint",status,"lastCode") VALUES ${Prisma.join(values)} ON CONFLICT("notificationId") DO NOTHING`,
        );
      },
      { maxWait: 2000, timeout: 5000 },
    );
  }
  private async claim(
    recipientId?: number,
  ): Promise<NotificationEmailJob | null> {
    const scope =
      recipientId === undefined
        ? Prisma.sql`TRUE`
        : Prisma.sql`"notificationId" IN (SELECT id FROM notifications WHERE "recipientId"=${recipientId})`;
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout='2s'`;
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT CURRENT_TIMESTAMP AS now`;
        const expired = await tx.$queryRaw<
          NotificationEmailJob[]
        >`SELECT * FROM notification_email_jobs WHERE status='LEASED' AND "leaseUntil"<=CURRENT_TIMESTAMP AND ${scope} ORDER BY "leaseUntil","notificationId" FOR UPDATE SKIP LOCKED LIMIT 20`;
        for (const job of expired) {
          const retry =
            job.firstDispatchAt === null
              ? job.attemptStartedAt === null
              : job.attempts < 5 &&
                retryAllowed(job.provider, job.firstDispatchAt, clock.now);
          await tx.notificationEmailJob.update({
            where: { notificationId: job.notificationId },
            data: {
              status: retry ? 'RETRY_WAIT' : 'UNKNOWN',
              leaseId: null,
              leaseUntil: null,
              nextAttemptAt: new Date(
                clock.now.getTime() + retryDelayMs(Math.max(1, job.attempts)),
              ),
              lastCode: 'EMAIL_LEASE_EXPIRED',
            },
          });
        }
        const token = randomUUID();
        const rows = await tx.$queryRaw<
          NotificationEmailJob[]
        >(Prisma.sql`UPDATE notification_email_jobs j SET status='LEASED',"leaseId"=${token}::uuid,"leaseUntil"=CURRENT_TIMESTAMP+interval '30 seconds',"attemptStartedAt"=NULL
        WHERE j."notificationId" IN(SELECT "notificationId" FROM notification_email_jobs WHERE status IN('QUEUED','RETRY_WAIT') AND "nextAttemptAt"<=CURRENT_TIMESTAMP AND ${scope} ORDER BY "nextAttemptAt","notificationId" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING j.*`);
        return rows[0] ?? null;
      },
      { maxWait: 2000, timeout: 5000 },
    );
  }
  private async deliver(job: NotificationEmailJob, config: EmailConfig) {
    const ready = await this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout='2s'`;
        await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT CURRENT_TIMESTAMP AS now`;
        const [locked] = await tx.$queryRaw<
          NotificationEmailJob[]
        >`SELECT * FROM notification_email_jobs WHERE "notificationId"=${job.notificationId} AND status='LEASED' AND "leaseId"=${job.leaseId}::uuid AND "leaseUntil">CURRENT_TIMESTAMP FOR UPDATE`;
        if (!locked) return null;
        const notification = await tx.notification.findUniqueOrThrow({
          where: { id: job.notificationId },
          include: { recipient: true },
        });
        const payload = {
          from: job.fromEmail,
          to: [job.toEmail],
          subject: job.subject,
          text: job.bodyText,
        };
        let status: string | null = null,
          code = '';
        if (
          process.env.NOTIFICATION_EMAIL_ENABLED !== 'true' ||
          process.env.NOTIFICATIONS_ENABLED !== 'true' ||
          config.fingerprint !== job.configFingerprint ||
          !eligibleEmail(notification.recipient, notification.audience) ||
          notification.recipient.email !== job.toEmail ||
          digest(payload) !== job.payloadHash
        ) {
          status = job.firstDispatchAt === null ? 'SUPPRESSED' : 'UNKNOWN';
          code = 'EMAIL_DELIVERY_SUPPRESSED';
        } else if (
          job.attempts >= 5 ||
          (job.firstDispatchAt !== null &&
            !retryAllowed(job.provider, job.firstDispatchAt, clock.now))
        ) {
          status = 'UNKNOWN';
          code = 'EMAIL_RETRY_WINDOW_CLOSED';
        }
        if (status) {
          await tx.notificationEmailJob.update({
            where: { notificationId: job.notificationId },
            data: { status, leaseId: null, leaseUntil: null, lastCode: code },
          });
          return null;
        }
        // Durable marker is committed before opening the HTTP request. A crash afterwards is ambiguous.
        return tx.notificationEmailJob.update({
          where: { notificationId: job.notificationId },
          data: {
            attempts: { increment: 1 },
            attemptStartedAt: clock.now,
            firstDispatchAt: job.firstDispatchAt ?? clock.now,
          },
        });
      },
      { maxWait: 2000, timeout: 5000 },
    );
    if (!ready) return;
    const payload = {
      from: ready.fromEmail,
      to: [ready.toEmail],
      subject: ready.subject,
      text: ready.bodyText,
    };
    const outcome = await this.transport.send(
      config,
      payload,
      `notification-email-${job.notificationId}`,
    );
    const finalized = await this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout='2s'`;
        await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        let status: string,
          code: string | null = null;
        if (outcome.kind === 'accepted') {
          status = 'ACCEPTED_BY_PROVIDER';
          if (clock.now.getTime() < ready.firstDispatchAt!.getTime())
            code = 'EMAIL_CLOCK_ADJUSTED';
        } else {
          code = outcome.code;
          const retry =
            (outcome.kind === 'retry' || outcome.kind === 'unknown') &&
            retryAllowed(ready.provider, ready.firstDispatchAt, clock.now) &&
            ready.attempts < 5;
          // Without a persisted provider receipt, a later rejection does not disprove earlier acceptance.
          status = retry
            ? 'RETRY_WAIT'
            : outcome.kind === 'unknown' || ready.attempts > 1
              ? 'UNKNOWN'
              : 'FAILED';
        }
        return tx.$executeRaw(Prisma.sql`UPDATE notification_email_jobs SET status=${status},"leaseId"=NULL,"leaseUntil"=NULL,"lastCode"=${code},
        "nextAttemptAt"=${new Date(clock.now.getTime() + retryDelayMs(ready.attempts))},
        "acceptedAt"=${outcome.kind === 'accepted' ? new Date(Math.max(clock.now.getTime(), ready.firstDispatchAt!.getTime())) : null},"providerMessageId"=${outcome.kind === 'accepted' ? outcome.id : null}
        WHERE "notificationId"=${job.notificationId} AND status='LEASED' AND "leaseId"=${job.leaseId}::uuid AND "leaseUntil">clock_timestamp()`);
      },
      { maxWait: 2000, timeout: 5000 },
    );
    if (!finalized) this.logger.warn('NOTIFICATION_EMAIL_FINALIZE_FENCED');
  }
}
