import { HttpException } from '@nestjs/common';
import { CheckoutStatus } from '@prisma/client';
import { resolveCheckoutReplay } from './checkout-replay.js';

const stored = () => ({
  id: 42,
  buyerId: 7,
  requestHash: 'a'.repeat(64),
  hashVersion: 1,
  status: CheckoutStatus.COMPLETED,
  completedAt: new Date('2026-10-08T00:00:00Z'),
  receiptVersion: 1,
  receiptJson: {
    checkoutId: 42,
    status: 'COMPLETED',
    orders: [
      {
        id: 101,
        orderNumber: 'ORD-test-101',
        storeId: 8,
        status: 'PENDING_CONFIRMATION',
        total: '1.00',
        payment: {
          provider: 'COD',
          status: 'UNPAID',
          amount: '1.00',
          currency: 'VND',
        },
      },
    ],
  },
});

function expectFailure(operation: () => unknown, status: number, code: string) {
  expect.assertions(3);
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect(exception.getResponse()).toMatchObject({ code });
  }
}

describe('Checkout replay classification (foundation, no HTTP/DB write)', () => {
  it('only returns null when no row exists; caller still needs transactional re-read', () => {
    expect(resolveCheckoutReplay(null, 7, 'a'.repeat(64))).toBeNull();
  });
  it('returns the same original receipt on POST replay and read-only lookup without live Cart/address/Order', () => {
    const row = stored();
    const before = structuredClone(row);
    const replay = resolveCheckoutReplay(row, 7, row.requestHash);
    expect(replay).toEqual({ ...row.receiptJson, replayed: true });
    expect(resolveCheckoutReplay(row, 7)).toEqual(replay);
    expect(row).toEqual(before);
  });
  it('hides another Buyer row before inspecting provenance or receipt', () => {
    expectFailure(
      () =>
        resolveCheckoutReplay(
          { ...stored(), hashVersion: null, receiptJson: null },
          8,
        ),
      404,
      'CHECKOUT_NOT_FOUND',
    );
  });
  it.each([null, 0, 3])(
    'rejects unknown hashVersion %s before comparing hashes',
    (hashVersion) => {
      expectFailure(
        () =>
          resolveCheckoutReplay({ ...stored(), hashVersion }, 7, 'different'),
        409,
        'CHECKOUT_LEGACY_REVIEW_REQUIRED',
      );
    },
  );
  it('reads online v2 only with matching v2 receipt/provider and keeps COD v1 strict',()=>{
    const v=stored();v.hashVersion=2;v.receiptVersion=2;v.receiptJson.orders[0]!.payment.provider='VNPAY';
    expect(resolveCheckoutReplay(v,7)?.orders[0]?.payment.provider).toBe('VNPAY');
    expect(()=>resolveCheckoutReplay({...v,hashVersion:1,receiptVersion:1},7)).toThrow();
  });
  it('rejects same key with a different canonical request', () => {
    expectFailure(
      () => resolveCheckoutReplay(stored(), 7, 'b'.repeat(64)),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
  });
  it('does not reset/recreate PENDING', () => {
    expectFailure(
      () =>
        resolveCheckoutReplay(
          { ...stored(), status: CheckoutStatus.PENDING },
          7,
        ),
      409,
      'CHECKOUT_IN_PROGRESS',
    );
  });
  it.each([
    { status: CheckoutStatus.FAILED },
    { completedAt: null },
    { completedAt: new Date('invalid') },
    { receiptVersion: null },
    { receiptVersion: 2 },
    { receiptJson: null },
    { receiptJson: { leakedSecret: 'never expose this value' } },
  ])('fails safely for corrupt new-version completion: %j', (change) => {
    expectFailure(
      () => resolveCheckoutReplay({ ...stored(), ...change }, 7),
      500,
      'INTERNAL_ERROR',
    );
  });
});
