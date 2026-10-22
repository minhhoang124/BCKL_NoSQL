import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError } from 'rxjs';

const badMultipartCodes = new Set([
  'LIMIT_PART_COUNT',
  'LIMIT_FILE_COUNT',
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_UNEXPECTED_FILE',
  'MISSING_FIELD_NAME',
  'LIMIT_FIELD_NESTING',
  'LIMIT_FIELD_ARRAY_INDEX',
  'STREAM_DESTROYED',
  'INVALID_FIELD_NAME',
]);

@Injectable()
export class ProductUploadParserInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    // Nest12 maps some Multer errors by their old English message. Multer2.4
    // changes/adds messages, so translate known parser codes at this route only.
    // Unknown errors and existing HttpExceptions retain their original handling.
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (
          error instanceof Error &&
          error.name === 'MulterError' &&
          'code' in error
        ) {
          if (error.code === 'LIMIT_FILE_SIZE') {
            return throwError(
              () =>
                new PayloadTooLargeException('Ảnh không được vượt quá 5 MB'),
            );
          }
          if (
            typeof error.code === 'string' &&
            badMultipartCodes.has(error.code)
          ) {
            return throwError(
              () => new BadRequestException('Dữ liệu upload không hợp lệ'),
            );
          }
        }
        return throwError(() => error);
      }),
    );
  }
}
