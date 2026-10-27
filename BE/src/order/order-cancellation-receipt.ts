import {
  orderCommandError,
  type OrderCommandActor,
} from './order-command-policy.js';

export interface CancellationResult {
  status: 'CANCELLED';
  payment: {
    provider: 'COD'|'VNPAY';
    status: 'CANCELLED';
    amount: string;
    currency: 'VND';
    paidAt: null;
  };
  cancellation: {
    cancelledBy: { type: OrderCommandActor; id: number };
    reasonCode: string;
    reasonText: string;
    cancelledAt: string;
  };
  timeline: {
    fromStatus: 'PENDING_CONFIRMATION' | 'CONFIRMED';
    toStatus: 'CANCELLED';
    actorType: OrderCommandActor;
    actorId: number;
    reasonCode: string;
    reasonText: string;
    createdAt: string;
  }[];
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  return value as Record<string, unknown>;
}
function iso(value: unknown) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
}
/** Validate persisted data before replay; never leak an untrusted JSON receipt. */
export function validateCancellationResult(
  value: unknown,
  actorId: number,
  actorType: OrderCommandActor,
  reason: { reasonCode: string; reasonText: string },
): CancellationResult {
  const result = object(value, [
    'status',
    'payment',
    'cancellation',
    'timeline',
  ]);
  const pay = object(result.payment, [
    'provider',
    'status',
    'amount',
    'currency',
    'paidAt',
  ]);
  const cancellation = object(result.cancellation, [
    'cancelledBy',
    'reasonCode',
    'reasonText',
    'cancelledAt',
  ]);
  const actor = object(cancellation.cancelledBy, ['type', 'id']);
  if (
    result.status !== 'CANCELLED' ||
    !['COD','VNPAY'].includes(String(pay.provider)) ||
    pay.status !== 'CANCELLED' ||
    pay.currency !== 'VND' ||
    pay.paidAt !== null ||
    typeof pay.amount !== 'string' ||
    !/^(0|[1-9][0-9]{0,11})\.00$/.test(pay.amount) ||
    actor.id !== actorId ||
    actor.type !== actorType ||
    cancellation.reasonCode !== reason.reasonCode ||
    cancellation.reasonText !== reason.reasonText
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  iso(cancellation.cancelledAt);
  if (!Array.isArray(result.timeline) || result.timeline.length !== 1)
    throw orderCommandError(500, 'INTERNAL_ERROR');
  const entry = object(result.timeline[0], [
    'fromStatus',
    'toStatus',
    'actorType',
    'actorId',
    'reasonCode',
    'reasonText',
    'createdAt',
  ]);
  if (
    !(
      entry.fromStatus === 'PENDING_CONFIRMATION' ||
      (actorType === 'SELLER' && entry.fromStatus === 'CONFIRMED')
    ) ||
    entry.toStatus !== 'CANCELLED' ||
    entry.actorType !== actorType ||
    entry.actorId !== actorId ||
    entry.reasonCode !== reason.reasonCode ||
    entry.reasonText !== reason.reasonText ||
    entry.createdAt !== cancellation.cancelledAt
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  iso(entry.createdAt);
  return value as CancellationResult;
}
