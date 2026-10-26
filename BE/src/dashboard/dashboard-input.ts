import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { dashboardRange } from '../aftersales/aftersales-policy.js';
export type Bucket = 'day' | 'month' | 'quarter';
export type Range = ReturnType<typeof parseDashboardQuery>;
export function parseDashboardQuery(url: string, quality = false) {
  const values = new URL(url, 'http://localhost').searchParams,
    seen = new Set<string>();
  const allowed = quality
    ? ['from', 'to', 'limit', 'beforeId']
    : ['from', 'to', 'bucket'];
  for (const [key] of values) {
    if (!allowed.includes(key) || seen.has(key))
      throw new BadRequestException({ code: 'DASHBOARD_INVALID_QUERY' });
    seen.add(key);
  }
  const from = values.get('from') ?? '',
    to = values.get('to') ?? '';
  let range: ReturnType<typeof dashboardRange>;
  try {
    range = dashboardRange(from, to);
  } catch {
    throw new BadRequestException({ code: 'DASHBOARD_INVALID_RANGE' });
  }
  const bucket = values.get('bucket') ?? 'day';
  if (!['day', 'month', 'quarter'].includes(bucket))
    throw new BadRequestException({ code: 'DASHBOARD_INVALID_QUERY' });
  const number = (key: string, fallback?: number) => {
    const value = values.get(key);
    if (value === null) return fallback;
    const parsed = Number(value);
    if (
      !/^[1-9][0-9]*$/.test(value) ||
      !Number.isSafeInteger(parsed) ||
      parsed > (key === 'limit' ? 50 : 2147483647)
    )
      throw new BadRequestException({ code: 'DASHBOARD_INVALID_QUERY' });
    return parsed;
  };
  return {
    ...range,
    localFrom: from,
    localTo: to,
    bucket: bucket as Bucket,
    limit: quality ? number('limit', 20)! : 20,
    beforeId: quality ? number('beforeId') : undefined,
  };
}
export function countNumber(value: string | number | bigint): number {
  const text = String(value);
  if (
    !/^(0|[1-9][0-9]*)$/.test(text) ||
    BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ServiceUnavailableException({ code: 'DASHBOARD_COUNT_OVERFLOW' });
  return Number(text);
}
export function bucketWindows(range: Range) {
  const from = new Date(range.localFrom + 'T00:00:00Z'),
    to = new Date(range.localTo + 'T00:00:00Z');
  let cursor = new Date(from);
  if (range.bucket !== 'day') cursor.setUTCDate(1);
  if (range.bucket === 'quarter')
    cursor.setUTCMonth(Math.floor(cursor.getUTCMonth() / 3) * 3);
  const windows: {
    periodStart: string;
    from: string;
    to: string;
    partial: boolean;
  }[] = [];
  while (cursor < to) {
    const next = new Date(cursor);
    if (range.bucket === 'day') next.setUTCDate(next.getUTCDate() + 1);
    else
      next.setUTCMonth(next.getUTCMonth() + (range.bucket === 'month' ? 1 : 3));
    windows.push({
      periodStart: cursor.toISOString().slice(0, 10),
      from: new Date(Math.max(cursor.getTime(), from.getTime()))
        .toISOString()
        .slice(0, 10),
      to: new Date(Math.min(next.getTime(), to.getTime()))
        .toISOString()
        .slice(0, 10),
      partial: cursor < from || next > to,
    });
    cursor = next;
  }
  return windows;
}
