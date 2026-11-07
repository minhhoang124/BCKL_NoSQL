import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SellerOrderCommandService } from './seller-order-command.service.js';
import {
  sellerOrderId,
  assertSellerCommandQuery,
} from './seller-order-command.http.js';
import { validateSellerCommandResult } from './seller-order-command-receipt.js';
import type { PrismaService } from '../prisma.service.js';

const receipt = () => ({
  status: 'CONFIRMED',
  payment: {
    provider: 'COD',
    status: 'UNPAID',
    amount: '10000.00',
    currency: 'VND',
    paidAt: null,
  },
  cancellation: null,
  timeline: [
    {
      fromStatus: 'PENDING_CONFIRMATION',
      toStatus: 'CONFIRMED',
      actorType: 'SELLER',
      actorId: 8,
      createdAt: '2026-10-10T07:00:00.000Z',
    },
  ],
});
describe('Seller command strict receipt and HTTP helpers', () => {
  it('returns a copy of the supported receipt', () => {
    const value = receipt();
    const copy = validateSellerCommandResult(value, 'confirm', 8);
    expect(copy).toEqual(value);
    expect(copy.payment).not.toBe(value.payment);
  });
  it.each([
    (x: ReturnType<typeof receipt>) => ({ ...x, hash: 'secret' }),
    (x: ReturnType<typeof receipt>) => ({ ...x, status: 'PACKING' }),
    (x: ReturnType<typeof receipt>) => ({ ...x, cancellation: {} }),
    (x: ReturnType<typeof receipt>) => ({ ...x, timeline: [] }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      timeline: [x.timeline[0], x.timeline[0]],
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      payment: { ...x.payment, amount: 10000 },
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      payment: { ...x.payment, amount: '1.01' },
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      payment: { ...x.payment, amount: '1000000000000.00' },
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      payment: { ...x.payment, currency: 'USD' },
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      payment: {
        ...x.payment,
        provider: ['VNPAY'],
        status: 'PAID',
        paidAt: '2026-10-10T06:00:00.000Z',
      },
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      payment: { ...x.payment, status: 'PAID' },
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      payment: { ...x.payment, key: 'secret' },
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      timeline: [{ ...x.timeline[0], actorId: 9 }],
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      timeline: [{ ...x.timeline[0], actorType: 'ADMIN' }],
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      timeline: [{ ...x.timeline[0], fromStatus: 'PACKING' }],
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      timeline: [{ ...x.timeline[0], createdAt: 'not-a-date' }],
    }),
    (x: ReturnType<typeof receipt>) => ({
      ...x,
      timeline: [{ ...x.timeline[0], requestHash: 'secret' }],
    }),
  ])(
    'rejects corrupt or privacy-violating JSON #%# with a safe 500',
    (mutate) => {
      try {
        validateSellerCommandResult(mutate(receipt()), 'confirm', 8);
        throw new Error('accepted corrupt receipt');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(500);
      }
    },
  );
  it.each(['VNPAY', 'MOMO'])(
    'accepts a paid sandbox %s receipt without claiming provider integration',
    (provider) => {
      const value = receipt();
      const payment = {
        ...value.payment,
        provider,
        status: 'PAID',
        paidAt: '2026-10-10T06:00:00.000Z',
      };
      expect(
        validateSellerCommandResult({ ...value, payment }, 'confirm', 8)
          .payment,
      ).toEqual(payment);
    },
  );
  it.each(['0', '-1', '01', '1e2', '1.0', '2147483648', 'x', '', ' 1'])(
    'rejects ID %s',
    (id) => expect(() => sellerOrderId(id)).toThrow(),
  );
  it('supports both PostgreSQL ID boundaries and only empty queries', () => {
    expect(sellerOrderId('1')).toBe(1);
    expect(sellerOrderId('2147483647')).toBe(2147483647);
    assertSellerCommandQuery({});
    expect(() => assertSellerCommandQuery({ storeId: '8' })).toThrow();
  });
  it.each([
    { ORDER_COMMAND_LOCK_TIMEOUT_MS: '3000' },
    { ORDER_COMMAND_TRANSACTION_TIMEOUT_MS: '1000' },
    { ORDER_COMMAND_RATE_PER_MINUTE: '0', ORDER_COMMAND_DEADLINE_MS: '0' },
    { ORDER_COMMAND_DEADLINE_MS: '1000' },
  ])('rejects unsafe transaction budget %#', (config) =>
    expect(
      () =>
        new SellerOrderCommandService(
          {} as PrismaService,
          new ConfigService(config),
        ),
    ).toThrow(),
  );
});
