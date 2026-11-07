import { HttpException } from '@nestjs/common';

export function checkoutError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException(
    { statusCode: status, code, message, ...(details ? { details } : {}) },
    status,
  );
}

export function invalidCheckout(): never {
  throw checkoutError(
    400,
    'VALIDATION_ERROR',
    'Dữ liệu đặt hàng không hợp lệ.',
  );
}
