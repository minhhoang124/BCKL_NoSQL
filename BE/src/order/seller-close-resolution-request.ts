import type { OrderCommand } from '@prisma/client';
import { orderCommandError } from './order-command-policy.js';
import { prepareOrderCommand } from './order-command-request.js';
import { prepareReturnedCommand } from './order-returned-request.js';
import { validateCancellationResult } from './order-cancellation-receipt.js';
import { validateReturnedResult } from './order-returned-receipt.js';

export function sellerCloseResolutionInput(
  actorId: number,
  orderId: number,
  key: unknown,
  body: unknown,
) {
  const identity = prepareOrderCommand({
    actorId,
    actorType: 'SELLER',
    orderId,
    command: 'cancel',
    idempotencyKey: key,
    body: { reasonCode: 'OTHER', reasonText: 'validation-only' },
  });
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(body)) ||
    Reflect.ownKeys(body).length !== 3 ||
    !['command', 'hashVersion', 'requestHash'].every((k) =>
      Object.hasOwn(body, k),
    )
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  const raw = body as Record<string, unknown>;
  if (
    (raw.command !== 'cancel' && raw.command !== 'confirm-returned') ||
    raw.hashVersion !== 1 ||
    typeof raw.requestHash !== 'string' ||
    raw.requestHash.length !== 64 ||
    /[^0-9a-f]/.test(raw.requestHash)
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  return {
    actorId: identity.actorId,
    actorType: 'SELLER' as const,
    actorScope: identity.actorScope,
    orderId: identity.orderId,
    idempotencyKey: identity.idempotencyKey,
    hashVersion: 1 as const,
    command: raw.command,
    requestHash: raw.requestHash,
  };
}
export type SellerCloseResolutionInput = ReturnType<
  typeof sellerCloseResolutionInput
>;

/** Rebuild only from the immutable original command snapshot, never live Order. */
export function replaySellerCloseReceipt(
  stored: OrderCommand,
  input: SellerCloseResolutionInput,
) {
  if (
    stored.actorId !== input.actorId ||
    stored.actorScope !== input.actorScope ||
    stored.hashVersion !== 1
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  if (
    stored.orderId !== input.orderId ||
    stored.command !== input.command ||
    stored.actorType !== 'SELLER' ||
    stored.requestHash !== input.requestHash ||
    stored.idempotencyKey !== input.idempotencyKey
  )
    throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
  if (stored.status === 'PROCESSING')
    throw orderCommandError(409, 'ORDER_COMMAND_IN_PROGRESS');
  if (
    stored.status !== 'SUCCEEDED' ||
    stored.responseStatus !== 200 ||
    !(stored.completedAt instanceof Date) ||
    !Number.isFinite(stored.completedAt.getTime()) ||
    !Number.isInteger(stored.id) ||
    stored.id < 1 ||
    stored.id > 2147483647
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  let result;
  try {
    const snapshot = stored.resultSnapshot as {
      cancellation?: { reasonCode?: unknown; reasonText?: unknown };
      restockable?: unknown;
      receiptReference?: unknown;
    } | null;
    if (input.command === 'cancel') {
      const original = prepareOrderCommand({
        actorId: input.actorId,
        actorType: 'SELLER',
        orderId: input.orderId,
        command: 'cancel',
        idempotencyKey: input.idempotencyKey,
        body: {
          reasonCode: snapshot?.cancellation?.reasonCode,
          reasonText: snapshot?.cancellation?.reasonText,
        },
      });
      if (
        original.command !== 'cancel' ||
        original.requestHash !== stored.requestHash
      )
        throw new Error('corrupt snapshot');
      result = validateCancellationResult(
        stored.resultSnapshot,
        input.actorId,
        'SELLER',
        original.body,
      );
    } else {
      const original = prepareReturnedCommand(
        input.actorId,
        'SELLER',
        input.orderId,
        input.idempotencyKey,
        {
          reasonCode: snapshot?.cancellation?.reasonCode,
          reasonText: snapshot?.cancellation?.reasonText,
          receiptReference: snapshot?.receiptReference,
          restockable: snapshot?.restockable,
        },
      );
      if (original.requestHash !== stored.requestHash)
        throw new Error('corrupt snapshot');
      result = validateReturnedResult(
        stored.resultSnapshot,
        input.actorId,
        'SELLER',
        original.body,
      );
    }
  } catch {
    throw orderCommandError(500, 'INTERNAL_ERROR');
  }
  return {
    orderId: input.orderId,
    commandId: stored.id,
    command: input.command,
    replayed: true as const,
    result,
  };
}
