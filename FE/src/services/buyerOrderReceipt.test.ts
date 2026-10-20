import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './apiClient';
import { validateBuyerCancellationReceipt as cancel, validateBuyerCompletionReceipt as complete } from './buyerOrderReceipt';
import type { BuyerCancellationReason, BuyerReceiptExpectation } from '../types/buyerOrderReceipt';

// Synthetic examples of the merged BE validators, not HTTP/live DB evidence.
const expected = { orderId: 101, actorId: 7, total: '150000.00' } as const;
const reason = { reasonCode: 'OTHER', reasonText: 'Không còn nhu cầu' } as const;
function cancellation() {
  return {
    orderId: 101, commandId: 201, command: 'cancel', replayed: false,
    result: {
      status: 'CANCELLED',
      payment: { provider: 'COD', status: 'CANCELLED', amount: '150000.00', currency: 'VND', paidAt: null },
      cancellation: { cancelledBy: { type: 'BUYER', id: 7 }, ...reason, cancelledAt: '2026-10-18T10:00:00.000Z' },
      timeline: [{ fromStatus: 'PENDING_CONFIRMATION', toStatus: 'CANCELLED', actorType: 'BUYER', actorId: 7, ...reason, createdAt: '2026-10-18T10:00:00.000Z' }],
    },
  };
}
function completion() {
  return {
    orderId: 101, commandId: 202, command: 'complete', replayed: false,
    result: {
      status: 'COMPLETED', deliveredAt: '2026-10-17T10:00:00.000Z', completedAt: '2026-10-18T10:00:00.000Z',
      payment: { provider: 'COD', status: 'PAID', amount: '150000.00', currency: 'VND', paidAt: '2026-10-17T10:00:00.000Z' },
      timeline: [{ fromStatus: 'DELIVERED', toStatus: 'COMPLETED', actorType: 'BUYER', actorId: 7, createdAt: '2026-10-18T10:00:00.000Z' }],
    },
  };
}
function reject(run: () => unknown) {
  expect(run).toThrow(ApiError);
  try { run(); } catch (error) {
    expect(error).toMatchObject({ status: 502, code: 'INVALID_ORDER_RESPONSE' });
    expect((error as Error).message).not.toContain(reason.reasonText);
  }
}
function change(value: unknown, path: string, replacement: unknown) {
  const keys = path.split('.');
  let row = value as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>;
  row[keys.at(-1)!] = replacement;
}

