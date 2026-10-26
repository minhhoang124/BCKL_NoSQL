/** Shared financial/state rules. No HTTP, database, provider or side effects. */
export class AftersalesPolicyError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const reject = (code: string): never => {
  throw new AftersalesPolicyError(code);
};

/** Decimal(14,2) at the input boundary; aggregates use arbitrary precision. */
export function moneyCents(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})\.\d{2}$/.test(value))
    return reject('AFTERSALE_SNAPSHOT_REVIEW_REQUIRED');
  const [whole, fraction] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction!);
}
export function moneyString(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export type FinancialSnapshot = Readonly<{
  subtotal: string;
  shippingFee: string;
  discountTotal: string;
  total: string;
  payment: Readonly<{
    amount: string;
    currency: string;
    status: string;
    paidAt: Date | null;
  }>;
  items: readonly Readonly<{
    id: number;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
  }>[];
}>;

function instant(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return reject('AFTERSALE_INVALID_TIME');
  return value.getTime();
}

/** Validate the entire Order; never refund one apparently-good line in a bad sum. */
export function orderFinancials(snapshot: FinancialSnapshot, now: Date) {
  const clock = instant(now);
  const subtotal = moneyCents(snapshot.subtotal);
  const shipping = moneyCents(snapshot.shippingFee);
  const total = moneyCents(snapshot.total);
  if (
    moneyCents(snapshot.discountTotal) !== 0n ||
    total !== subtotal + shipping ||
    snapshot.payment.status !== 'PAID' ||
    snapshot.payment.currency !== 'VND' ||
    moneyCents(snapshot.payment.amount) !== total ||
    !snapshot.payment.paidAt ||
    instant(snapshot.payment.paidAt) > clock ||
    snapshot.items.length === 0
  )
    return reject('AFTERSALE_SNAPSHOT_REVIEW_REQUIRED');
  const amounts = new Map<number, bigint>();
  let sum = 0n;
  for (const item of snapshot.items) {
    if (
      !Number.isInteger(item.id) ||
      item.id < 1 ||
      item.id > 2147483647 ||
      amounts.has(item.id) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 2147483647
    )
      return reject('AFTERSALE_SNAPSHOT_REVIEW_REQUIRED');
    const amount = moneyCents(item.lineTotal);
    if (moneyCents(item.unitPrice) * BigInt(item.quantity) !== amount)
      return reject('AFTERSALE_SNAPSHOT_REVIEW_REQUIRED');
    amounts.set(item.id, amount);
    sum += amount;
  }
  if (sum !== subtotal) return reject('AFTERSALE_SNAPSHOT_REVIEW_REQUIRED');
  return { subtotal, shipping, total, amounts };
}

export function fullItemRefund(
  snapshot: FinancialSnapshot,
  itemId: number,
  now: Date,
): string {
  const amount = orderFinancials(snapshot, now).amounts.get(itemId);
  if (amount === undefined) return reject('ORDER_ITEM_NOT_FOUND');
  if (amount <= 0n) return reject('AFTERSALE_SNAPSHOT_REVIEW_REQUIRED');
  return moneyString(amount);
}

/** Returns a copied timestamp. NULL means refund exists but no gross exists yet. */
export function refundEffectiveAt(refundedAt: Date, completedAt: Date | null) {
  const refunded = instant(refundedAt);
  return completedAt === null
    ? null
    : new Date(Math.max(refunded, instant(completedAt)));
}

export function requestDeadline(deliveredAt: Date, windowDays: number): Date {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30)
    return reject('AFTERSALE_INVALID_POLICY');
  return new Date(instant(deliveredAt) + windowDays * 86400000);
}
export function assertRequestWindow(
  status: string,
  deliveredAt: Date | null,
  now: Date,
  windowDays: number,
): Date {
  const clock = instant(now);
  if (
    !['DELIVERED', 'COMPLETED'].includes(status) ||
    !deliveredAt ||
    instant(deliveredAt) > clock
  )
    return reject('AFTERSALE_ORDER_NOT_ELIGIBLE');
  const deadline = requestDeadline(deliveredAt, windowDays);
  if (clock > deadline.getTime()) return reject('AFTERSALE_WINDOW_EXPIRED');
  return deadline;
}

export type ReturnState =
  | 'PENDING'
  | 'REJECTED'
  | 'CANCELLED'
  | 'DISPUTED'
  | 'AWAITING_RETURN'
  | 'REFUNDED'
  | 'ADMIN_REJECTED';
export type ReturnKind = 'REFUND_ONLY' | 'RETURN_AND_REFUND';
export type DecisionActor = 'BUYER' | 'SELLER' | 'ADMIN';
export type ReturnAction =
  'cancel' | 'reject' | 'dispute' | 'approve' | 'receive';

export function holdsItemBudget(state: ReturnState): boolean {
  return ['PENDING', 'DISPUTED', 'AWAITING_RETURN'].includes(state);
}
/** Must run after canonical actor/ownership checks and OrderItem row lock. */
export function nextReturnState(
  state: ReturnState,
  kind: ReturnKind,
  actor: DecisionActor,
  action: ReturnAction,
): ReturnState {
  if (actor === 'BUYER' && action === 'cancel' && state === 'PENDING')
    return 'CANCELLED';
  if (actor === 'BUYER' && action === 'dispute' && state === 'REJECTED')
    return 'DISPUTED';
  const canDecide =
    (actor === 'SELLER' && state === 'PENDING') ||
    (actor === 'ADMIN' && state === 'DISPUTED');
  if (canDecide && action === 'reject')
    return actor === 'ADMIN' ? 'ADMIN_REJECTED' : 'REJECTED';
  if (canDecide && action === 'approve')
    return kind === 'REFUND_ONLY' ? 'REFUNDED' : 'AWAITING_RETURN';
  if (
    ['SELLER', 'ADMIN'].includes(actor) &&
    action === 'receive' &&
    state === 'AWAITING_RETURN' &&
    kind === 'RETURN_AND_REFUND'
  )
    return 'REFUNDED';
  return reject('AFTERSALE_INVALID_TRANSITION');
}

/** Gregorian local dates in the report-supported years; UTC+07 has no DST. */
export function dashboardRange(from: string, to: string) {
  const localMidnight = (date: string): number => {
    if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date))
      return reject('DASHBOARD_INVALID_RANGE');
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    if (
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== date
    )
      return reject('DASHBOARD_INVALID_RANGE');
    return parsed - 7 * 3600000;
  };
  const start = localMidnight(from),
    end = localMidnight(to);
  if (end <= start || end - start > 366 * 86400000)
    return reject('DASHBOARD_INVALID_RANGE');
  return {
    from: new Date(start),
    to: new Date(end),
    timezone: 'Asia/Ho_Chi_Minh' as const,
  };
}
