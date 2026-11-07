import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  PipeTransform,
} from '@nestjs/common';
import type { Response } from 'express';

export function addressError(
  status: number,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

@Injectable()
export class AddressIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = Number(value);
    if (
      !/^[0-9]+$/.test(value) ||
      !Number.isInteger(id) ||
      id < 1 ||
      id > 2147483647
    )
      throw addressError(400, 'VALIDATION_ERROR', 'Mã địa chỉ không hợp lệ.');
    return id;
  }
}

// Local to these new routes: do not change error shapes on existing APIs.
@Catch()
export class AddressExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AddressExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    if (body && typeof body === 'object' && 'code' in body) {
      response.status(status).json(body);
      return;
    }
    const errors: Record<number, [string, string]> = {
      400: ['VALIDATION_ERROR', 'Dữ liệu địa chỉ không hợp lệ.'],
      401: ['UNAUTHORIZED', 'Vui lòng đăng nhập lại.'],
      403: ['FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.'],
    };
    if (status >= 500)
      this.logger.error('Address request failed; internal details withheld.');
    const [code, message] = errors[status] ?? [
      'INTERNAL_ERROR',
      'Không thể xử lý yêu cầu.',
    ];
    response.status(status).json({ statusCode: status, code, message });
  }
}
