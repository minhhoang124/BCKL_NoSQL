import { prepareReturnedCommand } from './order-returned-request.js';
import { validateReturnedResult } from './order-returned-receipt.js';
const key = 'return-command-key-0001';
const body = {
  reasonCode: 'RETURN_RECEIVED',
  reasonText: ' Received ',
  restockable: true,
  receiptReference: ' R-1 ',
};
const prepare = (raw: unknown = body, actor: 'SELLER' | 'ADMIN' = 'SELLER') =>
  prepareReturnedCommand(12, actor, 34, key, raw);
describe('Returned command canonical DTO', () => {
  it('trims and produces reproducible v1 hash independent of JSON field order', () => {
    const p = prepare();
    expect(p.body).toEqual({
      ...body,
      reasonText: 'Received',
      receiptReference: 'R-1',
    });
    expect(p.requestHash).toBe(
      prepare({
        receiptReference: 'R-1',
        restockable: true,
        reasonText: 'Received',
        reasonCode: 'RETURN_RECEIVED',
      }).requestHash,
    );
    expect(p.requestHash).not.toBe(
      prepare({ ...body, reasonText: 'different' }).requestHash,
    );
  });
  it('retains meaningful false/null in LOST hash', () => {
    const p = prepare(
      {
        reasonCode: 'LOST',
        reasonText: 'Lost',
        restockable: false,
        receiptReference: null,
      },
      'ADMIN',
    );
    expect(p.body.receiptReference).toBeNull();
    expect(p.body.restockable).toBe(false);
  });
  it.each([
    null,
    [],
    {},
    { ...body, restockable: 'true' },
    { ...body, restockable: false },
    { ...body, receiptReference: null },
    { ...body, receiptReference: '' },
    { ...body, receiptReference: 'x'.repeat(101) },
    { ...body, reasonText: ' ' },
    { ...body, reasonText: 'x'.repeat(501) },
    { ...body, extra: true },
    { ...body, reasonCode: 'LOST', restockable: false, receiptReference: null },
  ])('rejects inconsistent/extra DTO %#', (raw) =>
    expect(() => prepare(raw)).toThrow(),
  );
  it.each([
    'short',
    'with space________',
    'x'.repeat(129),
    ['x'.repeat(16)],
    null,
  ])('rejects invalid key %#', (k) =>
    expect(() => prepareReturnedCommand(1, 'ADMIN', 2, k, body)).toThrow(),
  );
  it.each([0, -1, 2147483648, 1.5, NaN])('rejects ID %s', (id) =>
    expect(() => prepareReturnedCommand(id, 'ADMIN', 2, key, body)).toThrow(),
  );
});
describe('Returned immutable receipt allowlist', () => {
  const p = prepare();
  const at = '2026-10-10T12:00:00.000Z';
  const result = {
    status: 'CANCELLED',
    payment: {
      provider: 'COD',
      status: 'CANCELLED',
      amount: '10000.00',
      currency: 'VND',
      paidAt: null,
    },
    cancellation: {
      cancelledBy: { type: 'SELLER', id: 12 },
      reasonCode: 'RETURN_RECEIVED',
      reasonText: 'Received',
      cancelledAt: at,
    },
    restockable: true,
    receiptReference: 'R-1',
    delivery: { deliveryAttempt: 1, retryCount: 0, trackingReference: 'T-1' },
    timeline: [
      {
        fromStatus: 'DELIVERY_FAILED',
        toStatus: 'CANCELLED',
        actorType: 'SELLER',
        actorId: 12,
        reasonCode: 'RETURN_RECEIVED',
        reasonText: 'Received',
        restockable: true,
        receiptReference: 'R-1',
        deliveryAttempt: 1,
        trackingReference: 'T-1',
        createdAt: at,
      },
    ],
  };
  const validate = (r: unknown) =>
    validateReturnedResult(r, 12, 'SELLER', p.body);
  it('accepts canonical receipt', () =>
    expect(validate(result)).toEqual(result));
  it.each([
    { ...result, secret: 'bad' },
    { ...result, restockable: false },
    { ...result, receiptReference: null },
    { ...result, delivery: { ...result.delivery, retryCount: 3 } },
    { ...result, timeline: [] },
    { ...result, payment: { ...result.payment, amount: 10000 } },
    { ...result, timeline: [{ ...result.timeline[0], actorId: 13 }] },
  ])('rejects malformed persisted receipt %#', (r) =>
    expect(() => validate(r)).toThrow(),
  );
});
