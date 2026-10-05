import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
  PipeTransform,
} from '@nestjs/common';
import type { Response } from 'express';

export function cartError(status: number, code: string, message: string) {
  return new HttpException({ statusCode: status, code, message }, status);
}

@Injectable()
export class CartVariantIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = Number(value);
    if (
      !/^[0-9]+$/.test(value) ||
      !Number.isInteger(id) ||
      id < 1 ||
      id > 2147483647
    )
      throw cartError(400, 'VALIDATION_ERROR', 'Mã biến thể không hợp lệ.');
    return id;
  }
}

// Local filter preserves the response shape of pre-existing endpoints.
@Catch()
export class CartExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CartExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    if (body && typeof body === 'object' && 'code' in body) {
      response.status(status).json(body);
      return;
    }
    const codes: Record<number, [string, string]> = {
      400: ['VALIDATION_ERROR', 'Dữ liệu giỏ hàng không hợp lệ.'],
      401: ['UNAUTHORIZED', 'Vui lòng đăng nhập lại.'],
      403: ['FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.'],
    };
    if (status >= 500)
      this.logger.error('Cart request failed; internal details withheld.');
    const [code, message] = codes[status] ?? [
      'INTERNAL_ERROR',
      'Không thể xử lý yêu cầu.',
    ];
    response.status(status).json({ statusCode: status, code, message });
  }
}
