import { orderCommandError } from './order-command-policy.js';

export type SellerPreparationCommand =
  'confirm' | 'start-packing' | 'ready-to-ship';
const transitions = {
  confirm: ['PENDING_CONFIRMATION', 'CONFIRMED'],
  'start-packing': ['CONFIRMED', 'PACKING'],
  'ready-to-ship': ['PACKING', 'READY_TO_SHIP'],
} as const;

export interface SellerCommandResult {
  status: string;
  payment: {
    provider: string;
    status: string;
    amount: string;
    currency: 'VND';
    paidAt: string | null;
  };
  cancellation: null;
  timeline: [
    {
      fromStatus: string;
      toStatus: string;
      actorType: 'SELLER';
      actorId: number;
      createdAt: string;
    },
  ];
}

function corrupt(): never {
  throw orderCommandError(500, 'INTERNAL_ERROR');
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    corrupt();
  return record;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value;
}

/** Strict v1 allowlist, copied rather than returning raw JSON from the DB. */
export function validateSellerCommandResult(
  input: unknown,
  command: SellerPreparationCommand,
  actorId: number,
): SellerCommandResult {
  const result = exact(input, [
    'status',
    'payment',
    'cancellation',
    'timeline',
  ]);
  const [from, to] = transitions[command];
  if (
    result.status !== to ||
    result.cancellation !== null ||
    !Array.isArray(result.timeline) ||
    result.timeline.length !== 1
  )
    corrupt();
  const payment = exact(result.payment, [
    'provider',
    'status',
    'amount',
    'currency',
    'paidAt',
  ]);
  if (
    payment.currency !== 'VND' ||
    typeof payment.provider !== 'string' ||
    typeof payment.amount !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,11})\.00$/.test(payment.amount)
  )
    corrupt();
  if (!(
    (payment.provider === 'COD' &&
      payment.status === 'UNPAID' &&
      payment.paidAt === null) ||
    (['VNPAY', 'MOMO'].includes(payment.provider) &&
      payment.status === 'PAID' &&
      timestamp(payment.paidAt))
  ))
    corrupt();
  const event = exact(result.timeline[0], [
    'fromStatus',
    'toStatus',
    'actorType',
    'actorId',
    'createdAt',
  ]);
  if (
    event.fromStatus !== from ||
    event.toStatus !== to ||
    event.actorType !== 'SELLER' ||
    event.actorId !== actorId ||
    !timestamp(event.createdAt)
  )
    corrupt();
  return {
    status: to,
    payment: {
      provider: payment.provider as string,
      status: payment.status as string,
      amount: payment.amount,
      currency: 'VND',
      paidAt: payment.paidAt as string | null,
    },
    cancellation: null,
    timeline: [
      {
        fromStatus: from,
        toStatus: to,
        actorType: 'SELLER',
        actorId,
        createdAt: event.createdAt,
      },
    ],
  };
}
