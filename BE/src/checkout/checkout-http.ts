import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { checkoutError, invalidCheckout } from './checkout-error.js';
import { exactObject, validateCheckoutKey } from './checkout-request.js';

export function checkoutHeaderKey(request: Request) {
  const key = request.headers['idempotency-key'];
  if (key === undefined)
    throw checkoutError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Thiếu mã yêu cầu đặt hàng.',
    );
  return validateCheckoutKey(key);
}

export function emptyCheckoutFields(input: unknown) {
  if (input !== undefined && !exactObject(input, [])) invalidCheckout();
}

function isCheckoutBodyRoute(request: { method?: string; url?: string }) {
  // Express is case-insensitive/non-strict by default: protect the same aliases
  // as the controller, including a trailing slash; never match a prefix.
  const path = (request.url ?? '').split('?')[0];
  return (
    request.method === 'POST' &&
    /^\/(checkout\/preview|checkouts)\/?$/i.test(path)
  );
}

// Must be called by configureApp BEFORE Nest registers its default JSON parser.
// No new express dependency: use the supported Nest Express parser API.
export function registerCheckoutParser(app: INestApplication): void {
  if (app.getHttpAdapter().getType() !== 'express')
    throw new Error('Checkout parser requires the Express adapter');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const lookup =
      req.method === 'GET' &&
      /^\/checkouts\/by-key\/?$/i.test(req.url.split('?')[0]);
    // A GET body is not part of this contract. Reject its HTTP framing before
    // parsing: adapters/proxies may ignore GET bodies instead of exposing @Body.
    // Never accept an alternative key in an ignored payload, even if chunked.
    if (
      lookup &&
      (req.headers['transfer-encoding'] !== undefined ||
        Number(req.headers['content-length'] ?? 0) > 0)
    ) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Yêu cầu tra biên nhận không có body.',
      });
      return;
    }
    if (!isCheckoutBodyRoute(req)) return next();
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
    limit: 64 * 1024,
    type: isCheckoutBodyRoute,
    strict: true,
    inflate: true,
  });
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!isCheckoutBodyRoute(req)) return next(error);
    const tooLarge =
      error !== null &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'entity.too.large';
    // Never echo parser errors: they may contain the raw body/key/PII.
    const status = tooLarge ? 413 : 400;
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({
      statusCode: status,
      code: tooLarge ? 'REQUEST_TOO_LARGE' : 'VALIDATION_ERROR',
      message: tooLarge ? 'Nội dung yêu cầu quá lớn.' : 'JSON không hợp lệ.',
    });
  });
  // Nest detects parsers by the middleware function name "jsonParser". The
  // scoped parser above would therefore suppress its default JSON parser for
  // every other route. Explicitly retain the default *after* the scoped parser
  // and its error handler; consumed Checkout bodies are not parsed twice.
  (app as NestExpressApplication).useBodyParser('json');
}

@Catch()
export class CheckoutExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CheckoutExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    if (body && typeof body === 'object' && 'code' in body) {
      if (
        body.code === 'RATE_LIMITED' &&
        'details' in body &&
        body.details &&
        typeof body.details === 'object' &&
        'retryAfter' in body.details
      )
        response.setHeader('Retry-After', String(body.details.retryAfter));
      if (body.code === 'CHECKOUT_IN_PROGRESS')
        response.setHeader('Retry-After', '2');
      response.status(status).json(body);
      return;
    }
    if (status >= 500)
      this.logger.error('Checkout request failed; details withheld.');
    const codes: Record<number, [string, string]> = {
      400: ['VALIDATION_ERROR', 'Dữ liệu không hợp lệ.'],
      401: ['UNAUTHORIZED', 'Vui lòng đăng nhập lại.'],
      403: ['FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.'],
    };
    const [code, message] = codes[status] ?? [
      'INTERNAL_ERROR',
      'Không thể xử lý yêu cầu.',
    ];
    response.status(status).json({ statusCode: status, code, message });
  }
}
