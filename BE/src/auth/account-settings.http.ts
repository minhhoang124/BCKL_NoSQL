import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ErrorRequestHandler, Request, Response } from 'express';
import type { AuthenticatedUser } from './auth.types.js';
const write = (req: { method?: string; url?: string }) =>
  (req.method==='POST' && /^\/payments\/vnpay\/orders\/[0-9]+\/start\/?$/i.test((req.url??'').split('?')[0])) ||
  (req.method === 'POST' &&
    /^\/auth\/(?:(?:email|password-reset)\/(?:request|confirm)|phone-otp\/(?:request|confirm|reconcile)|google\/(?:start|link))\/?$/i.test(
      (req.url ?? '').split('?')[0],
    )) ||
  (req.method === 'PATCH' &&
    /^\/auth\/profile\/?$/i.test((req.url ?? '').split('?')[0])) ||
  (req.method === 'POST' &&
    /^\/auth\/password\/?$/i.test((req.url ?? '').split('?')[0]));
export function registerAccountSettingsHttp(app: INestApplication) {
  app.use((req: Request, res: Response, next: () => void) => {
    if (/^\/auth(?:\/|$)/i.test(req.path))
      res.setHeader('Cache-Control', 'no-store');
    if (
      /^\/auth\/email\/status\/?$/i.test(req.path) &&
      (req.originalUrl.includes('?') ||
        req.headers['transfer-encoding'] !== undefined ||
        (req.headers['content-length'] !== undefined &&
          req.headers['content-length'] !== '0'))
    ) {
      res
        .status(400)
        .json({ statusCode: 400, code: 'AUTH_EMAIL_INVALID_INPUT' });
      return;
    }
    if (
      write(req) &&
      (req.originalUrl.includes('?') ||
        !/^application\/json(?:\s*;|\s*$)/i.test(req.get('content-type') ?? ''))
    ) {
      res.status(400).json({
        statusCode: 400,
        message: 'Không nhận query hoặc body khác JSON',
      });
      return;
    }
    next();
  });
  (app as NestExpressApplication).useBodyParser('json', {
    type: write,
    strict: true,
    limit: 8192,
  });
  const errors: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (!write(req)) return next(error);
    const status =
      error &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'entity.too.large'
        ? 413
        : 400;
    res.status(status).json({
      statusCode: status,
      message: 'Body tài khoản không hợp lệ hoặc quá lớn',
    });
  };
  app.use(errors);
}
@Injectable()
export class AccountSettingsGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { expires: number; count: number }
  >();
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    if (this.config.get<string>('ACCOUNT_SETTINGS_WRITE_ENABLED') !== 'true')
      throw new ServiceUnavailableException('Cài đặt tài khoản chưa được bật');
    const req = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const now = Date.now();
    for (const [key, bucket] of this.buckets)
      if (bucket.expires <= now) this.buckets.delete(key);
    const key = `${req.user.userId}:${req.method}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= 10000)
        throw new ServiceUnavailableException('Quota đang bận');
      bucket = { expires: now + 60000, count: 0 };
      this.buckets.set(key, bucket);
    }
    if (++bucket.count > (req.method === 'POST' ? 5 : 20)) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader(
          'Retry-After',
          String(Math.max(1, Math.ceil((bucket.expires - now) / 1000))),
        );
      throw new HttpException(
        'Quá nhiều yêu cầu. Không tự gửi lại thao tác ghi.',
        429,
      );
    }
    return true;
  }
}
