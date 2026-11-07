import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ProductUploadParserInterceptor } from './product-upload-parser.interceptor.js';

describe('ProductUploadParserInterceptor', () => {
  const interceptor = new ProductUploadParserInterceptor();
  const run = (error: Error) =>
    lastValueFrom(
      interceptor.intercept({} as ExecutionContext, {
        handle: () => throwError(() => error),
      }),
    );
  const parserError = (code: string) =>
    Object.assign(new Error('client-controlled detail not for response'), {
      name: 'MulterError',
      code,
    });

  it.each([
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
  ])('normalizes known %s by code, not message', async (code) => {
    await expect(run(parserError(code))).rejects.toMatchObject({
      status: 400,
      message: 'Dữ liệu upload không hợp lệ',
    });
  });
  it('preserves file-size status 413', async () => {
    await expect(run(parserError('LIMIT_FILE_SIZE'))).rejects.toMatchObject({
      status: 413,
    });
  });
  it('does not hide an unknown parser/internal error as a client error', async () => {
    const error = parserError('UNKNOWN_INTERNAL_ERROR');
    await expect(run(error)).rejects.toBe(error);
  });
  it('does not relabel a service error that happens to carry a parser-like code', async () => {
    const error = Object.assign(new Error('service failed'), {
      code: 'LIMIT_UNEXPECTED_FILE',
    });
    await expect(run(error)).rejects.toBe(error);
  });
  it('preserves existing HTTP authorization exceptions', async () => {
    const error = new ForbiddenException();
    await expect(run(error)).rejects.toBe(error);
  });
});
