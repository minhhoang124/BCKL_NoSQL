import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';

export interface AccountListQuery {
  limit: number;
  afterId?: number;
  q?: string;
  role?: Role;
  isActive?: boolean;
}

function invalid(): never {
  throw new BadRequestException('Bộ lọc tài khoản không hợp lệ.');
}

// Read the original URL, not Express's configurable query parser: repeated
// keys and bracket/array syntax must never silently become a valid filter.
export function parseAccountListQuery(url: string): AccountListQuery {
  const parameters = new URL(url, 'http://localhost').searchParams;
  const seen = new Set<string>();
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of parameters) {
    if (
      !['limit', 'afterId', 'q', 'role', 'isActive'].includes(key) ||
      seen.has(key)
    )
      invalid();
    seen.add(key);
    values[key] = value;
  }
  const integer = (value: string, maximum: number) => {
    if (!/^[1-9][0-9]*$/.test(value)) invalid();
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result > maximum) invalid();
    return result;
  };
  const result: AccountListQuery = {
    limit: values.limit === undefined ? 50 : integer(values.limit, 100),
  };
  if (values.afterId !== undefined)
    result.afterId = integer(values.afterId, 2147483647);
  if (values.role !== undefined) {
    if (!Object.values(Role).includes(values.role as Role)) invalid();
    result.role = values.role as Role;
  }
  if (values.isActive !== undefined) {
    if (!['true', 'false'].includes(values.isActive)) invalid();
    result.isActive = values.isActive === 'true';
  }
  if (values.q !== undefined) {
    const q = values.q.normalize('NFC').trim();
    const control = [...q].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159);
    });
    if ([...q].length > 120 || control) invalid();
    if (q) result.q = q;
  }
  return result;
}

export function configureAccountListHttp(app: INestApplication): void {
  app.use((request: Request, response: Response, next: () => void) => {
    if (/^\/admin\/accounts(?:\/|$)/i.test(request.path))
      response.setHeader('Cache-Control', 'no-store');
    if (
      /^\/admin\/accounts\/[^/]+\/status(?:\/reconcile)?\/?$/i.test(
        request.path,
      ) &&
      request.originalUrl.includes('?')
    ) {
      response
        .status(400)
        .json({ statusCode: 400, message: 'Status không nhận query.' });
      return;
    }
    if (
      ['GET', 'HEAD'].includes(request.method) &&
      /^\/admin\/accounts(?:\/[^/]+\/status(?:\/history)?)?\/?$/i.test(
        request.path,
      )
    ) {
      // Set before guards, validation and JSON parsing, including error replies.
      response.setHeader('Cache-Control', 'no-store');
      if (
        request.headers['transfer-encoding'] !== undefined ||
        (request.headers['content-length'] !== undefined &&
          request.headers['content-length'] !== '0')
      ) {
        response
          .status(400)
          .json({ statusCode: 400, message: 'GET không nhận body.' });
        return;
      }
    }
    next();
  });
}
