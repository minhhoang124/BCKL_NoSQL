import {
  analyticsHash,
  parseAnalyticsEvent,
  parseAnalyticsRange,
} from './search-analytics-policy.js';
const token = 'a'.repeat(43),
  range = '?from=2026-10-01T00:00:00.000Z&to=2026-10-28T00:00:00.000Z';
describe('Search analytics strict event and report boundaries', () => {
  it('accepts the exact event projection and hashes without persisting clear capability', () => {
    expect(
      parseAnalyticsEvent({ token, productId: 1, event: 'CLICK' }),
    ).toEqual({ token, productId: 1, event: 'CLICK' });
    expect(analyticsHash(token)).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    null,
    [],
    {},
    { token, productId: '1', event: 'CLICK' },
    { token, productId: 0, event: 'CLICK' },
    { token, productId: 2147483648, event: 'CLICK' },
    { token, productId: 1.1, event: 'CLICK' },
    { token, productId: 1, event: ['CLICK'] },
    { token, productId: 1, event: 'BUY' },
    { token: 'bad', productId: 1, event: 'CLICK' },
    { token, productId: 1, event: 'CLICK', storeId: 2 },
  ])('rejects event coercion or extra authority %#', (v) => {
    expect(() => parseAnalyticsEvent(v)).toThrow();
  });
  it('accepts UTC exclusive range and admin-only Store selector', () => {
    expect(parseAnalyticsRange(range, 'SELLER').storeId).toBeNull();
    expect(parseAnalyticsRange(range + '&storeId=2', 'ADMIN').storeId).toBe(2);
  });
  it.each([
    '&storeId=2',
    '&from=2026-10-01T00:00:00.000Z',
    '&q=private',
    '&to[]=x',
  ])('rejects seller query extras or duplicates %s', (q) => {
    expect(() => parseAnalyticsRange(range + q, 'SELLER')).toThrow();
  });
  it.each([
    '?from=2026-02-30T00:00:00.000Z&to=2026-03-01T00:00:00.000Z',
    '?from=2026-01-01T00:00:00.000Z&to=2026-03-01T00:00:00.000Z',
    '?from=2026-10-28&to=2026-10-29',
    '?from=2026-10-28T00:00:00.000Z&to=2026-10-28T00:00:00.000Z',
  ])('rejects impossible/noncanonical/reversed/wide range', (url) => {
    expect(() => parseAnalyticsRange(url, 'ADMIN')).toThrow();
  });
  it('does not persist a joinable session hash across search capabilities', () => {
    const cookie = 'b'.repeat(43);
    expect(analyticsHash(token + ':' + cookie)).not.toBe(
      analyticsHash('c'.repeat(43) + ':' + cookie),
    );
  });
});
