import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { credentialMatches } from '../auth/credential-version.js';
import {
  notificationAudiences,
  notificationId,
  notificationPage,
  readAllConsent,
  readConsent,
} from './notification-input.js';
import {
  NotificationProjector,
  NOTIFICATION_LOCK_NAMESPACE,
} from './notification-projector.js';
@Injectable()
export class NotificationService {
  constructor(
    private readonly db: PrismaService,
    private readonly projector: NotificationProjector,
  ) {}
  private gate() {
    if (process.env.NOTIFICATIONS_ENABLED !== 'true')
      throw new ServiceUnavailableException({ code: 'NOTIFICATIONS_DISABLED' });
  }
  private async actor(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
    const u = await tx.user.findUnique({ where: { id: actor.userId } });
    if (
      !u?.isActive ||
      !credentialMatches(actor.credentialVersion, u.credentialVersion)
    )
      throw new UnauthorizedException();
    const audiences = notificationAudiences(u.role);
    if (!audiences.length) throw new ForbiddenException();
    return { id: u.id, audiences };
  }
  async list(actor: AuthenticatedUser, url: string) {
    this.gate();
    const p = notificationPage(url);
    await this.db.$transaction((tx) => this.actor(tx, actor));
    // Projection is a separate committed/rolled-back transaction, never the read snapshot.
    let syncPending = true;
    try {
      ({ syncPending } = await this.projector.project(actor.userId));
    } catch {
      /* retain previously materialized inbox */
    }
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const u = await this.actor(tx, actor),
          base = { recipientId: u.id, audience: { in: u.audiences } };
        const rows = await tx.notification.findMany({
          where: {
            ...base,
            ...(p.beforeId ? { id: { lt: p.beforeId } } : {}),
            ...(p.unread === null
              ? {}
              : p.unread
                ? { readAt: null }
                : { readAt: { not: null } }),
          },
          orderBy: { id: 'desc' },
          take: p.limit + 1,
        });
        const unreadCount = await tx.notification.count({
            where: { ...base, readAt: null },
          }),
          head = await tx.notification.findFirst({
            where: base,
            orderBy: { id: 'desc' },
            select: { id: true },
          });
        return {
          items: rows.slice(0, p.limit).map((r) => ({
            id: r.id.toString(),
            title: r.title,
            text: r.text,
            link: r.link,
            eventAt: r.eventAt,
            createdAt: r.createdAt,
            readAt: r.readAt,
          })),
          nextBeforeId:
            rows.length > p.limit ? rows[p.limit - 1].id.toString() : null,
          unreadCount,
          throughId: head?.id.toString() ?? null,
          syncPending,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async read(actor: AuthenticatedUser, rawId: string | null, raw: unknown) {
    this.gate();
    let id: bigint | null = null,
      throughId: bigint | null = null;
    if (rawId === null) throughId = readAllConsent(raw);
    else {
      readConsent(raw);
      id = notificationId(rawId);
    }
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${NOTIFICATION_LOCK_NAMESPACE}::integer,${actor.userId}::integer)`;
        await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.userId} FOR SHARE`;
        const u = await this.actor(tx, actor),
          base = { recipientId: u.id, audience: { in: u.audiences } };
        const target = await tx.notification.findFirst({
          where: { ...base, id: id ?? throughId! },
        });
        if (!target) throw new NotFoundException();
        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp() AS now`;
        const result = await tx.notification.updateMany({
          where: {
            ...base,
            readAt: null,
            ...(id ? { id } : { id: { lte: throughId! } }),
          },
          data: { readAt: clock.now },
        });
        if (id) {
          const row = await tx.notification.findUniqueOrThrow({
            where: { id },
          });
          return { id: id.toString(), readAt: row.readAt };
        }
        return { throughId: throughId!.toString(), changed: result.count };
      },
      { maxWait: 2000, timeout: 5000 },
    );
  }
}
