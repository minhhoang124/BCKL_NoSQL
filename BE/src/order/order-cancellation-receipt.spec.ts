import { describe, expect, it } from 'vitest';
import { validateCancellationResult } from './order-cancellation-receipt.js';

const reason = { reasonCode: 'CHANGED_MIND', reasonText: 'Không cần nữa' };
function fixture() {
  return {
    status: 'CANCELLED',
    payment: {
      provider: 'COD',
      status: 'CANCELLED',
      amount: '10000.00',
      currency: 'VND',
      paidAt: null,
    },
    cancellation: {
      cancelledBy: { type: 'BUYER', id: 1 },
      ...reason,
      cancelledAt: '2026-10-10T00:00:00.000Z',
    },
    timeline: [
      {
        fromStatus: 'PENDING_CONFIRMATION',
        toStatus: 'CANCELLED',
        actorType: 'BUYER',
        actorId: 1,
        ...reason,
        createdAt: '2026-10-10T00:00:00.000Z',
      },
    ],
  };
}
describe('Cancellation persisted receipt allowlist', () => {
  it('returns the original receipt without reformatting', () => {
    const value = fixture();
    expect(validateCancellationResult(value, 1, 'BUYER', reason)).toBe(value);
  });
  it.each([
    (value: any) => {
      value.secret = 'hidden';
    },
    (value: any) => {
      value.payment.password = 'hidden';
    },
    (value: any) => {
      value.payment.amount = 10000;
    },
    (value: any) => {
      value.payment.amount = '1e4';
    },
    (value: any) => {
      value.payment.amount = '10000.01';
    },
    (value: any) => {
      value.payment.amount = '1000000000000.00';
    },
    (value: any) => {
      value.payment.provider = 'MOMO';
    },
    (value: any) => {
      value.payment.paidAt = '2026-10-10';
    },
    (value: any) => {
      value.cancellation.cancelledBy.id = 2;
    },
    (value: any) => {
      value.cancellation.reasonCode = 'OTHER';
    },
    (value: any) => {
      value.cancellation.cancelledAt = 'invalid';
    },
    (value: any) => {
      value.timeline[0].createdAt = '2026-10-11T00:00:00.000Z';
    },
    (value: any) => {
      value.timeline[0].fromStatus = 'CONFIRMED';
    },
    (value: any) => {
      value.timeline.push(value.timeline[0]);
    },
  ])('rejects corrupted/extra/sensitive fields %#', (mutate) => {
    const value = fixture();
    mutate(value);
    expect(() =>
      validateCancellationResult(value, 1, 'BUYER', reason),
    ).toThrow();
  });
  it('allows Seller CONFIRMED cancellation', () => {
    const value = fixture();
    value.cancellation.cancelledBy.type = 'SELLER';
    value.timeline[0]!.actorType = 'SELLER';
    value.timeline[0]!.fromStatus = 'CONFIRMED';
    expect(validateCancellationResult(value, 1, 'SELLER', reason)).toBe(value);
  });
});
