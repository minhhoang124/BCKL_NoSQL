import { describe, expect, it } from 'vitest';
import {
  assertRequestWindow,
  dashboardRange,
  fullItemRefund,
  holdsItemBudget,
  moneyCents,
  moneyString,
  nextReturnState,
  orderFinancials,
  refundEffectiveAt,
  type FinancialSnapshot,
} from './aftersales-policy.js';

const now = new Date('2026-10-25T00:00:00.000Z');
const snapshot = (): FinancialSnapshot => ({
  subtotal: '100000.00',
  shippingFee: '20000.00',
  discountTotal: '0.00',
  total: '120000.00',
  payment: {
    amount: '120000.00',
    currency: 'VND',
    status: 'PAID',
    paidAt: new Date('2026-10-24T00:00:00.000Z'),
  },
  items: [
    { id: 1, unitPrice: '33333.33', quantity: 3, lineTotal: '99999.99' },
    { id: 2, unitPrice: '0.01', quantity: 1, lineTotal: '0.01' },
  ],
});

describe('shared aftersales financial rules', () => {
  it('preserves cents exactly and never refunds shipping', () => {
    expect(fullItemRefund(snapshot(), 1, now)).toBe('99999.99');
    expect(fullItemRefund(snapshot(), 2, now)).toBe('0.01');
    expect(orderFinancials(snapshot(), now).shipping).toBe(2000000n);
  });
  it('allows wide aggregates without float/int32 truncation and retains negative net', () => {
    const max = moneyCents('999999999999.99');
    expect(moneyString(max * 1000000n)).toBe('999999999999990000.00');
    expect(moneyString(0n - moneyCents('100000.00'))).toBe('-100000.00');
  });
  it.each([
    '1e5',
    '100',
    '01.00',
    '-1.00',
    'NaN',
    'Infinity',
    '1.001',
    '1000000000000.00',
    '1.00\n',
    ' 1.00',
    '+1.00',
  ])('rejects noncanonical money %j', (value) => {
    expect(() => moneyCents(value)).toThrow(
      'AFTERSALE_SNAPSHOT_REVIEW_REQUIRED',
    );
  });
  it.each([
    { discountTotal: '1.00' },
    { subtotal: '99999.99' },
    { total: '100000.00' },
    { payment: { ...snapshot().payment, amount: '100000.00' } },
    { payment: { ...snapshot().payment, status: 'UNPAID' } },
    { payment: { ...snapshot().payment, currency: 'USD' } },
    { payment: { ...snapshot().payment, paidAt: new Date(now.getTime() + 1) } },
    { items: [snapshot().items[0]!, snapshot().items[0]!] },
    { items: [{ ...snapshot().items[0]!, quantity: 0 }] },
    { items: [{ ...snapshot().items[0]!, quantity: 1.5 }] },
    { items: [] },
  ])(
    'rejects entire invalid snapshot rather than refunding a good-looking item',
    (delta) => {
      expect(() => fullItemRefund({ ...snapshot(), ...delta }, 1, now)).toThrow(
        'AFTERSALE_SNAPSHOT_REVIEW_REQUIRED',
      );
    },
  );
  it('does not manufacture a zero-value refund or refund another item', () => {
    expect(() => fullItemRefund(snapshot(), 3, now)).toThrow(
      'ORDER_ITEM_NOT_FOUND',
    );
    const zero = {
      ...snapshot(),
      subtotal: '0.00',
      total: '20000.00',
      payment: { ...snapshot().payment, amount: '20000.00' },
      items: [{ id: 1, unitPrice: '0.00', quantity: 1, lineTotal: '0.00' }],
    };
    expect(() => fullItemRefund(zero, 1, now)).toThrow(
      'AFTERSALE_SNAPSHOT_REVIEW_REQUIRED',
    );
  });
  it('keeps refund pending before gross, then applies at completion or later refund', () => {
    const refunded = new Date('2026-10-24T00:00:00Z');
    expect(refundEffectiveAt(refunded, null)).toBeNull();
    expect(refundEffectiveAt(refunded, now)).toEqual(now);
    const nextMonth = new Date('2026-11-01T00:00:00Z');
    expect(refundEffectiveAt(nextMonth, now)).toEqual(nextMonth);
    const result = refundEffectiveAt(nextMonth, now)!;
    result.setUTCFullYear(2030);
    expect(nextMonth.getUTCFullYear()).toBe(2026);
  });
  it('accepts exactly deadline, refuses +1ms and future delivery', () => {
    const delivered = new Date(now.getTime() - 7 * 86400000);
    expect(assertRequestWindow('COMPLETED', delivered, now, 7)).toEqual(now);
    expect(() =>
      assertRequestWindow(
        'DELIVERED',
        delivered,
        new Date(now.getTime() + 1),
        7,
      ),
    ).toThrow('AFTERSALE_WINDOW_EXPIRED');
    expect(() =>
      assertRequestWindow('DELIVERED', new Date(now.getTime() + 1), now, 7),
    ).toThrow('AFTERSALE_ORDER_NOT_ELIGIBLE');
    expect(() => assertRequestWindow('CANCELLED', delivered, now, 7)).toThrow(
      'AFTERSALE_ORDER_NOT_ELIGIBLE',
    );
  });
});

