import { ApiError } from './apiClient';
import { validOrderId } from './orderResponse';
import type {
  BuyerCancellationReason,
  BuyerCancellationReceipt,
  BuyerCompletionReceipt,
  BuyerReceiptExpectation,
} from '../types/buyerOrderReceipt';

function invalid(): never {
  // Never echo receipt, cancellation reason or identifiers in this error.
  throw new ApiError(
    'Biên nhận đơn hàng không hợp lệ. Chưa thể xác nhận kết quả yêu cầu.',
    502,
    'INVALID_ORDER_RESPONSE',
  );
}

function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  if (
    Reflect.ownKeys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) invalid();
  return value as Record<string, unknown>;
}

function money(value: unknown): value is string {
  // Whole-match check also rejects a trailing newline (JS `$` alone does not).
  return typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,11})\.00$/.exec(value)?.[0] === value;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string') invalid();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid();
  return time;
}

function expectation(expected: BuyerReceiptExpectation) {
  if (!expected || !validOrderId(expected.orderId) ||
      !validOrderId(expected.actorId) || !money(expected.total)) invalid();
}

function envelope(value: unknown, expected: BuyerReceiptExpectation, command: string) {
  expectation(expected);
  const r = exact(value, ['orderId', 'commandId', 'command', 'replayed', 'result']);
  if (r.orderId !== expected.orderId || !validOrderId(r.commandId) ||
      r.command !== command || typeof r.replayed !== 'boolean') invalid();
  return r;
}

function payment(value: unknown, total: string) {
  const p = exact(value, ['provider', 'status', 'amount', 'currency', 'paidAt']);
  if (!money(p.amount) || p.amount !== total || p.currency !== 'VND') invalid();
  return p;
}

function singleEvent(value: unknown, fields: readonly string[]) {
  if (!Array.isArray(value) || value.length !== 1) invalid();
  return exact(value[0], fields);
}

/** Pure validation, not evidence of current authentication, key or session.
 * Caller must retain the original request reason in RAM; never infer it from
 * the receipt. This function neither sends HTTP nor settles a pending intent.
 */
export function validateBuyerCancellationReceipt(
  value: unknown,
  expected: BuyerReceiptExpectation,
  requestedReason: BuyerCancellationReason,
): BuyerCancellationReceipt {
  const r = envelope(value, expected, 'cancel');
  const reason = exact(requestedReason, ['reasonCode', 'reasonText']);
  if (!['CHANGED_MIND', 'OTHER'].includes(reason.reasonCode as string) ||
      typeof reason.reasonText !== 'string') invalid();
  const normalizedText = reason.reasonText.trim();
  if (normalizedText.length < 1 || normalizedText.length > 500) invalid();
  const result = exact(r.result, ['status', 'payment', 'cancellation', 'timeline']);
  const p = payment(result.payment, expected.total);
  if (result.status !== 'CANCELLED' || p.provider !== 'COD' ||
      p.status !== 'CANCELLED' || p.paidAt !== null) invalid();
  const c = exact(result.cancellation, ['cancelledBy', 'reasonCode', 'reasonText', 'cancelledAt']);
  const by = exact(c.cancelledBy, ['type', 'id']);
  if (by.type !== 'BUYER' || by.id !== expected.actorId ||
      c.reasonCode !== reason.reasonCode || c.reasonText !== normalizedText) invalid();
  timestamp(c.cancelledAt);
  const h = singleEvent(result.timeline, [
    'fromStatus', 'toStatus', 'actorType', 'actorId', 'reasonCode', 'reasonText', 'createdAt',
  ]);
  if (h.fromStatus !== 'PENDING_CONFIRMATION' || h.toStatus !== 'CANCELLED' ||
      h.actorType !== 'BUYER' || h.actorId !== expected.actorId ||
      h.reasonCode !== c.reasonCode || h.reasonText !== c.reasonText ||
      h.createdAt !== c.cancelledAt) invalid();
  timestamp(h.createdAt);
  return r as unknown as BuyerCancellationReceipt;
}

/** Existing /orders/:id/complete response only; SYSTEM receipts are not Buyer
 * receipts. Do not compare with the browser clock or current Order status:
 * replay contains the original snapshot and the client clock is not authority.
 */
export function validateBuyerCompletionReceipt(
  value: unknown,
  expected: BuyerReceiptExpectation,
): BuyerCompletionReceipt {
  const r = envelope(value, expected, 'complete');
  const result = exact(r.result, ['status', 'deliveredAt', 'completedAt', 'payment', 'timeline']);
  const delivered = timestamp(result.deliveredAt);
  const completed = timestamp(result.completedAt);
  const p = payment(result.payment, expected.total);
  if (result.status !== 'COMPLETED' || completed < delivered ||
      !['COD', 'VNPAY', 'MOMO'].includes(p.provider as string) ||
      p.status !== 'PAID' || timestamp(p.paidAt) > completed) invalid();
  const h = singleEvent(result.timeline, ['fromStatus', 'toStatus', 'actorType', 'actorId', 'createdAt']);
  if (h.fromStatus !== 'DELIVERED' || h.toStatus !== 'COMPLETED' ||
      h.actorType !== 'BUYER' || h.actorId !== expected.actorId ||
      h.createdAt !== result.completedAt) invalid();
  timestamp(h.createdAt);
  return r as unknown as BuyerCompletionReceipt;
}
