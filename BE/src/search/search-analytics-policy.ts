import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const analyticsHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const capabilityPattern = /^[A-Za-z0-9_-]{43}$/;
export const analyticsCookie = 'bckl_search_session';
export function parseAnalyticsEvent(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException();
  const v = raw as Record<string, unknown>;
  if (
    Object.keys(v).length !== 3 ||
    !capabilityPattern.test(typeof v.token === 'string' ? v.token : '') ||
    !Number.isInteger(v.productId) ||
    Number(v.productId) < 1 ||
    Number(v.productId) > 2147483647 ||
    typeof v.event !== 'string' ||
    !['IMPRESSION', 'CLICK'].includes(v.event)
  )
    throw new BadRequestException();
  return {
    token: v.token as string,
    productId: v.productId as number,
    event: v.event as 'IMPRESSION' | 'CLICK',
  };
}
export function parseAnalyticsRange(url: string, scope: 'SELLER' | 'ADMIN') {
  const values = new URL(url, 'http://localhost').searchParams,
    seen = new Set<string>();
  for (const [key] of values) {
    if (
      !['from', 'to', ...(scope === 'ADMIN' ? ['storeId'] : [])].includes(
        key,
      ) ||
      seen.has(key)
    )
      throw new BadRequestException();
    seen.add(key);
  }
  const date = (key: string) => {
    const value = values.get(key) ?? '';
    if (!/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value))
      throw new BadRequestException();
    const d = new Date(value);
    if (!Number.isFinite(d.getTime()) || d.toISOString() !== value)
      throw new BadRequestException();
    return d;
  };
  const from = date('from'),
    to = date('to'),
    store = values.get('storeId');
  if (
    to.getTime() <= from.getTime() ||
    to.getTime() - from.getTime() > 30 * 86400000 ||
    (store !== null &&
      (!/^[1-9]\d{0,9}$/.test(store) || Number(store) > 2147483647))
  )
    throw new BadRequestException();
  return { from, to, storeId: store === null ? null : Number(store) };
}
