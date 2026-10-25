import { Prisma } from '@prisma/client';
import { expect, it } from 'vitest';
import { isAccountStatusConflict } from './account-status-sql.js';
it.each(['40001', '40P01'])(
  'retries structured raw SQL conflict %s',
  (code) => {
    expect(
      isAccountStatusConflict(
        new Prisma.PrismaClientKnownRequestError('QA', {
          code: 'P2010',
          clientVersion: '7',
          meta: { code },
        }),
      ),
    ).toBe(true);
    expect(
      isAccountStatusConflict(
        new Prisma.PrismaClientKnownRequestError('QA', {
          code: 'P2010',
          clientVersion: '7',
          meta: { driverAdapterError: { cause: { originalCode: code } } },
        }),
      ),
    ).toBe(true);
  },
);
it.each(['23514', '23505', '55P03', '57014', '08006'])(
  'does not replay non-serialization failure %s',
  (code) =>
    expect(
      isAccountStatusConflict(
        new Prisma.PrismaClientKnownRequestError('QA', {
          code: 'P2010',
          clientVersion: '7',
          meta: { code },
        }),
      ),
    ).toBe(false),
);
it('does not trust error text as evidence of rollback', () =>
  expect(isAccountStatusConflict(new Error('40001 serialization'))).toBe(
    false,
  ));
