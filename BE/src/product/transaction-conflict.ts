import { Prisma } from '@prisma/client';
import { setTimeout } from 'node:timers/promises';

export function waitForTransactionRetry(attempt: number): Promise<void> {
  return setTimeout(25 * 2 ** attempt + Math.floor(Math.random() * 25));
}

/** Prisma 7's pg adapter can expose serialization failure at COMMIT directly. */
export function isTransactionConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return error.code === 'P2034';
  if (!(error instanceof Error) || error.name !== 'DriverAdapterError')
    return false;
  const cause = error.cause;
  if (!cause || typeof cause !== 'object') return false;
  const details = cause as Record<string, unknown>;
  return (
    details.kind === 'TransactionWriteConflict' &&
    (details.originalCode === '40001' || details.originalCode === '40P01')
  );
}
