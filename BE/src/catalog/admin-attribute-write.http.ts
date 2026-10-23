import {
  Catch,
  HttpException,
  Injectable,
  Logger,
  type ArgumentsHost,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';

const pathMatches = (req: { url?: string }) =>
  /^\/admin\/categories\/[^/]+\/attributes(?:\/[^/]+(?:\/options(?:\/[^/]+)?)?)?\/?$/i.test(
    (req.url ?? '').split('?')[0],
  );
const writeMatches = (req: { method?: string; url?: string }) =>
  ['POST', 'PATCH'].includes(req.method ?? '') && pathMatches(req);
const reply = (res: Response, status: number, code: string) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ statusCode: status, code, message: code });
};

export function registerAttributeWriteParser(app: INestApplication) {
  if (app.getHttpAdapter().getType() !== 'express')
    throw Error('Attributes require Express');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!writeMatches(req)) return next();
    res.setHeader('Cache-Control', 'no-store');
    if (
      !/^application\/json(?:\s*;|\s*$)/i.test(req.get('content-type') ?? '')
    ) {
      reply(res, 400, 'VALIDATION_ERROR');
      return;
    }
    next();
  });
  (app as NestExpressApplication).useBodyParser('json', {
    limit: 16384,
    type: writeMatches,
    strict: true,
    inflate: true,
  });
  const errors: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (!writeMatches(req)) return next(error);
    const tooLarge =
      error &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'entity.too.large';
    reply(
      res,
      tooLarge ? 413 : 400,
      tooLarge ? 'REQUEST_TOO_LARGE' : 'VALIDATION_ERROR',
    );
  };
  app.use(errors);
}

export function assertAttributeWriteQuery(request: Request) {
  // Do not trust a lossy object parser to detect duplicate/array query params.
  if ((request.originalUrl.split('?')[1] ?? '').length)
    throw new HttpException(
      {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Query is not supported',
      },
      400,
    );
}

@Injectable()
export class AttributeWriteRateGuard implements CanActivate {
  private readonly buckets = new Map<
    number,
    { count: number; expires: number }
  >();
  canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    for (const [id, value] of this.buckets)
      if (value.expires <= now) this.buckets.delete(id);
    const id = req.user.userId;
    let bucket = this.buckets.get(id);
    if (!bucket) {
      if (this.buckets.size >= 10000)
        throw new HttpException('Attribute quota capacity', 503);
      bucket = { count: 0, expires: now + 60000 };
      this.buckets.set(id, bucket);
    }
    if (bucket.count >= 60) {
      res.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((bucket.expires - now) / 1000))),
      );
      throw new HttpException(
        {
          statusCode: 429,
          code: 'ATTRIBUTE_RATE_LIMITED',
          message: 'Too many requests',
        },
        429,
      );
    }
    bucket.count++;
    return true;
  }
}

@Catch()
export class AttributeWriteExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AttributeWriteExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    const code =
      body &&
      typeof body === 'object' &&
      'code' in body &&
      typeof body.code === 'string'
        ? body.code
        : ((
            {
              400: 'VALIDATION_ERROR',
              401: 'UNAUTHORIZED',
              403: 'FORBIDDEN',
              404: 'NOT_FOUND',
              503: 'ATTRIBUTE_WRITE_UNAVAILABLE',
            } as Record<number, string>
          )[status] ?? 'INTERNAL_ERROR');
    if (status >= 500)
      this.logger.error(
        'Attribute mutation failed; transaction details withheld.',
      );
    if (status === 503) res.setHeader('Retry-After', '1');
    reply(res, status, code);
  }
}
