import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { isTransactionConflict } from './transaction-conflict.js';

describe('transaction conflict classification', () => {
  it('recognizes Prisma P2034', () => {
    expect(
      isTransactionConflict(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code: 'P2034',
          clientVersion: '7',
        }),
      ),
    ).toBe(true);
  });
  it.each(['40001', '40P01'])(
    'recognizes adapter SQLSTATE %s',
    (originalCode) => {
      const error = new Error('conflict', {
        cause: { kind: 'TransactionWriteConflict', originalCode },
      });
      error.name = 'DriverAdapterError';
      expect(isTransactionConflict(error)).toBe(true);
    },
  );
  it.each([
    null,
    new Error('TransactionWriteConflict'),
    { code: '40001' },
    new Error('constraint', { cause: { originalCode: '23505' } }),
  ])('does not retry unrelated errors', (error) => {
    expect(isTransactionConflict(error)).toBe(false);
  });
});
