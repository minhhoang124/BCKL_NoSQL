import type { Prisma } from '@prisma/client';
import { orderCommandError } from './order-command-policy.js';

type Identity = {
  actorScope: string;
  actorId: number | null;
  orderId: number;
  command: string;
  idempotencyKey: string;
  requestHash: string;
  hashVersion: number;
};
/** After canonical auth/ownership and actor->Store->Order locks, BEFORE replay
 * or new-command policy. Also detects corrupt dual outcomes before replay. */
export async function assertOrderCommandNotClosed(
  tx: Prisma.TransactionClient,
  input: Identity,
  hasReceipt: boolean,
): Promise<void> {
  if (input.actorScope.startsWith('SYSTEM:')) return;
  const closed = await tx.orderCommandResolution.findUnique({
    where: {
      actorScope_idempotencyKey: {
        actorScope: input.actorScope,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (!closed) return;
  if (hasReceipt) throw orderCommandError(500, 'INTERNAL_ERROR');
  if (
    closed.orderId !== input.orderId ||
    closed.command !== input.command ||
    closed.requestHash !== input.requestHash
  )
    throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
  if (
    closed.actorType !== 'SELLER' ||
    closed.actorId !== input.actorId ||
    closed.actorScope !== input.actorScope ||
    closed.hashVersion !== 1
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  throw orderCommandError(409, 'ORDER_COMMAND_CLOSED');
}
