import { createHash } from 'node:crypto';
import { orderCommandError } from './order-command-policy.js';

export function completeInput(
  actorId: number | null,
  orderId: number,
  key: unknown,
  body: unknown,
) {
  if (
    !Number.isInteger(orderId) ||
    orderId < 1 ||
    orderId > 2147483647 ||
    (actorId !== null &&
      (!Number.isInteger(actorId) || actorId < 1 || actorId > 2147483647))
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  if (key === undefined || key === null)
    throw orderCommandError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  if (
    typeof key !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(key) ||
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(body)) ||
    Reflect.ownKeys(body).length
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  const actorScope =
    actorId === null ? 'SYSTEM:ORDER_AUTO_COMPLETE' : `USER:${actorId}`;
  const actorType = actorId === null ? ('SYSTEM' as const) : ('BUYER' as const);
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({ actorScope, body: {}, command: 'complete', orderId }),
      'utf8',
    )
    .digest('hex');
  return {
    actorId,
    actorType,
    actorScope,
    orderId,
    idempotencyKey: key,
    requestHash,
    hashVersion: 1 as const,
  };
}
export function autoCompleteKey(
  orderId: number,
  deliveredAt: Date,
  ruleVersion: number,
) {
  return (
    'D07-' +
    createHash('sha256')
      .update(
        JSON.stringify({
          deliveredAt: deliveredAt.toISOString(),
          orderId,
          ruleVersion,
        }),
      )
      .digest('hex')
  );
}
