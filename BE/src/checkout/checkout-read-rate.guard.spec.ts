import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { CheckoutReadRateGuard } from './checkout-read-rate.guard.js';

describe('Checkout read rate guard', () => {
  const setHeader = vi.fn();
  function context(userId = 1, method = 'POST') {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, user: { userId } }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
  }
  const guard = (preview = '20', lookup = '20') =>
    new CheckoutReadRateGuard(
      new ConfigService({
        CHECKOUT_PREVIEW_RATE_PER_MINUTE: preview,
        CHECKOUT_LOOKUP_RATE_PER_MINUTE: lookup,
      }),
    );
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setHeader.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('defaults to 20 and rejects the 21st request', () => {
    const rate = new CheckoutReadRateGuard(new ConfigService());
    for (let i = 0; i < 20; i++) expect(rate.canActivate(context())).toBe(true);
    expect(() => rate.canActivate(context())).toThrow();
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });
  it('has separate configured buckets for preview, lookup and Buyers', () => {
    const rate = guard('1', '2');
    rate.canActivate(context());
    expect(() => rate.canActivate(context())).toThrow();
    rate.canActivate(context(1, 'GET'));
    rate.canActivate(context(1, 'GET'));
    expect(() => rate.canActivate(context(1, 'GET'))).toThrow();
    expect(rate.canActivate(context(2))).toBe(true);
  });
  it('does not extend the window on rejection; resets at the exact boundary', () => {
    const rate = guard('1');
    rate.canActivate(context());
    vi.advanceTimersByTime(59_001);
    expect(() => rate.canActivate(context())).toThrow();
    expect(setHeader).toHaveBeenLastCalledWith('Retry-After', '1');
    vi.advanceTimersByTime(999);
    expect(rate.canActivate(context())).toBe(true);
  });
  it('bounds memory without evicting live buckets or bypassing their limit', () => {
    const rate = guard('1');
    for (let id = 1; id <= 10_000; id++) rate.canActivate(context(id));
    expect(() => rate.canActivate(context(10_001))).toThrow();
    expect(() => rate.canActivate(context(1))).toThrow();
    vi.advanceTimersByTime(60_000);
    expect(rate.canActivate(context(10_001))).toBe(true);
  });
  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '', '9007199254740992'])(
    'fails startup for invalid configured limit %j',
    (value) => {
      expect(() => guard(value)).toThrow('CHECKOUT_PREVIEW_RATE_PER_MINUTE');
      expect(() => guard('20', value)).toThrow(
        'CHECKOUT_LOOKUP_RATE_PER_MINUTE',
      );
    },
  );
});
