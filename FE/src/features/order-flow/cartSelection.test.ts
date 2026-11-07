import { describe, expect, it } from 'vitest';
import { checkoutSelectionUrl, parseCartSelection } from './cartSelection';

describe('Cart → Checkout identity-only handoff', () => {
  it('roundtrips selected IDs in order and contains no price/quantity/address', () => {
    expect(checkoutSelectionUrl([10, 25])).toBe('/checkout?variantId=10&variantId=25');
    expect(parseCartSelection('?variantId=10&variantId=25').ids).toEqual([10, 25]);
    expect(parseCartSelection('').ids).toEqual([]);
  });
  it.each(['0', '-1', '01', '1.5', 'Infinity', '2147483648', '1e2', ''])('rejects invalid PostgreSQL Int identity %s', value => {
    expect(parseCartSelection(`?variantId=${value}`).error).not.toBe('');
  });
  it('allows 50 IDs but rejects 51 and duplicate IDs', () => {
    expect(checkoutSelectionUrl(Array.from({ length: 50 }, (_, i) => i + 1))).toContain('variantId=50');
    expect(() => checkoutSelectionUrl(Array.from({ length: 51 }, (_, i) => i + 1))).toThrow();
    expect(() => checkoutSelectionUrl([10, 10])).toThrow();
    expect(() => checkoutSelectionUrl([])).toThrow();
  });
});
