import { describe, expect, it } from 'vitest';
import { formatCartMoney, parseCartMoney } from './cartMoney';

describe('Cart decimal money', () => {
  it('keeps large totals exact without floating point', () => {
    expect(parseCartMoney('9007199254740993.25')).toBe(900719925474099325n);
    expect(formatCartMoney(123456789n)).toBe('1.234.567,89 ₫');
  });

  it('rejects unexpected decimal shapes', () => {
    expect(parseCartMoney('1.234')).toBeNull();
    expect(parseCartMoney('1e3')).toBeNull();
  });
});
