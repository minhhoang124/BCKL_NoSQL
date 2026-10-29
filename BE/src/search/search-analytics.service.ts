import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { Interval } from '@nestjs/schedule';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma.service.js';
import {
  analyticsCookie,
  analyticsHash,
  capabilityPattern,
  parseAnalyticsEvent,
  parseAnalyticsRange,
} from './search-analytics-policy.js';

type Result = {
  items: {
    productId: number;
    rank: number;
    product: { store: { id: number } };
  }[];
};
@Injectable()
export class SearchAnalyticsService {
  private readonly logger = new Logger(SearchAnalyticsService.name);
  private readonly buckets = new Map<string, { n: number; until: number }>();
  private sweeping = false;
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}
  private settings() {
    const start = this.config.get<string>('SEARCH_ANALYTICS_START_AT') ?? '';
    return {
      enabled:
        this.config.get<string>('SEARCH_ANALYTICS_ENABLED') === 'true' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(start) &&
        Number.isFinite(Date.parse(start)) &&
        new Date(start).toISOString() === start,
      start: new Date(start),
    };
  }
  private eligible(req: Request, event = false) {
    const origin = req.get('origin'),
      allowed =
        this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    if (origin && origin !== allowed) return false;
    if (event && !origin) return false;
    const ua = req.get('user-agent') ?? '';
    return (
      ua.length > 0 &&
      ua.length <= 1024 &&
      !/bot|crawler|spider|headless|curl|wget/i.test(ua)
    );
  }
  // Bounded, per-process ingress quota; not a distributed fraud detector. Never trust XFF.
  private quota(req: Request) {
    const now = Date.now(),
      key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (this.buckets.size >= 10000)
      for (const [id, b] of this.buckets)
        if (b.until <= now) this.buckets.delete(id);
    const old = this.buckets.get(key),
      bucket = old && old.until > now ? old : { n: 0, until: now + 60000 };
    if (
      bucket.n >= 240 ||
      (!this.buckets.has(key) && this.buckets.size >= 10000)
    )
      return false;
    bucket.n++;
    this.buckets.set(key, bucket);
    return true;
  }
  prepare(req: Request, res: Response) {
    if (
      !this.settings().enabled ||
      !this.eligible(req, true) ||
      !this.quota(req)
    )
      return { enabled: false };
    const cookie: unknown = req.cookies?.[analyticsCookie];
    if (typeof cookie !== 'string' || !capabilityPattern.test(cookie)) {
      const path =
        req.originalUrl.split('?')[0]!.replace(/\/session\/?$/i, '') ||
        '/search';
      res.cookie(analyticsCookie, randomBytes(32).toString('base64url'), {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure,
        path,
      });
    }
    return { enabled: true };
  }
  async attach<T extends Result>(
    result: T,
    strategy: 'HYBRID_TEXT' | 'IMAGE',
    req: Request,
    res: Response,
  ): Promise<T & { analytics?: { token: string } }> {
    const settings = this.settings();
    if (
      !settings.enabled ||
      !result.items.length ||
      !this.eligible(req) ||
      !this.quota(req)
    )
      return result;
    let visitor: unknown = req.cookies?.[analyticsCookie];
    if (typeof visitor !== 'string' || !capabilityPattern.test(visitor)) {
      visitor = randomBytes(32).toString('base64url');
      const cookiePath =
        req.originalUrl.split('?')[0]!.replace(/\/(?:hybrid|image)\/?$/i, '') ||
        '/search';
      res.cookie(analyticsCookie, visitor, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure,
        path: cookiePath,
      });
    }
    const token = randomBytes(32).toString('base64url');
    try {
      const recorded = await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL timezone='UTC'`;
          await tx.$executeRaw`SET LOCAL statement_timeout='2s'`;
          const [clock] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT CURRENT_TIMESTAMP::timestamp(3) AS now`;
          if (clock!.now < settings.start) return false;
          await tx.searchLog.create({
            data: {
              tokenHash: analyticsHash(token),
              visitorHash: analyticsHash(token + ':' + visitor),
              strategy,
              createdAt: clock!.now,
              expiresAt: new Date(clock!.now.getTime() + 900000),
              results: {
                create: result.items.map((r) => ({
                  productId: r.productId,
                  storeId: r.product.store.id,
                  rank: r.rank,
                })),
              },
            },
          });
          return true;
        },
        { timeout: 3000, maxWait: 1000 },
      );
      return recorded ? { ...result, analytics: { token } } : result;
    } catch {
      // No query, cookie, IP, capability, DB URL or driver message in logs.
      this.logger.warn('SEARCH_ANALYTICS_CAPTURE_UNAVAILABLE');
      return result;
    }
  }
  async event(raw: unknown, req: Request) {
    const value = parseAnalyticsEvent(raw),
      cookie: unknown = req.cookies?.[analyticsCookie];
    if (!this.settings().enabled)
      throw new ServiceUnavailableException({
        code: 'SEARCH_ANALYTICS_DISABLED',
      });
    if (
      !this.eligible(req, true) ||
      typeof cookie !== 'string' ||
      !capabilityPattern.test(cookie)
    )
      throw new ForbiddenException();
    if (!this.quota(req))
      throw new HttpException({ code: 'SEARCH_ANALYTICS_RATE_LIMIT' }, 429);
    try {
      await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL timezone='UTC'`;
          await tx.$executeRaw`SET LOCAL statement_timeout='2s'`;
          // Lock the parent too: cleanup cannot remove the cohort while acknowledging.
          const rows = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM search_logs WHERE "tokenHash"=${analyticsHash(value.token)} AND "visitorHash"=${analyticsHash(value.token + ':' + cookie)} AND "expiresAt">CURRENT_TIMESTAMP AND "createdAt">=CURRENT_TIMESTAMP-interval '30 days' FOR SHARE`;
          if (!rows.length)
            throw new BadRequestException({ code: 'SEARCH_EVENT_INVALID' });
          const hit = await tx.searchResultLog.findUnique({
            where: {
              searchId_productId: {
                searchId: rows[0]!.id,
                productId: value.productId,
              },
            },
          });
          if (!hit)
            throw new BadRequestException({ code: 'SEARCH_EVENT_INVALID' });
          // UPDATE obtains a row lock. Concurrent first-click and render acknowledgement serialize.
          await tx.$executeRaw`UPDATE search_result_logs SET "impressionAt"=COALESCE("impressionAt",CURRENT_TIMESTAMP) WHERE "searchId"=${hit.searchId}::uuid AND "productId"=${hit.productId}`;
          if (value.event === 'CLICK')
            await tx.$executeRaw`INSERT INTO search_click_logs ("searchId","productId","createdAt") VALUES (${hit.searchId}::uuid,${hit.productId},CURRENT_TIMESTAMP) ON CONFLICT ("searchId","productId") DO NOTHING`;
        },
        { timeout: 3000, maxWait: 1000 },
      );
      return { recorded: true };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException({
        code: 'SEARCH_ANALYTICS_UNAVAILABLE',
      });
    }
  }
  async summary(
    actor: AuthenticatedUser,
    scope: 'SELLER' | 'ADMIN',
    url: string,
  ) {
    const range = parseAnalyticsRange(url, scope),
      settings = this.settings();
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          await tx.$executeRaw`SET LOCAL timezone='UTC'`;
          await tx.$executeRaw`SET LOCAL statement_timeout='5s'`;
          const current = await tx.user.findUnique({
            where: { id: actor.userId },
            select: { role: true, isActive: true, credentialVersion: true },
          });
          if (
            !current?.isActive ||
            current.credentialVersion !== actor.credentialVersion
          )
            throw new UnauthorizedException();
          if (current.role !== scope) throw new ForbiddenException();
          const store =
            scope === 'SELLER'
              ? await tx.store.findUnique({
                  where: { sellerId: actor.userId },
                  select: { id: true },
                })
              : null;
          if (scope === 'SELLER' && !store) throw new NotFoundException();
          const storeId = store?.id ?? range.storeId;
          if (
            scope === 'ADMIN' &&
            storeId !== null &&
            !(await tx.store.findUnique({
              where: { id: storeId },
              select: { id: true },
            }))
          )
            throw new NotFoundException();
          const [clock] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT CURRENT_TIMESTAMP::timestamp(3) AS now`;
          const asOf = clock!.now,
            floor = new Date(asOf.getTime() - 30 * 86400000);
          const availableFrom = settings.enabled
            ? new Date(Math.max(settings.start.getTime(), floor.getTime()))
            : null;
          const base = {
            scope,
            storeId,
            from: range.from,
            to: range.to,
            asOf,
            availableFrom,
            retentionDays: 30,
            attribution: 'SEARCH_COHORT',
            metric: 'VIEWPORT_ACKNOWLEDGED',
            coverage: 'RECORDED_ONLY',
            complete: false,
          };
          if (!settings.enabled)
            return {
              ...base,
              status: 'DISABLED',
              totals: null,
              strategies: [],
            };
          const rows = await tx.$queryRaw<
            { strategy: string; impressions: string; clicks: string }[]
          >`SELECT s.strategy, count(*) FILTER(WHERE r."impressionAt" IS NOT NULL)::text AS impressions, count(c."productId")::text AS clicks FROM search_logs s JOIN search_result_logs r ON r."searchId"=s.id LEFT JOIN search_click_logs c ON c."searchId"=r."searchId" AND c."productId"=r."productId" WHERE s."createdAt">=${range.from} AND s."createdAt"<${range.to} AND s."createdAt">=${availableFrom} AND s."createdAt"<=${asOf} AND ${storeId === null ? Prisma.sql`TRUE` : Prisma.sql`r."storeId"=${storeId}`} GROUP BY s.strategy ORDER BY s.strategy`;
          const number = (value: string) => {
            if (
              !/^\d+$/.test(value) ||
              BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
            )
              throw new Error();
            return Number(value);
          };
          const strategies = rows.map((r) => ({
            strategy: r.strategy,
            impressions: number(r.impressions),
            clicks: number(r.clicks),
          }));
          const totals = strategies.reduce(
            (a, r) => ({
              impressions: a.impressions + r.impressions,
              clicks: a.clicks + r.clicks,
            }),
            { impressions: 0, clicks: 0 },
          );
          if (
            !Number.isSafeInteger(totals.impressions) ||
            !Number.isSafeInteger(totals.clicks) ||
            totals.clicks > totals.impressions
          )
            throw new Error();
          return {
            ...base,
            status:
              range.from < availableFrom! || range.to > asOf
                ? 'PARTIAL'
                : 'RECORDED',
            totals,
            strategies,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 10000,
          maxWait: 2000,
        },
      );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException({
        code: 'SEARCH_ANALYTICS_UNAVAILABLE',
      });
    }
  }
  @Interval(60000)
  async cleanup() {
    if (
      this.config.get<string>('SEARCH_ANALYTICS_RETENTION_ENABLED') ===
        'false' ||
      this.sweeping
    )
      return;
    this.sweeping = true;
    try {
      await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL timezone='UTC'`;
          await tx.$executeRaw`SET LOCAL statement_timeout='3s'`;
          await tx.$executeRaw`DELETE FROM search_logs WHERE id IN(SELECT id FROM search_logs WHERE "createdAt"<CURRENT_TIMESTAMP-interval '30 days' ORDER BY "createdAt" LIMIT 500 FOR UPDATE SKIP LOCKED)`;
        },
        { timeout: 5000, maxWait: 1000 },
      );
    } catch {
      this.logger.warn('SEARCH_ANALYTICS_RETENTION_UNAVAILABLE');
    } finally {
      this.sweeping = false;
    }
  }
}
