import { Prisma, Role } from '@prisma/client';
import { vi } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import { CheckoutReadService } from './checkout-read.service.js';

describe('Checkout read transaction boundary', () => {
  function fixture(actor: { isActive: boolean; role: Role } | null) {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      user: { findUnique: vi.fn().mockResolvedValue(actor) },
      checkout: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const transaction = vi.fn(async (read: (client: typeof tx) => unknown) =>
      read(tx),
    );
    const service = new CheckoutReadService({
      $transaction: transaction,
    } as unknown as PrismaService);
    return { tx, transaction, service };
  }
  it('uses a bounded read-only RepeatableRead snapshot and buyer-scoped lookup', async () => {
    const { tx, transaction, service } = fixture({
      isActive: true,
      role: Role.USER,
    });
    await expect(
      service.lookup(7, 'checkout_key_0123456789'),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_NOT_FOUND' },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 2000,
      timeout: 5000,
    });
    expect(tx.$executeRaw.mock.calls.map(([sql]) => sql.join(''))).toEqual([
      'SET TRANSACTION READ ONLY',
      "SET LOCAL statement_timeout = '2000ms'",
      "SET LOCAL lock_timeout = '1000ms'",
    ]);
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { isActive: true, role: true },
    });
    expect(tx.checkout.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          buyerId_idempotencyKey: {
            buyerId: 7,
            idempotencyKey: 'checkout_key_0123456789',
          },
        },
      }),
    );
  });
  it.each([null, { isActive: false, role: Role.USER }])(
    'rechecks missing/inactive actor inside the snapshot',
    async (actor) => {
      const { tx, service } = fixture(actor);
      await expect(
        service.lookup(7, 'checkout_key_0123456789'),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'UNAUTHORIZED' },
      });
      expect(tx.checkout.findUnique).not.toHaveBeenCalled();
    },
  );
  it.each([Role.SELLER, Role.ADMIN])(
    'rechecks role %s before private receipt access',
    async (role) => {
      const { tx, service } = fixture({ isActive: true, role });
      await expect(
        service.lookup(7, 'checkout_key_0123456789'),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'FORBIDDEN' },
      });
      expect(tx.checkout.findUnique).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid key and preview payload before opening a transaction', () => {
    const { transaction, service } = fixture({
      isActive: true,
      role: Role.USER,
    });
    expect(() => service.lookup(7, 'bad')).toThrow();
    expect(() =>
      service.preview(7, { addressId: 1, unexpected: true }),
    ).toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
