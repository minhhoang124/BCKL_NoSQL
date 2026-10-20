import type { Prisma } from '@prisma/client';
import { orderCommandError } from './order-command-policy.js';

type Identity = {
  actorType: string;
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
  // Validate persisted identity independently of caller role; changing role
  // must not turn a valid Buyer/Seller fence into a 500 or bypass its key.
  assertResolutionIdentity(closed);
  if (
    closed.orderId !== input.orderId ||
    closed.command !== input.command ||
    closed.requestHash !== input.requestHash ||
    closed.actorType !== input.actorType
  )
    throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
  if (
    closed.actorId !== input.actorId ||
    closed.actorScope !== input.actorScope ||
    closed.hashVersion !== 1
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  throw orderCommandError(409, 'ORDER_COMMAND_CLOSED');
}

export function assertResolutionIdentity(closed: {
  id: number;
  orderId: number;
  actorId: number;
  actorScope: string;
  actorType: string;
  command: string;
  hashVersion: number;
  requestHash: string;
  idempotencyKey: string;
  resolvedAt: Date;
}): void {
  const validId = (v: number) =>
    Number.isInteger(v) && v > 0 && v <= 2147483647;
  const allowed =
    closed.actorType === 'SELLER'
      ? ['confirm', 'start-packing', 'ready-to-ship']
      : closed.actorType === 'BUYER'
        ? ['cancel', 'complete']
        : [];
  if (
    !validId(closed.id) ||
    !validId(closed.orderId) ||
    !validId(closed.actorId) ||
    closed.actorScope !== `USER:${closed.actorId}` ||
    !allowed.includes(closed.command) ||
    closed.hashVersion !== 1 ||
    !/^[0-9a-f]{64}$/.test(closed.requestHash) ||
    closed.requestHash.length !== 64 ||
    closed.idempotencyKey.length < 16 ||
    closed.idempotencyKey.length > 128 ||
    /[^A-Za-z0-9_-]/.test(closed.idempotencyKey) ||
    !Number.isFinite(closed.resolvedAt.getTime())
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
}
