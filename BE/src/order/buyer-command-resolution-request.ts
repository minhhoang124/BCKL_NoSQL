import type { OrderCommand } from '@prisma/client';
import { orderCommandError } from './order-command-policy.js';
import { prepareOrderCommand } from './order-command-request.js';
import { completeInput } from './order-completion-request.js';
import { validateCancellationResult } from './order-cancellation-receipt.js';
import { validateCompletionResult } from './order-completion-receipt.js';

export function buyerResolutionInput(
  actorId: number,
  orderId: number,
  key: unknown,
  body: unknown,
) {
  // Reuse established key/ID validation, including whole-string ASCII checks.
  const identity = prepareOrderCommand({
    actorId,
    actorType: 'BUYER',
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
    (raw.command !== 'cancel' && raw.command !== 'complete') ||
    raw.hashVersion !== 1 ||
    typeof raw.requestHash !== 'string' ||
    raw.requestHash.length !== 64 ||
    /[^0-9a-f]/.test(raw.requestHash)
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  return {
    actorId: identity.actorId,
    actorType: 'BUYER' as const,
    actorScope: identity.actorScope,
    orderId: identity.orderId,
    idempotencyKey: identity.idempotencyKey,
    hashVersion: 1 as const,
    command: raw.command,
    requestHash: raw.requestHash,
  };
}
export type BuyerResolutionInput = ReturnType<typeof buyerResolutionInput>;

export function assertCompleteFingerprint(
  input: BuyerResolutionInput,
  status: 400 | 500,
) {
  if (
    input.command === 'complete' &&
    input.requestHash !==
      completeInput(input.actorId, input.orderId, input.idempotencyKey, {})
        .requestHash
  )
    throw orderCommandError(
      status,
      status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
    );
}

/** Only immutable original snapshots are authoritative; never current Order. */
export function replayBuyerReceipt(
  stored: OrderCommand,
  input: BuyerResolutionInput,
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
    stored.actorType !== 'BUYER' ||
    stored.requestHash !== input.requestHash
  )
    throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
  assertCompleteFingerprint(input, 500);
  if (stored.status === 'PROCESSING')
    throw orderCommandError(409, 'ORDER_COMMAND_IN_PROGRESS');
  if (
    stored.status !== 'SUCCEEDED' ||
    stored.responseStatus !== 200 ||
    !stored.completedAt ||
    !Number.isFinite(stored.completedAt.getTime()) ||
    !Number.isInteger(stored.id) ||
    stored.id < 1
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  let result;
  if (input.command === 'complete') {
    result = validateCompletionResult(stored.resultSnapshot, input.actorId);
  } else {
    try {
      const snapshot = stored.resultSnapshot as {
        cancellation?: { reasonCode?: unknown; reasonText?: unknown };
      } | null;
      const prepared = prepareOrderCommand({
        actorId: input.actorId,
        actorType: 'BUYER',
        orderId: input.orderId,
        command: 'cancel',
        idempotencyKey: input.idempotencyKey,
        body: {
          reasonCode: snapshot?.cancellation?.reasonCode,
          reasonText: snapshot?.cancellation?.reasonText,
        },
      });
      if (
        prepared.command !== 'cancel' ||
        prepared.requestHash !== stored.requestHash
      )
        throw new Error('corrupt receipt');
      result = validateCancellationResult(
        stored.resultSnapshot,
        input.actorId,
        'BUYER',
        prepared.body,
      );
    } catch {
      throw orderCommandError(500, 'INTERNAL_ERROR');
    }
  }
  return {
    orderId: input.orderId,
    commandId: stored.id,
    command: input.command,
    replayed: true as const,
    result,
  };
}
