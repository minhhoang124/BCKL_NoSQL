import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  type INestApplication,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import type { Request, Response } from 'express';

export function orderError(status: number, code: string, message: string) {
  return new HttpException({ statusCode: status, code, message }, status);
}

function invalid(): never {
  throw orderError(400, 'VALIDATION_ERROR', 'Bộ lọc đơn hàng không hợp lệ.');
}

export interface OrderListQuery {
  limit: number;
  afterId?: number;
  status?: OrderStatus;
}

export function parseOrderListQuery(input: unknown): OrderListQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const query = input as Record<string, unknown>;
  if (
    Object.keys(query).some(
      (key) => !['limit', 'afterId', 'status'].includes(key),
    )
  )
    invalid();
  const integer = (value: unknown, maximum: number) => {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) invalid();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > maximum) invalid();
    return number;
  };
  const result: OrderListQuery = {
    limit: query.limit === undefined ? 20 : integer(query.limit, 50),
  };
  if (query.afterId !== undefined)
    result.afterId = integer(query.afterId, 2147483647);
  if (query.status !== undefined) {
    if (
      typeof query.status !== 'string' ||
      !Object.values(OrderStatus).includes(query.status as OrderStatus)
    )
      invalid();
    result.status = query.status as OrderStatus;
  }
  return result;
}

export function assertOrderListHasNoBody(request: Request) {
  // GET has no body contract, including empty JSON and chunked framing.
  if (
    request.headers['transfer-encoding'] !== undefined ||
    (request.headers['content-length'] !== undefined &&
      request.headers['content-length'] !== '0') ||
    request.body !== undefined
  )
    invalid();
}

export function configureOrderListHttp(app: INestApplication) {
  // Before Nest's JSON parser: unsupported GET bodies cannot leak parser errors
  // or consume JSON parsing work before the route rejects them.
  app.use((request: Request, response: Response, next: () => void) => {
    if (
      request.method === 'GET' &&
      /^\/(?:seller\/)?orders\/?$/i.test(request.path)
    ) {
      response.setHeader('Cache-Control', 'no-store');
      try {
        assertOrderListHasNoBody(request);
      } catch {
        response.status(400).json({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'GET danh sách đơn không nhận body.',
        });
        return;
      }
    }
    next();
  });
}

@Catch()
export class OrderListExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OrderListExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    if (body && typeof body === 'object' && 'code' in body) {
      response.status(status).json(body);
      return;
    }
    const errors: Record<number, [string, string]> = {
      400: ['VALIDATION_ERROR', 'Bộ lọc đơn hàng không hợp lệ.'],
      401: ['UNAUTHORIZED', 'Vui lòng đăng nhập lại.'],
      403: ['FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.'],
    };
    if (status >= 500)
      this.logger.error('Order list failed; internal details withheld.');
    const [code, message] = errors[status] ?? [
      'INTERNAL_ERROR',
      'Không thể đọc danh sách đơn hàng.',
    ];
    response.status(status).json({ statusCode: status, code, message });
  }
}
