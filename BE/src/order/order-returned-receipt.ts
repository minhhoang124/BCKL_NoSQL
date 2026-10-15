import { orderCommandError } from './order-command-policy.js';
import type { ReturnedActor, ReturnedBody } from './order-returned-request.js';

export interface ReturnedResult {
  status: 'CANCELLED';
  payment: {
    provider: 'COD';
    status: 'CANCELLED';
    amount: string;
    currency: 'VND';
    paidAt: null;
  };
  cancellation: {
    cancelledBy: { type: ReturnedActor; id: number };
    reasonCode: string;
    reasonText: string;
    cancelledAt: string;
  };
  restockable: boolean;
  receiptReference: string | null;
  delivery: {
    deliveryAttempt: number;
    retryCount: number;
    trackingReference: string;
  };
  timeline: {
    fromStatus: 'DELIVERY_FAILED';
    toStatus: 'CANCELLED';
    actorType: ReturnedActor;
    actorId: number;
    reasonCode: string;
    reasonText: string;
    restockable: boolean;
    receiptReference: string | null;
    deliveryAttempt: number;
    trackingReference: string;
    createdAt: string;
  }[];
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  return value as Record<string, unknown>;
}
export function validateReturnedResult(
  value: unknown,
  actorId: number,
  actorType: ReturnedActor,
  body: ReturnedBody,
): ReturnedResult {
  const r = object(value, [
    'status',
    'payment',
    'cancellation',
    'restockable',
    'receiptReference',
    'delivery',
    'timeline',
  ]);
  const p = object(r.payment, [
    'provider',
    'status',
    'amount',
    'currency',
    'paidAt',
  ]);
  const c = object(r.cancellation, [
    'cancelledBy',
    'reasonCode',
    'reasonText',
    'cancelledAt',
  ]);
  const a = object(c.cancelledBy, ['type', 'id']);
  const d = object(r.delivery, [
    'deliveryAttempt',
    'retryCount',
    'trackingReference',
  ]);
  if (
    r.status !== 'CANCELLED' ||
    p.provider !== 'COD' ||
    p.status !== 'CANCELLED' ||
    p.currency !== 'VND' ||
    p.paidAt !== null ||
    typeof p.amount !== 'string' ||
    !/^(0|[1-9][0-9]{0,11})\.00$/.test(p.amount) ||
    a.type !== actorType ||
    a.id !== actorId ||
    c.reasonCode !== body.reasonCode ||
    c.reasonText !== body.reasonText ||
    r.restockable !== body.restockable ||
    r.receiptReference !== body.receiptReference ||
    typeof c.cancelledAt !== 'string' ||
    !Number.isFinite(Date.parse(c.cancelledAt)) ||
    new Date(c.cancelledAt).toISOString() !== c.cancelledAt ||
    typeof d.deliveryAttempt !== 'number' ||
    !Number.isInteger(d.deliveryAttempt) ||
    d.deliveryAttempt < 1 ||
    d.deliveryAttempt > 4 ||
    d.retryCount !== d.deliveryAttempt - 1 ||
    typeof d.trackingReference !== 'string' ||
    d.trackingReference.trim() !== d.trackingReference ||
    d.trackingReference.length < 1 ||
    d.trackingReference.length > 100 ||
    !Array.isArray(r.timeline) ||
    r.timeline.length !== 1
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  const h = object(r.timeline[0], [
    'fromStatus',
    'toStatus',
    'actorType',
    'actorId',
    'reasonCode',
    'reasonText',
    'restockable',
    'receiptReference',
    'deliveryAttempt',
    'trackingReference',
    'createdAt',
  ]);
  if (
    h.fromStatus !== 'DELIVERY_FAILED' ||
    h.toStatus !== 'CANCELLED' ||
    h.actorType !== actorType ||
    h.actorId !== actorId ||
    h.reasonCode !== body.reasonCode ||
    h.reasonText !== body.reasonText ||
    h.restockable !== body.restockable ||
    h.receiptReference !== body.receiptReference ||
    h.deliveryAttempt !== d.deliveryAttempt ||
    h.trackingReference !== d.trackingReference ||
    h.createdAt !== c.cancelledAt
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  return value as ReturnedResult;
}
