import { BIGINT_MAX } from './cart-redis-protocol.js';
import { bumpTarget, planImport } from './redis-cart-admin.js';

describe('redis-cart-admin planning', () => {
  it('R8b: target is above sequence, every fence and every _hw; never lowers', () => {
    expect(bumpTarget({ lastValue: '900', fenceMax: '1000', hwMax: '0' })).toBe('1001');
    expect(bumpTarget({ lastValue: '900', fenceMax: '0', hwMax: '1200' })).toBe('1201');
    expect(bumpTarget({ lastValue: '5000', fenceMax: '1000', hwMax: '1200' })).toBe('5001');
    const p53 = (2n ** 53n).toString();
    expect(bumpTarget({ lastValue: '1', fenceMax: p53, hwMax: '0' })).toBe(
      (2n ** 53n + 1n).toString(),
    );
  });

  it('R17: reports bigint exhaustion clearly instead of overflowing', () => {
    expect(() =>
      bumpTarget({ lastValue: BIGINT_MAX, fenceMax: '0', hwMax: '0' }),
    ).toThrow(/cannot be advanced.*bigint max/);
    expect(bumpTarget({ lastValue: '9223372036854775806', fenceMax: '0', hwMax: '0' })).toBe(
      BIGINT_MAX,
    );
    expect(() => bumpTarget({ lastValue: '-1', fenceMax: '0', hwMax: '0' })).toThrow(
      /Invalid bigint/,
    );
  });

  it('R16: keeps unavailable lines, skips invalid/consumed ones (ties skip), keeps order', () => {
    const t = new Date('2026-11-07T10:00:00Z');
    const later = new Date('2026-11-07T11:00:00Z');
    const plan = planImport(
      [
        { id: 5, variantId: 50, quantity: 2, updatedAt: t, variantExists: true },
        { id: 1, variantId: 10, quantity: 1, updatedAt: t, variantExists: true }, // out of stock in catalog: kept
        { id: 2, variantId: 20, quantity: 0, updatedAt: t, variantExists: true },
        { id: 3, variantId: 30, quantity: 100, updatedAt: t, variantExists: true },
        { id: 4, variantId: 40, quantity: 1, updatedAt: t, variantExists: false },
        { id: 6, variantId: 60, quantity: 1, updatedAt: t, variantExists: true }, // fence tie
        { id: 7, variantId: 70, quantity: 1, updatedAt: later, variantExists: true }, // updated after fence
      ],
      new Map([
        [60, t],
        [70, t],
      ]),
      99,
    );
    expect(plan.lines).toEqual([
      { variantId: 10, quantity: 1 },
      { variantId: 50, quantity: 2 },
      { variantId: 70, quantity: 1 },
    ]);
    expect(plan.skipped).toEqual([
      { variantId: 20, reason: 'QUANTITY_OUT_OF_RANGE' },
      { variantId: 30, reason: 'QUANTITY_OUT_OF_RANGE' },
      { variantId: 40, reason: 'VARIANT_MISSING' },
      { variantId: 60, reason: 'CONSUMED_AFTER_UPDATE' },
    ]);
  });

  it('respects a lower CART_MAX_QUANTITY', () => {
    const t = new Date();
    expect(
      planImport([{ id: 1, variantId: 1, quantity: 6, updatedAt: t, variantExists: true }], new Map(), 5)
        .skipped,
    ).toEqual([{ variantId: 1, reason: 'QUANTITY_OUT_OF_RANGE' }]);
  });
});