describe('aftersales state policy (not a database concurrency proof)', () => {
  it('releases rejected/cancelled budgets but reserves dispute/return pending', () => {
    expect(
      holdsItemBudget(
        nextReturnState('PENDING', 'REFUND_ONLY', 'SELLER', 'reject'),
      ),
    ).toBe(false);
    expect(
      holdsItemBudget(
        nextReturnState('PENDING', 'REFUND_ONLY', 'BUYER', 'cancel'),
      ),
    ).toBe(false);
    expect(
      holdsItemBudget(
        nextReturnState('REJECTED', 'REFUND_ONLY', 'BUYER', 'dispute'),
      ),
    ).toBe(true);
  });
  it('refunds only on approved refund-only or confirmed return', () => {
    expect(nextReturnState('PENDING', 'REFUND_ONLY', 'SELLER', 'approve')).toBe(
      'REFUNDED',
    );
    expect(
      nextReturnState('DISPUTED', 'RETURN_AND_REFUND', 'ADMIN', 'approve'),
    ).toBe('AWAITING_RETURN');
    expect(
      nextReturnState(
        'AWAITING_RETURN',
        'RETURN_AND_REFUND',
        'SELLER',
        'receive',
      ),
    ).toBe('REFUNDED');
  });
  it.each([
    ['REFUNDED', 'SELLER', 'receive'],
    ['ADMIN_REJECTED', 'BUYER', 'dispute'],
    ['PENDING', 'BUYER', 'approve'],
    ['DISPUTED', 'SELLER', 'approve'],
    ['PENDING', 'ADMIN', 'approve'],
    ['AWAITING_RETURN', 'BUYER', 'receive'],
  ] as const)('blocks invalid actor/state %s %s %s', (state, actor, action) => {
    expect(() =>
      nextReturnState(state, 'RETURN_AND_REFUND', actor, action),
    ).toThrow('AFTERSALE_INVALID_TRANSITION');
  });
});

describe('Dashboard local range', () => {
  it('maps day/month/quarter boundaries to UTC+7 half-open instants', () => {
    const range = dashboardRange('2026-10-01', '2026-11-01');
    expect(range.from.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(dashboardRange('2024-01-01', '2025-01-01').to.toISOString()).toBe(
      '2024-12-31T17:00:00.000Z',
    );
  });
  it.each([
    ['2026-02-29', '2026-03-01'],
    ['2026-10-25', '2026-10-25'],
    ['2026-11-01', '2026-10-01'],
    ['2026-01-01', '2028-01-01'],
    ['2026-1-01', '2026-02-01'],
    ['2026-01-01Z', '2026-02-01'],
  ])('rejects malformed/reversed/too-wide range', (from, to) => {
    expect(() => dashboardRange(from, to)).toThrow('DASHBOARD_INVALID_RANGE');
  });
});
