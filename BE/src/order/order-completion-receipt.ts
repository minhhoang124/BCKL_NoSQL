import { orderCommandError } from './order-command-policy.js';
export interface CompletionResult {
  status: 'COMPLETED';
  deliveredAt: string;
  completedAt: string;
  payment: {
    provider: 'COD' | 'VNPAY' | 'MOMO';
    status: 'PAID';
    amount: string;
    currency: 'VND';
    paidAt: string;
  };
  timeline: {
    fromStatus: 'DELIVERED';
    toStatus: 'COMPLETED';
    actorType: 'BUYER' | 'SYSTEM';
    actorId: number | null;
    createdAt: string;
  }[];
}
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Reflect.ownKeys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  return v as Record<string, unknown>;
}
function iso(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v
  );
}
export function validateCompletionResult(
  v: unknown,
  actorId: number | null,
): CompletionResult {
  const r = object(v, [
    'status',
    'deliveredAt',
    'completedAt',
    'payment',
    'timeline',
  ]);
  const p = object(r.payment, [
    'provider',
    'status',
    'amount',
    'currency',
    'paidAt',
  ]);
  if (
    r.status !== 'COMPLETED' ||
    !iso(r.deliveredAt) ||
    !iso(r.completedAt) ||
    r.completedAt < r.deliveredAt ||
    typeof p.provider !== 'string' ||
    !['COD', 'VNPAY', 'MOMO'].includes(p.provider) ||
    p.status !== 'PAID' ||
    p.currency !== 'VND' ||
    !iso(p.paidAt) ||
    p.paidAt > r.completedAt ||
    typeof p.amount !== 'string' ||
    !/^(0|[1-9][0-9]{0,11})\.00$/.test(p.amount) ||
    !Array.isArray(r.timeline) ||
    r.timeline.length !== 1
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  const h = object(r.timeline[0], [
    'fromStatus',
    'toStatus',
    'actorType',
    'actorId',
    'createdAt',
  ]);
  if (
    h.fromStatus !== 'DELIVERED' ||
    h.toStatus !== 'COMPLETED' ||
    h.actorType !== (actorId === null ? 'SYSTEM' : 'BUYER') ||
    h.actorId !== actorId ||
    h.createdAt !== r.completedAt
  )
    throw orderCommandError(500, 'INTERNAL_ERROR');
  return v as CompletionResult;
}
