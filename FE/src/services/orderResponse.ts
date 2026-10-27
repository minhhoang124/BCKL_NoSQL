import { ApiError } from './apiClient';
import {
  ORDER_STATUSES,
  type OrderList,
  type OrderDetail,
  type OrderPayment,
  type SellerCommandReceipt,
  type PreparationCommand,
} from '../types/order';

function invalid(): never {
  throw new ApiError(
    'Dữ liệu đơn hàng không đúng hợp đồng API. Vui lòng tải lại.',
    502,
    'INVALID_ORDER_RESPONSE',
  );
}
export function validOrderId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 2147483647
  );
}
export function validOrderMoney(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,11})\.00$/.test(value);
}
function date(value: unknown) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function text(value: unknown) {
  return typeof value === 'string';
}
function nullable(value: unknown, validate: (v: unknown) => boolean) {
  return value === null || validate(value);
}
function status(value: unknown) {
  return (
    typeof value === 'string' &&
    ORDER_STATUSES.includes(value as (typeof ORDER_STATUSES)[number])
  );
}
function actor(value: unknown) {
  return (
    value === null ||
    (typeof value === 'string' &&
      ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'].includes(value))
  );
}
function exact(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(result).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(result, field))
  )
    invalid();
  return result;
}
export function validateOrderPayment(value: unknown): OrderPayment {
  const p = exact(value, [
    'provider',
    'status',
    'amount',
    'currency',
    'paidAt',
  ]);
  if (
    typeof p.provider !== 'string' ||
    !['COD', 'VNPAY', 'MOMO'].includes(p.provider) ||
    typeof p.status !== 'string' ||
    ![
      'UNPAID',
      'PENDING',
      'PAID',
      'FAILED',
      'CANCELLED',
      'EXPIRED',
      'REFUND_PENDING',
      'REFUNDED',
      'REVIEW_REQUIRED',
    ].includes(p.status) ||
    !validOrderMoney(p.amount) ||
    p.currency !== 'VND' ||
    !nullable(p.paidAt, date)
  )
    invalid();
  return p as unknown as OrderPayment;
}
const summaryFields = [
  'id',
  'orderNumber',
  'status',
  'store',
  'total',
  'payment',
  'createdAt',
  'updatedAt',
] as const;
function summary(row: Record<string, unknown>) {
  if (
    !validOrderId(row.id) ||
    !text(row.orderNumber) ||
    !status(row.status) ||
    !validOrderMoney(row.total) ||
    !date(row.createdAt) ||
    !date(row.updatedAt)
  )
    invalid();
  const store = exact(row.store, ['id', 'name']);
  if (!validOrderId(store.id) || !text(store.name)) invalid();
  if (row.payment !== null) validateOrderPayment(row.payment);
}
export function validateOrderList(value: unknown): OrderList {
  const data = exact(value, ['items', 'nextCursor']);
  if (
    !Array.isArray(data.items) ||
    data.items.length > 50 ||
    !nullable(data.nextCursor, validOrderId)
  )
    invalid();
  let previous = 2147483648;
  for (const item of data.items) {
    const row = exact(item, summaryFields);
    summary(row);
    if ((row.id as number) >= previous) invalid();
    previous = row.id as number;
  }
  if (
    data.nextCursor !== null &&
    (!data.items.length || data.nextCursor !== previous)
  )
    invalid();
  return data as unknown as OrderList;
}
export function validateOrderDetail(
  value: unknown,
  expectedId: number,
): OrderDetail {
  const d = exact(value, [
    ...summaryFields,
    'shippingAddress',
    'items',
    'subtotal',
    'shippingFee',
    'discountTotal',
    'cancellation',
    'timeline',
  ]);
  summary(d);
  if (
    d.id !== expectedId ||
    ![d.subtotal, d.shippingFee, d.discountTotal].every(validOrderMoney)
  )
    invalid();
  const a = exact(d.shippingAddress, [
    'recipientName',
    'phone',
    'province',
    'district',
    'ward',
    'addressLine',
    'postalCode',
    'deliveryNote',
  ]);
  if (
    !['recipientName', 'phone', 'province', 'ward', 'addressLine'].every(
      (key) => text(a[key]),
    ) ||
    !['district', 'postalCode', 'deliveryNote'].every((key) =>
      nullable(a[key], text),
    )
  )
    invalid();
  if (!Array.isArray(d.items) || !Array.isArray(d.timeline)) invalid();
  const ids = new Set<number>();
  for (const item of d.items) {
    const r = exact(item, [
      'id',
      'productId',
      'variantId',
      'productName',
      'sku',
      'options',
      'unitPrice',
      'quantity',
      'lineTotal',
    ]);
    if (
      ![r.id, r.productId, r.variantId, r.quantity].every(validOrderId) ||
      !text(r.productName) ||
      !text(r.sku) ||
      !Array.isArray(r.options) ||
      !r.options.every(text) ||
      !validOrderMoney(r.unitPrice) ||
      !validOrderMoney(r.lineTotal) ||
      ids.has(r.id as number)
    )
      invalid();
    ids.add(r.id as number);
  }
  if (d.cancellation !== null) {
    const c = exact(d.cancellation, [
      'cancelledBy',
      'reasonCode',
      'reasonText',
      'cancelledAt',
    ]);
    const by = exact(c.cancelledBy, ['type', 'id']);
    if (
      !actor(by.type) ||
      !nullable(by.id, validOrderId) ||
      !nullable(c.reasonCode, text) ||
      !nullable(c.reasonText, text) ||
      !nullable(c.cancelledAt, date)
    )
      invalid();
  }
  let previousTime = -Infinity;
  for (const event of d.timeline) {
    const t = exact(event, [
      'fromStatus',
      'toStatus',
      'actorType',
      'actorId',
      'reason',
      'reasonCode',
      'reasonText',
      'restockable',
      'receiptReference',
      'trackingReference',
      'deliveryAttempt',
      'createdAt',
    ]);
    if (
      !nullable(t.fromStatus, status) ||
      !status(t.toStatus) ||
      !actor(t.actorType) ||
      !nullable(t.actorId, validOrderId) ||
      ![
        'reason',
        'reasonCode',
        'reasonText',
        'receiptReference',
        'trackingReference',
      ].every((key) => nullable(t[key], text)) ||
      !nullable(t.restockable, (v) => typeof v === 'boolean') ||
      !nullable(t.deliveryAttempt, (v) => validOrderId(v) && v <= 4) ||
      !date(t.createdAt)
    )
      invalid();
    const time = Date.parse(t.createdAt as string);
    if (time < previousTime) invalid();
    previousTime = time;
  }
  return d as unknown as OrderDetail;
}
export const preparationTransitions = {
  confirm: ['PENDING_CONFIRMATION', 'CONFIRMED'],
  'start-packing': ['CONFIRMED', 'PACKING'],
  'ready-to-ship': ['PACKING', 'READY_TO_SHIP'],
} as const;
export function validateSellerReceipt(
  value: unknown,
  orderId: number,
  command: PreparationCommand,
  actorId: number,
): SellerCommandReceipt {
  const r = exact(value, [
    'orderId',
    'commandId',
    'command',
    'replayed',
    'result',
  ]);
  if (
    r.orderId !== orderId ||
    !validOrderId(r.commandId) ||
    r.command !== command ||
    typeof r.replayed !== 'boolean'
  )
    invalid();
  const result = exact(r.result, [
    'status',
    'payment',
    'cancellation',
    'timeline',
  ]);
  const [from, to] = preparationTransitions[command];
  const payment = validateOrderPayment(result.payment);
  if (
    result.status !== to ||
    result.cancellation !== null ||
    !Array.isArray(result.timeline) ||
    result.timeline.length !== 1 ||
    !(
      (payment.provider === 'COD' &&
        payment.status === 'UNPAID' &&
        payment.paidAt === null) ||
      (payment.provider !== 'COD' &&
        payment.status === 'PAID' &&
        payment.paidAt !== null)
    )
  )
    invalid();
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
    !date(event.createdAt)
  )
    invalid();
  return r as unknown as SellerCommandReceipt;
}
