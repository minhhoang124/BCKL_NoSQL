import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { vi } from 'vitest';
import { parseOrderListQuery } from './order-list.http.js';
import { OrderListRateGuard } from './order-list-rate.guard.js';

describe('Order list query', () => {
  it('defaults to 20 without changing the input', () => {
    const input = {};
    expect(parseOrderListQuery(input)).toEqual({ limit: 20 });
    expect(input).toEqual({});
  });
  it('accepts maximum bounds', () => {
    expect(parseOrderListQuery({ limit: '50', afterId: '2147483647' })).toEqual(
      { limit: 50, afterId: 2147483647 },
    );
  });
  it.each(Object.values(OrderStatus))(
    'accepts canonical status %s',
    (status) => {
      expect(parseOrderListQuery({ status }).status).toBe(status);
    },
  );
  it.each([
    null,
    [],
    'bad',
    { buyerId: '1' },
    { storeId: '1' },
    { offset: '1' },
    { limit: '0' },
    { limit: '51' },
    { limit: '01' },
    { limit: '1.0' },
    { limit: '1e1' },
    { limit: '' },
    { limit: 2 },
    { limit: ['1', '2'] },
    { afterId: '0' },
    { afterId: '-1' },
    { afterId: '2147483648' },
    { afterId: '9007199254740993' },
    { afterId: ' 1' },
    { afterId: {} },
    { status: '' },
    { status: 'pending_confirmation' },
    { status: 'ALL' },
    { status: ['CONFIRMED', 'CANCELLED'] },
    { status: null },
  ])('rejects invalid/extra/implicitly coerced query %#', (query) => {
    expect(() => parseOrderListQuery(query)).toThrow();
  });
});

describe('Order list per-instance limiter', () => {
  const context = (id: number, headers = new Map<string, string>()) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: id } }),
        getResponse: () => ({
          setHeader: (name: string, value: string) => headers.set(name, value),
        }),
      }),
    }) as unknown as ExecutionContext;
  afterEach(() => vi.restoreAllMocks());
  it('keeps users independent, emits Retry-After, and expires', () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const guard = new OrderListRateGuard(
      new ConfigService({ ORDER_LIST_RATE_PER_MINUTE: '1' }),
    );
    const headers = new Map<string, string>();
    expect(guard.canActivate(context(1, headers))).toBe(true);
    expect(() => guard.canActivate(context(1, headers))).toThrow();
    expect(headers.get('Retry-After')).toBe('60');
    expect(guard.canActivate(context(2))).toBe(true);
    time.mockReturnValue(61_000);
    expect(guard.canActivate(context(1))).toBe(true);
  });
  it('caps memory without evicting live buckets and resetting their quota', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const guard = new OrderListRateGuard(
      new ConfigService({ ORDER_LIST_RATE_PER_MINUTE: '1' }),
    );
    for (let id = 1; id <= 10_000; id++) guard.canActivate(context(id));
    expect(() => guard.canActivate(context(10_001))).toThrow();
    expect(() => guard.canActivate(context(1))).toThrow();
  });
  it.each(['0', '-1', '1.5', 'Infinity', 'NaN', '60001'])(
    'rejects config %s',
    (value) => {
      expect(
        () =>
          new OrderListRateGuard(
            new ConfigService({ ORDER_LIST_RATE_PER_MINUTE: value }),
          ),
      ).toThrow();
    },
  );
});
