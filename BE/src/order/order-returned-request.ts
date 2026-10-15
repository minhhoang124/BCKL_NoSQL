import { createHash } from 'node:crypto';
import { orderCommandError } from './order-command-policy.js';

export type ReturnedActor = 'SELLER' | 'ADMIN';
export type ReturnedBody = Readonly<{
  reasonCode: 'RETURN_RECEIVED' | 'DAMAGED' | 'LOST';
  reasonText: string;
  restockable: boolean;
  receiptReference: string | null;
}>;
export function prepareReturnedCommand(
  actorId: number,
  actorType: ReturnedActor,
  orderId: number,
  key: unknown,
  raw: unknown,
) {
  if (!['SELLER', 'ADMIN'].includes(actorType))
    throw orderCommandError(403, 'FORBIDDEN');
  if (
    ![actorId, orderId].every(
      (id) => Number.isInteger(id) && id > 0 && id <= 2147483647,
    )
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  if (key === undefined || key === null)
    throw orderCommandError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw orderCommandError(400, 'VALIDATION_ERROR');
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  const fields = Reflect.ownKeys(raw);
  const r = raw as Record<string, unknown>;
  if (
    fields.length !== 4 ||
    ['reasonCode', 'reasonText', 'restockable', 'receiptReference'].some(
      (k) => !fields.includes(k),
    ) ||
    typeof r.restockable !== 'boolean' ||
    typeof r.reasonText !== 'string'
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  const reasonText = r.reasonText.trim();
  if (reasonText.length < 1 || reasonText.length > 500)
    throw orderCommandError(400, 'VALIDATION_ERROR');
  const receipt =
    typeof r.receiptReference === 'string'
      ? r.receiptReference.trim()
      : r.receiptReference;
  if (r.reasonCode === 'LOST') {
    if (actorType !== 'ADMIN' || r.restockable || receipt !== null)
      throw orderCommandError(400, 'VALIDATION_ERROR');
  } else if (
    r.reasonCode !== (r.restockable ? 'RETURN_RECEIVED' : 'DAMAGED') ||
    typeof receipt !== 'string' ||
    receipt.length < 1 ||
    receipt.length > 100
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  // Sorted v1 body keys; meaningful false/null are retained in the hash.
  const body: ReturnedBody = Object.freeze({
    reasonCode: r.reasonCode as ReturnedBody['reasonCode'],
    reasonText,
    receiptReference: receipt as string | null,
    restockable: r.restockable,
  });
  const actorScope = `USER:${actorId}`;
  const command = 'confirm-returned' as const;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ actorScope, body, command, orderId }), 'utf8')
    .digest('hex');
  return Object.freeze({
    actorId,
    actorType,
    actorScope,
    orderId,
    command,
    body,
    idempotencyKey: key,
    requestHash,
    hashVersion: 1 as const,
  });
}
