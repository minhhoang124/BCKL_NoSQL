import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  type ExceptionFilter,
  type INestApplication,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { orderCommandError } from './order-command-policy.js';

export function sellerOrderId(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/.test(value) ||
    Number(value) > 2147483647
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  return Number(value);
}
export function assertSellerCommandQuery(query: unknown) {
  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    Object.keys(query).length
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
}
function bodyRoute(req: { method?: string; url?: string }) {
  return (
    req.method === 'POST' &&
    /^\/seller\/orders\/[^/]+\/(confirm|start-packing|ready-to-ship)\/?$/i.test(
      (req.url ?? '').split('?')[0],
    )
  );
}

/** Scoped parser BEFORE Checkout registers the default parser. */
export function registerSellerOrderCommandParser(app: INestApplication) {
  if (app.getHttpAdapter().getType() !== 'express')
    throw new Error('Order commands require Express');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!bodyRoute(req)) return next();
    res.setHeader('Cache-Control', 'no-store');
    if (
      !/^application\/json(?:\s*;|\s*$)/i.test(req.get('content-type') ?? '')
    ) {
      res.status(400).json({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Yêu cầu phải dùng JSON.',
      });
      return;
    }
    next();
  });
  (app as NestExpressApplication).useBodyParser('json', {
    limit: 8192,
    type: bodyRoute,
    strict: true,
    inflate: true,
  });
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!bodyRoute(req)) return next(error);
    const tooLarge =
      error &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'entity.too.large';
    const status = tooLarge ? 413 : 400;
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({
      statusCode: status,
      code: tooLarge ? 'REQUEST_TOO_LARGE' : 'VALIDATION_ERROR',
      message: 'Nội dung yêu cầu không hợp lệ.',
    });
  });
}

@Catch()
export class SellerOrderCommandExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SellerOrderCommandExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 'ORDER_COMMAND_IN_PROGRESS')
        res.setHeader('Retry-After', '1');
      res.status(status).json(body);
      return;
    }
    if (status >= 500)
      this.logger.error('Order command failed; internal details withheld.');
    const code =
      (
        {
          400: 'VALIDATION_ERROR',
          401: 'UNAUTHORIZED',
          403: 'FORBIDDEN',
        } as Record<number, string>
      )[status] ?? 'INTERNAL_ERROR';
    res.status(status).json({
      statusCode: status,
      code,
      message: 'Không thể thực hiện yêu cầu xử lý đơn.',
    });
  }
}
