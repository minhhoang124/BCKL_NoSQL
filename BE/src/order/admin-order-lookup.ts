import { orderError } from './order-list.http.js';

export const ADMIN_ORDER_LOOKUP_LIMIT = 20;
const MIN_HEX = 8;

/**
 * Admin lookup by the displayed order code (`ORD-<uuid>`), never by buyer data.
 * Accepts the full code or a prefix of at least 8 hex characters; case and
 * surrounding whitespace are normalized. Only [0-9a-f-] survive, so the value
 * can never carry LIKE wildcards. Returns undefined for the plain queue.
 */
export function parseAdminOrderLookupQuery(query: unknown): string | undefined {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw orderError(400, 'VALIDATION_ERROR', 'Không nhận bộ lọc.');
  const keys = Object.keys(query);
  if (!keys.length) return undefined;
  const raw = (query as Record<string, unknown>).orderNumber;
  if (keys.length !== 1 || typeof raw !== 'string' || raw.length > 64)
    throw orderError(400, 'VALIDATION_ERROR', 'Không nhận bộ lọc.');
  const value = raw.trim().toLowerCase().replace(/^ord-/, '');
  if (
    !/^[0-9a-f][0-9a-f-]{0,35}$/.test(value) ||
    value.includes('--') ||
    value.replaceAll('-', '').length < MIN_HEX
  )
    throw orderError(
      400,
      'VALIDATION_ERROR',
      'Nhập mã đơn dạng ORD- và ít nhất 8 ký tự đầu của mã.',
    );
  return 'ORD-' + value;
}
