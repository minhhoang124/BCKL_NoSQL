import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma.service.js';

type Action = 'login' | 'register' | 'refresh';
@Injectable()
export class AuthSessionRate {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}
  private limit(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isSafeInteger(value) || value < 1 || value > 10000)
      throw new ServiceUnavailableException({ code: 'AUTH_RATE_UNAVAILABLE' });
    return value;
  }
  async consume(
    action: Action,
    address: string,
    rawEmail?: unknown,
  ): Promise<void> {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET') ?? '';
    if (secret.length < 32)
      throw new ServiceUnavailableException({ code: 'AUTH_RATE_UNAVAILABLE' });
    const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
    const budgets = [
      {
        scope: action + '-ip',
        value: ip,
        limit: this.limit(
          action === 'login'
            ? 'AUTH_LOGIN_IP_PER_MINUTE'
            : action === 'register'
              ? 'AUTH_REGISTER_IP_PER_MINUTE'
              : 'AUTH_SESSION_IP_PER_MINUTE',
          action === 'login' ? 60 : action === 'register' ? 10 : 120,
        ),
      },
    ];
    const email =
      typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (action === 'login' && email.length > 0 && email.length <= 254)
      budgets.push({
        scope: 'login-account',
        value: email,
        limit: this.limit('AUTH_LOGIN_ACCOUNT_PER_MINUTE', 10),
      });
    // Fixed lock order: IP first, account second. Commit the IP attempt even
    // when account quota rejects; an already blocked account cannot bypass IP.
    try {
      const blocked = await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
          // Bounded cleanup; no raw IP/email or password is persisted.
          await tx.$executeRaw`DELETE FROM auth_rate_buckets WHERE ctid IN
          (SELECT ctid FROM auth_rate_buckets WHERE "resetAt" < (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 day' ORDER BY "resetAt",scope,"subjectHash" LIMIT 100 FOR UPDATE SKIP LOCKED)`;
          for (const budget of budgets) {
            const digest = createHmac('sha256', secret)
              .update('auth-abuse:v1:' + budget.scope + '\0' + budget.value)
              .digest('hex');
            const accepted = await tx.$queryRaw<{ count: number }[]>`
            INSERT INTO auth_rate_buckets(scope,"subjectHash",count,"resetAt")
            VALUES (${budget.scope},${digest},1,(clock_timestamp() AT TIME ZONE 'UTC') + interval '1 minute')
            ON CONFLICT (scope,"subjectHash") DO UPDATE SET
              count=CASE WHEN auth_rate_buckets."resetAt" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN 1 ELSE auth_rate_buckets.count+1 END,
              "resetAt"=CASE WHEN auth_rate_buckets."resetAt" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 minute' ELSE auth_rate_buckets."resetAt" END
            WHERE auth_rate_buckets."resetAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR auth_rate_buckets.count < ${budget.limit}
            RETURNING count`;
            if (!accepted.length) {
              const [row] = await tx.$queryRaw<
                { seconds: number }[]
              >`SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM ("resetAt" - (clock_timestamp() AT TIME ZONE 'UTC')))))::integer AS seconds FROM auth_rate_buckets WHERE scope=${budget.scope} AND "subjectHash"=${digest}`;
              return Math.min(60, row?.seconds ?? 60);
            }
          }
          return null;
        },
        { maxWait: 2000, timeout: 4000 },
      );
      if (blocked !== null)
        throw new HttpException(
          {
            code: 'AUTH_RATE_LIMITED',
            message: 'Bạn thao tác quá nhanh. Hãy chờ trước khi thử lại.',
            retryAfter: blocked,
          },
          429,
        );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Missing migration/unavailable DB never falls back to unthrottled login.
      throw new ServiceUnavailableException({ code: 'AUTH_RATE_UNAVAILABLE' });
    }
  }
}

@Injectable()
export class AuthSessionRateGuard implements CanActivate {
  constructor(private readonly rate: AuthSessionRate) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>(),
      res = context.switchToHttp().getResponse<Response>();
    const action = req.path
      .replace(/\/$/, '')
      .split('/')
      .pop()!
      .toLowerCase() as Action;
    try {
      await this.rate.consume(
        action,
        req.socket.remoteAddress ?? 'unknown',
        req.body?.email,
      );
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) {
        const body = error.getResponse() as { retryAfter: number };
        res.setHeader('Retry-After', String(body.retryAfter));
      }
      throw error;
    }
    return true;
  }
}
