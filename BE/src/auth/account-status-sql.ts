import { Prisma } from '@prisma/client';
import { isTransactionConflict } from '../product/transaction-conflict.js';

/** Only structured aborted-transaction SQLSTATEs authorize a bounded retry. */
export function isAccountStatusConflict(error: unknown): boolean {
  if (isTransactionConflict(error)) return true;
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010'
  )
    return false;
  const adapter = error.meta?.driverAdapterError;
  const cause =
    adapter && typeof adapter === 'object' && 'cause' in adapter
      ? adapter.cause
      : null;
  const code =
    error.meta?.code ??
    (cause && typeof cause === 'object' && 'originalCode' in cause
      ? cause.originalCode
      : null);
  return code === '40001' || code === '40P01';
}
