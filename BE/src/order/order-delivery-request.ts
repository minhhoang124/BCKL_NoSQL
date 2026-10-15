import { createHash } from 'node:crypto';
import { OrderStatus } from '@prisma/client';
import { orderCommandError } from './order-command-policy.js';

export type DeliveryCommand =
  'ship' | 'delivery-failed' | 'retry-delivery' | 'mark-delivered';
export type DeliveryBody = Readonly<{
  trackingReference: string;
  deliveryAttempt?: number;
  reasonCode?:
    'CUSTOMER_UNREACHABLE' | 'ADDRESS_ISSUE' | 'CUSTOMER_REFUSED' | 'OTHER';
  reasonText?: string;
}>;
export const deliveryTransitions = {
  ship: [OrderStatus.READY_TO_SHIP, OrderStatus.SHIPPING],
  'delivery-failed': [OrderStatus.SHIPPING, OrderStatus.DELIVERY_FAILED],
  'retry-delivery': [OrderStatus.DELIVERY_FAILED, OrderStatus.SHIPPING],
  'mark-delivered': [OrderStatus.SHIPPING, OrderStatus.DELIVERED],
} as const;

export function prepareDeliveryCommand(
  actorId: number,
  orderId: number,
  command: DeliveryCommand,
  key: unknown,
  raw: unknown,
) {
  if (
    ![actorId, orderId].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 2147483647,
    ) ||
    !Object.hasOwn(deliveryTransitions, command)
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
  const fields =
    command === 'delivery-failed'
      ? ['deliveryAttempt', 'reasonCode', 'reasonText', 'trackingReference']
      : command === 'mark-delivered'
        ? ['deliveryAttempt', 'trackingReference']
        : ['trackingReference'];
  const record = raw as Record<string, unknown>;
  if (
    Reflect.ownKeys(raw).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(record, field))
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  if (typeof record.trackingReference !== 'string')
    throw orderCommandError(400, 'VALIDATION_ERROR');
  const trackingReference = record.trackingReference.trim();
  if (
    !trackingReference ||
    trackingReference.length > 100 ||
    Array.from(trackingReference).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  let body: DeliveryBody = { trackingReference };
  if (fields.includes('deliveryAttempt')) {
    const n = record.deliveryAttempt;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 4)
      throw orderCommandError(400, 'VALIDATION_ERROR');
    body = { deliveryAttempt: n, ...body };
  }
  if (command === 'delivery-failed') {
    if (
      typeof record.reasonCode !== 'string' ||
      ![
        'CUSTOMER_UNREACHABLE',
        'ADDRESS_ISSUE',
        'CUSTOMER_REFUSED',
        'OTHER',
      ].includes(record.reasonCode) ||
      typeof record.reasonText !== 'string'
    )
      throw orderCommandError(400, 'VALIDATION_ERROR');
    const reasonText = record.reasonText.trim();
    if (!reasonText || reasonText.length > 500)
      throw orderCommandError(400, 'VALIDATION_ERROR');
    body = {
      ...body,
      reasonCode: record.reasonCode as DeliveryBody['reasonCode'],
      reasonText,
    };
  }
  // Sort normalized DTO keys explicitly: canonical v1 must not depend on input order.
  body = Object.freeze(
    Object.fromEntries(
      Object.entries(body).sort(([a], [b]) => a.localeCompare(b)),
    ),
  ) as DeliveryBody;
  const actorScope = `USER:${actorId}`;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ actorScope, body, command, orderId }), 'utf8')
    .digest('hex');
  return Object.freeze({
    actorId,
    actorScope,
    orderId,
    command,
    idempotencyKey: key,
    requestHash,
    hashVersion: 1 as const,
    body,
  });
}

/** NEW command only: runtime must authorize and resolve durable replay first. */
export function deliveryDecision(
  command: DeliveryCommand,
  body: DeliveryBody,
  order: {
    status: OrderStatus;
    currentDeliveryAttempt: number | null;
    retryCount: number | null;
    currentAttempt: {
      deliveryAttempt: number;
      trackingReference: string;
    } | null;
  },
) {
  const first = command === 'ship';
  if (first) {
    if (
      order.currentDeliveryAttempt !== null ||
      order.retryCount !== null ||
      order.currentAttempt !== null
    )
      throw orderCommandError(409, 'DELIVERY_STATE_CONFLICT');
  } else {
    const n = order.currentDeliveryAttempt;
    if (
      n === null ||
      order.retryCount === null ||
      n < 1 ||
      n > 4 ||
      order.retryCount !== n - 1 ||
      order.currentAttempt?.deliveryAttempt !== n
    )
      throw orderCommandError(409, 'DELIVERY_STATE_CONFLICT');
    if (
      command !== 'retry-delivery' &&
      (body.deliveryAttempt !== n ||
        body.trackingReference !== order.currentAttempt.trackingReference)
    )
      throw orderCommandError(409, 'STALE_DELIVERY_ATTEMPT');
  }
  const [from, status] = deliveryTransitions[command];
  if (order.status !== from)
    throw orderCommandError(409, 'INVALID_ORDER_TRANSITION');
  if (command === 'retry-delivery' && order.currentDeliveryAttempt! >= 4)
    throw orderCommandError(409, 'DELIVERY_ATTEMPT_LIMIT');
  const deliveryAttempt = first
    ? 1
    : order.currentDeliveryAttempt! + (command === 'retry-delivery' ? 1 : 0);
  return {
    status,
    deliveryAttempt,
    retryCount: deliveryAttempt - 1,
    newAttempt: first || command === 'retry-delivery',
  };
}