describe('Buyer receipt preparation — pure validation, NOT runtime recovery', () => {
  it.each([false, true])('accepts cancel first/replay=%s without mutating input', (replayed) => {
    const r = cancellation(); r.replayed = replayed;
    const before = JSON.stringify(r);
    expect(cancel(r, expected, reason)).toBe(r);
    expect(JSON.stringify(r)).toBe(before);
  });
  it.each(['CHANGED_MIND', 'OTHER'] as const)('normalizes request text exactly like execute: %s', (reasonCode) => {
    const r = cancellation();
    Object.assign(r.result.cancellation, { reasonCode });
    Object.assign(r.result.timeline[0]!, { reasonCode });
    expect(cancel(r, expected, { reasonCode, reasonText: ` \n${reason.reasonText}\t ` })).toBe(r);
  });
  it.each(['COD', 'VNPAY', 'MOMO'])('accepts existing paid provider %s, first and replay', (provider) => {
    for (const replayed of [false, true]) {
      const r = completion(); r.result.payment.provider = provider; r.replayed = replayed;
      expect(complete(r, expected)).toBe(r);
    }
  });
  it('does not use client clock/current Order to reject an old replay', () => {
    const r = completion(); r.replayed = true;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(0);
    try { expect(complete(r, expected)).toBe(r); } finally { spy.mockRestore(); }
  });
  it.each([null, undefined, [], 'receipt', 0, true])('rejects non-envelope %j', (value) => {
    reject(() => cancel(value, expected, reason));
    reject(() => complete(value, expected));
  });
  it.each([
    ['orderId', 102], ['orderId', '101'], ['orderId', NaN],
    ['commandId', 0], ['commandId', -1], ['commandId', 1.5],
    ['commandId', 2147483648], ['commandId', Infinity], ['commandId', '201'],
    ['replayed', 'true'], ['replayed', null], ['command', 'confirm'],
    ['result.payment.amount', 150000], ['result.payment.amount', '150000'],
    ['result.payment.amount', '0150000.00'], ['result.payment.amount', '-150000.00'],
    ['result.payment.amount', '150000.00\n'], ['result.payment.amount', '150000.01'],
    ['result.payment.amount', '1.5e5'], ['result.payment.amount', '9999999999999.00'],
    ['result.payment.amount', '150001.00'], ['result.payment.currency', 'USD'],
    ['result.timeline', []], ['result.timeline', [null]],
    ['result.timeline.0.actorId', 8], ['result.timeline.0.actorId', '7'],
    ['result.timeline.0.actorType', 'SELLER'], ['result.timeline.0.actorType', 'ADMIN'],
    ['result.timeline.0.actorType', 'SYSTEM'], ['result.timeline.0.actorId', null],
    ['result.timeline.0.createdAt', '2026-10-18T11:00:00.000Z'],
  ])('rejects malformed/mismatched common field %s=%j', (path, value) => {
    const a = cancellation(), b = completion();
    change(a, path as string, value); change(b, path as string, value);
    reject(() => cancel(a, expected, reason)); reject(() => complete(b, expected));
  });
  it.each([
    ['result.status', 'COMPLETED'], ['result.payment.provider', 'VNPAY'],
    ['result.payment.status', 'UNPAID'], ['result.payment.paidAt', '2026-10-18T10:00:00.000Z'],
    ['result.cancellation.cancelledBy.type', 'SELLER'], ['result.cancellation.cancelledBy.id', 8],
    ['result.cancellation.reasonCode', 'OUT_OF_STOCK'], ['result.cancellation.reasonText', 'Lý do khác'],
    ['result.cancellation.reasonText', ` ${reason.reasonText}`],
    ['result.cancellation.cancelledAt', '2026-02-30T10:00:00.000Z'],
    ['result.cancellation.cancelledAt', '2026-10-18T10:00:00Z'],
    ['result.timeline.0.fromStatus', 'CONFIRMED'], ['result.timeline.0.toStatus', 'COMPLETED'],
    ['result.timeline.0.reasonCode', 'CHANGED_MIND'], ['result.timeline.0.reasonText', 'Khác'],
  ])('rejects cancellation-specific corruption %s', (path, value) => {
    const r = cancellation(); change(r, path as string, value);
    reject(() => cancel(r, expected, reason));
  });
  it.each([
    ['result.status', 'DELIVERED'], ['result.payment.provider', 'OTHER'],
    ['result.payment.status', 'UNPAID'], ['result.payment.paidAt', null],
    ['result.payment.paidAt', '2026-10-18T10:00:00.001Z'],
    ['result.deliveredAt', '2026-10-18T10:00:00.001Z'],
    ['result.deliveredAt', '2026-02-30T10:00:00.000Z'],
    ['result.completedAt', 'invalid'], ['result.completedAt', null],
    ['result.completedAt', '2026-10-18T17:00:00.000+07:00'],
    ['result.timeline.0.fromStatus', 'SHIPPING'], ['result.timeline.0.toStatus', 'CANCELLED'],
  ])('rejects completion-specific corruption %s', (path, value) => {
    const r = completion(); change(r, path as string, value);
    reject(() => complete(r, expected));
  });
  it.each(['', 'result', 'result.payment', 'result.timeline.0'])('rejects extra, missing and symbol fields at %s', (path) => {
    for (const [fixture, validate] of [
      [cancellation, (r: unknown) => cancel(r, expected, reason)],
      [completion, (r: unknown) => complete(r, expected)],
    ] as const) {
      for (const mode of ['extra', 'missing', 'symbol']) {
        const r = fixture();
        let row = r as unknown as Record<string | symbol, unknown>;
        if (path) for (const key of path.split('.')) row = row[key] as typeof row;
        if (mode === 'extra') row['internalRequestHash'] = 'not-public';
        if (mode === 'missing') delete row[Object.keys(row)[0]!];
        if (mode === 'symbol') row[Symbol('hidden')] = true;
        reject(() => validate(r));
      }
    }
  });
  it.each(['result.cancellation', 'result.cancellation.cancelledBy'])('rejects extra cancellation metadata at %s', (path) => {
    const r = cancellation(); change(r, `${path}.extra`, true);
    reject(() => cancel(r, expected, reason));
  });
  it('rejects duplicate history rather than accepting entire GET timeline', () => {
    const a = cancellation(), b = completion();
    a.result.timeline.push({ ...a.result.timeline[0]! }); b.result.timeline.push({ ...b.result.timeline[0]! });
    reject(() => cancel(a, expected, reason)); reject(() => complete(b, expected));
  });
  it('rejects a real-shaped SYSTEM completion instead of treating it as Buyer success', () => {
    const r = completion(); change(r, 'result.timeline.0.actorType', 'SYSTEM'); change(r, 'result.timeline.0.actorId', null);
    reject(() => complete(r, expected));
  });
  it.each([
    { orderId: 0 }, { orderId: '101' }, { actorId: -1 }, { actorId: NaN },
    { actorId: '7' }, { total: '150000.00\n' }, { total: 150000 }, { total: '999.00' },
  ])('rejects invalid/mismatched invocation expectation %j', (delta) => {
    const context = { ...expected, ...delta } as BuyerReceiptExpectation;
    reject(() => cancel(cancellation(), context, reason)); reject(() => complete(completion(), context));
  });
  it.each([
    null, {}, { ...reason, extra: 1 }, { ...reason, reasonCode: 'OUT_OF_STOCK' },
    { ...reason, reasonText: '' }, { ...reason, reasonText: ' \n ' },
    { ...reason, reasonText: 'x'.repeat(501) }, { ...reason, reasonText: 3 },
  ])('rejects absent/invalid original reason %j', (body) => {
    reject(() => cancel(cancellation(), expected, body as BuyerCancellationReason));
  });
  it('accepts max money and ID without float conversion, and zero per existing receipt contract', () => {
    for (const total of ['0.00', '999999999999.00']) {
      const context = { orderId: 2147483647, actorId: 2147483647, total };
      const a = cancellation(), b = completion();
      for (const r of [a, b]) { r.orderId = context.orderId; r.commandId = 2147483647; r.result.payment.amount = total; r.result.timeline[0]!.actorId = context.actorId; }
      a.result.cancellation.cancelledBy.id = context.actorId;
      expect(cancel(a, context, reason)).toBe(a); expect(complete(b, context)).toBe(b);
    }
  });
  it('accepts time equality allowed by Backend, without inventing a minimum wait', () => {
    const r = completion(); r.result.deliveredAt = r.result.completedAt; r.result.payment.paidAt = r.result.completedAt;
    expect(complete(r, expected)).toBe(r);
  });
});
