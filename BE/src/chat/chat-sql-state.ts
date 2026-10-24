import { Prisma } from '@prisma/client';

/** Structured adapter codes only; error text is not permission to replay work. */
export function chatSqlState(error: unknown): string {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010'
  )
    return '';
  const adapter = error.meta?.driverAdapterError;
  const cause =
    adapter && typeof adapter === 'object' && 'cause' in adapter
      ? adapter.cause
      : null;
  return String(
    error.meta?.code ??
      (cause && typeof cause === 'object' && 'originalCode' in cause
        ? cause.originalCode
        : ''),
  );
}
