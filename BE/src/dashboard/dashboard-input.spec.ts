import { describe, expect, it } from 'vitest';
import {
  bucketWindows,
  countNumber,
  parseDashboardQuery,
} from './dashboard-input.js';
describe('Dashboard exact query and calendar boundaries', () => {
  const base = '/admin/dashboard?from=2026-01-01&to=2026-02-01';
  it.each([
    '',
    '?from=2026-01-01',
    '?from=2026-02-30&to=2026-03-01',
    '?from=2026-01-01&to=2026-01-01',
    '?from=2026-01-01&to=2028-01-01',
    '?from=1900-01-01&to=1900-02-01',
  ])('rejects missing/invalid ranges %s', (value) => {
    expect(() => parseDashboardQuery('/admin/dashboard' + value)).toThrow();
  });
  it.each([
    '&from=2026-01-02',
    '&from[]=2026-01-01',
    '&storeId=5',
    '&bucket=year',
    '&bucket=day&bucket=month',
    '&bucket=day%27%3BDROP%20TABLE%20orders%3B--',
    '&limit=20',
  ])('rejects unknown/duplicate/array/injection input %s', (value) => {
    expect(() => parseDashboardQuery(base + value)).toThrow();
  });
  it('uses the already-shared UTC+7 half-open range', () => {
    const range = parseDashboardQuery(base);
    expect(range.from.toISOString()).toBe('2025-12-31T17:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-01-31T17:00:00.000Z');
    expect(bucketWindows(range)).toHaveLength(31);
  });
  it('fills leap days and clips partial month/quarter buckets', () => {
    expect(
      bucketWindows(parseDashboardQuery('/?from=2024-02-28&to=2024-03-01')).map(
        (w) => w.periodStart,
      ),
    ).toEqual(['2024-02-28', '2024-02-29']);
    expect(
      bucketWindows(
        parseDashboardQuery('/?from=2026-02-15&to=2026-04-02&bucket=quarter'),
      ),
    ).toEqual([
      {
        periodStart: '2026-01-01',
        from: '2026-02-15',
        to: '2026-04-01',
        partial: true,
      },
      {
        periodStart: '2026-04-01',
        from: '2026-04-01',
        to: '2026-04-02',
        partial: true,
      },
    ]);
    expect(
      bucketWindows(
        parseDashboardQuery('/?from=2026-02-15&to=2026-03-01&bucket=month'),
      ),
    ).toEqual([
      {
        periodStart: '2026-02-01',
        from: '2026-02-15',
        to: '2026-03-01',
        partial: true,
      },
    ]);
  });
  it('quality cursor is bounded and exclusive, never a client Store filter', () => {
    expect(
      parseDashboardQuery(base + '&limit=50&beforeId=2147483647', true),
    ).toMatchObject({ limit: 50, beforeId: 2147483647 });
    for (const bad of [
      '&limit=51',
      '&beforeId=01',
      '&beforeId=2147483648',
      '&bucket=month',
    ])
      expect(() => parseDashboardQuery(base + bad, true)).toThrow();
  });
  it('never rounds bigint counts silently', () => {
    expect(countNumber('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    for (const bad of ['9007199254740992', '-1', '1.5', '1e3'])
      expect(() => countNumber(bad)).toThrow();
  });
});
