import { orderCommandError } from './order-command-policy.js';
import {
  deliveryTransitions,
  type DeliveryBody,
  type DeliveryCommand,
} from './order-delivery-request.js';

function corrupt(): never {
  throw orderCommandError(500, 'INTERNAL_ERROR');
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt();
  const r = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(r).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(r, k))
  )
    corrupt();
  return r;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** v1 immutable receipt: never return arbitrary stored JSON/PII to the caller. */
export function validateDeliveryResult(
  input: unknown,
  command: DeliveryCommand,
  actorId: number,
  body: DeliveryBody,
) {
  const r = exact(input, [
    'status',
    'delivery',
    'deliveredAt',
    'payment',
    'cancellation',
    'timeline',
  ]);
  const [from, to] = deliveryTransitions[command];
  if (
    r.status !== to ||
    r.cancellation !== null ||
    !Array.isArray(r.timeline) ||
    r.timeline.length !== 1
  )
    corrupt();
  const d = exact(r.delivery, [
    'deliveryAttempt',
    'retryCount',
    'trackingReference',
  ]);
  if (
    typeof d.deliveryAttempt !== 'number' ||
    !Number.isInteger(d.deliveryAttempt) ||
    d.deliveryAttempt < 1 ||
    d.deliveryAttempt > 4 ||
    d.retryCount !== d.deliveryAttempt - 1 ||
    d.trackingReference !== body.trackingReference ||
    (body.deliveryAttempt !== undefined &&
      d.deliveryAttempt !== body.deliveryAttempt) ||
    (command === 'ship' && d.deliveryAttempt !== 1) ||
    (command === 'retry-delivery' && d.deliveryAttempt < 2)
  )
    corrupt();
  const delivered = command === 'mark-delivered';
  if (delivered ? !timestamp(r.deliveredAt) : r.deliveredAt !== null) corrupt();
  const p = exact(r.payment, [
    'provider',
    'status',
    'amount',
    'currency',
    'paidAt',
  ]);
  if (
    typeof p.amount !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,11})\.00$/.test(p.amount) ||
    p.currency !== 'VND'
  )
    corrupt();
  if (!(
    (p.provider === 'COD' &&
      p.status === (delivered ? 'PAID' : 'UNPAID') &&
      (delivered
        ? timestamp(p.paidAt) && p.paidAt === r.deliveredAt
        : p.paidAt === null)) ||
    (typeof p.provider === 'string' &&
      ['VNPAY', 'MOMO'].includes(p.provider) &&
      p.status === 'PAID' &&
      timestamp(p.paidAt))
  ))
    corrupt();
  const t = exact(r.timeline[0], [
    'fromStatus',
    'toStatus',
    'actorType',
    'actorId',
    'createdAt',
    'deliveryAttempt',
    'trackingReference',
    'reasonCode',
    'reasonText',
  ]);
  if (
    t.fromStatus !== from ||
    t.toStatus !== to ||
    t.actorType !== 'ADMIN' ||
    t.actorId !== actorId ||
    !timestamp(t.createdAt) ||
    t.deliveryAttempt !== d.deliveryAttempt ||
    t.trackingReference !== d.trackingReference ||
    t.reasonCode !== (body.reasonCode ?? null) ||
    t.reasonText !== (body.reasonText ?? null)
  )
    corrupt();
  return {
    status: to,
    delivery: {
      deliveryAttempt: d.deliveryAttempt,
      retryCount: d.retryCount as number,
      trackingReference: body.trackingReference,
    },
    deliveredAt: r.deliveredAt as string | null,
    payment: {
      provider: p.provider as string,
      status: p.status as string,
      amount: p.amount,
      currency: 'VND' as const,
      paidAt: p.paidAt as string | null,
    },
    cancellation: null,
    timeline: [
      {
        fromStatus: from,
        toStatus: to,
        actorType: 'ADMIN' as const,
        actorId,
        createdAt: t.createdAt,
        deliveryAttempt: d.deliveryAttempt,
        trackingReference: body.trackingReference,
        reasonCode: body.reasonCode ?? null,
        reasonText: body.reasonText ?? null,
      },
    ],
  };
}
