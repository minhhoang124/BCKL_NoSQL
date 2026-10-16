import { describe, expect, it } from 'vitest';
import { ApiError, AuthSessionChangedError } from '../../services/apiClient';
import {
  orderActions,
  orderMoney,
  orderReadError,
  type OrderActionContext,
} from './orderPolicy';
import { buyer, seller, detailFixture, createdAt } from './testFixtures';
import { ORDER_STATUSES } from '../../types/order';

const context: OrderActionContext = {
  scope: 'seller',
  user: seller,
  store: { id: 4, status: 'ACTIVE' },
  fresh: true,
  busy: false,
  outcomeUnknown: false,
};
describe('Order action availability, not Backend authorization', () => {
  it.each([
    ['PENDING_CONFIRMATION', 'confirm'],
    ['CONFIRMED', 'start-packing'],
    ['PACKING', 'ready-to-ship'],
  ] as const)('only offers %s -> %s preparation', (status, command) => {
    expect(
      orderActions({ ...detailFixture(), status }, context)
        .filter((a) => a.enabled)
        .map((a) => a.id),
    ).toEqual([command]);
  });
  it('allows active Seller to process old orders for a suspended Store', () => {
    expect(
      orderActions(detailFixture(), {
        ...context,
        store: { id: 4, status: 'SUSPENDED' },
      })[0].enabled,
    ).toBe(true);
  });
  it.each([
    { user: null },
    { user: buyer },
    { user: { ...seller, isActive: false } },
    { store: undefined },
    { store: { id: 5, status: 'ACTIVE' } },
    { store: { id: 4, status: 'REJECTED' } },
    { fresh: false },
    { busy: true },
    { outcomeUnknown: true },
  ])('blocks preparation for context %j', (overrides) => {
    expect(
      orderActions(detailFixture(), { ...context, ...overrides }).every(
        (a) => !a.enabled,
      ),
    ).toBe(true);
  });
  it.each([
    null,
    { ...detailFixture().payment!, status: 'PAID' as const, paidAt: createdAt },
    { ...detailFixture().payment!, amount: '1.00' },
    {
      ...detailFixture().payment!,
      provider: 'VNPAY' as const,
      status: 'PENDING' as const,
    },
  ])('blocks missing/ineligible payment %j', (payment) => {
    expect(
      orderActions({ ...detailFixture(), payment }, context)[0].enabled,
    ).toBe(false);
  });
  it('accepts an already-paid sandbox snapshot, not a simulated unpaid one', () => {
    const payment = {
      ...detailFixture().payment!,
      provider: 'MOMO' as const,
      status: 'PAID' as const,
      paidAt: createdAt,
    };
    expect(
      orderActions({ ...detailFixture(), payment }, context)[0].enabled,
    ).toBe(true);
  });
  it.each(ORDER_STATUSES)(
    'never makes Buyer or future commands executable in %s',
    (status) => {
      const order = { ...detailFixture(), status };
      expect(
        orderActions(order, { ...context, scope: 'buyer', user: buyer }).every(
          (a) => !a.enabled,
        ),
      ).toBe(true);
      expect(
        orderActions(order, context).some((a) => a.id === 'complete'),
      ).toBe(false);
      expect(
        orderActions(order, context)
          .filter((a) => ['cancel', 'confirm-returned'].includes(a.id))
          .every((a) => !a.enabled),
      ).toBe(true);
    },
  );
  it('formats whole VND strings without floating-point conversion', () => {
    expect(orderMoney('999999999999.00')).toBe('999.999.999.999 đ');
    expect(orderMoney('0.00')).toBe('0 đ');
    expect(orderMoney('12.12')).toBe('Chưa có số tiền hợp lệ');
  });
  it.each([401, 403, 404, 429, 500])(
    'never displays arbitrary server internals for %s',
    (status) => {
      expect(
        orderReadError(new ApiError('SELECT password FROM users', status)),
      ).not.toContain('SELECT');
    },
  );
  it('explains account changes and invalid contract responses', () => {
    expect(orderReadError(new AuthSessionChangedError())).toContain(
      'Phiên đăng nhập đã đổi',
    );
    expect(
      orderReadError(new ApiError('unsafe', 502, 'INVALID_ORDER_RESPONSE')),
    ).toContain('chưa hiển thị');
  });
});
