import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import {
  CheckoutCreateRate,
  checkoutConfigInt,
} from './checkout-create-rate.js';

describe('Checkout create limits (per-instance)', () => {
  afterEach(() => vi.useRealTimers());
  it('has independent ingress/intent buckets and independent users', () => {
    const rate = new CheckoutCreateRate(new ConfigService());
    for (let i = 0; i < 5; i++) rate.consume(1, 'intent');
    expect(() => rate.consume(1, 'intent')).toThrow();
    expect(() => rate.consume(2, 'intent')).not.toThrow();
    for (let i = 0; i < 60; i++) rate.consume(1, 'ingress');
    expect(() => rate.consume(1, 'ingress')).toThrow();
  });
  it('expired buckets reset but live buckets are not evicted', () => {
    vi.useFakeTimers();
    const rate = new CheckoutCreateRate(
      new ConfigService({ CHECKOUT_CREATE_INTENTS_PER_MINUTE: '1' }),
    );
    rate.consume(1, 'intent');
    vi.advanceTimersByTime(59000);
    try {
      rate.consume(1, 'intent');
      throw new Error('expected rate limit');
    } catch (error) {
      expect(error).toMatchObject({
        status: 429,
        response: { code: 'RATE_LIMITED', details: { retryAfter: 1 } },
      });
    }
    vi.advanceTimersByTime(1000);
    expect(() => rate.consume(1, 'intent')).not.toThrow();
  });
  it('bounds bucket storage without allowing new users to evict existing limits', () => {
    const rate = new CheckoutCreateRate(
      new ConfigService({ CHECKOUT_CREATE_INTENTS_PER_MINUTE: '1' }),
    );
    for (let id = 1; id <= 10000; id++) rate.consume(id, 'intent');
    expect(() => rate.consume(10001, 'intent')).toThrow();
    expect(() => rate.consume(1, 'intent')).toThrow();
  });
  it.each(['0', '-1', 'NaN', '1.5', 'Infinity', '60001'])(
    'rejects invalid configuration %s',
    (value) => {
      expect(() =>
        checkoutConfigInt(new ConfigService({ LIMIT: value }), 'LIMIT', 5),
      ).toThrow();
    },
  );
});
