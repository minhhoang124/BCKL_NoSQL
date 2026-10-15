import { completeInput, autoCompleteKey } from './order-completion-request.js';
import { validateCompletionResult } from './order-completion-receipt.js';
const key = 'complete-command-key-01';
describe('Completion request/receipt', () => {
  it('separates SYSTEM and Buyer scopes and keeps deterministic rule key', () => {
    expect(completeInput(1, 2, key, {}).actorScope).toBe('USER:1');
    expect(completeInput(null, 2, key, {}).actorScope).toBe(
      'SYSTEM:ORDER_AUTO_COMPLETE',
    );
    expect(completeInput(1, 2, key, {}).requestHash).not.toBe(
      completeInput(null, 2, key, {}).requestHash,
    );
    const at = new Date('2026-10-10T00:00:00.000Z');
    expect(autoCompleteKey(2, at, 1)).toBe(autoCompleteKey(2, at, 1));
    expect(autoCompleteKey(2, at, 1)).not.toBe(autoCompleteKey(2, at, 2));
  });
  it.each([null, [], { actorType: 'SYSTEM' }, { status: 'COMPLETED' }, ''])(
    'rejects invalid body %#',
    (body) => expect(() => completeInput(1, 2, key, body)).toThrow(),
  );
  it.each([
    null,
    undefined,
    'short',
    'with space________',
    'x'.repeat(129),
    ['x'.repeat(16)],
  ])('rejects key %#', (k) =>
    expect(() => completeInput(1, 2, k, {})).toThrow(),
  );
  it.each([0, -1, NaN, Infinity, 1.5, 2147483648])('rejects id %s', (id) =>
    expect(() => completeInput(1, id, key, {})).toThrow(),
  );
  const deliveredAt = '2026-10-07T00:00:00.000Z',
    completedAt = '2026-10-10T00:00:00.000Z';
  const r = {
    status: 'COMPLETED',
    deliveredAt,
    completedAt,
    payment: {
      provider: 'COD',
      status: 'PAID',
      amount: '10000.00',
      currency: 'VND',
      paidAt: deliveredAt,
    },
    timeline: [
      {
        fromStatus: 'DELIVERED',
        toStatus: 'COMPLETED',
        actorType: 'BUYER',
        actorId: 1,
        createdAt: completedAt,
      },
    ],
  };
  it('accepts exact receipt', () =>
    expect(validateCompletionResult(r, 1)).toEqual(r));
  it.each([
    { ...r, secret: 'bad' },
    { ...r, payment: { ...r.payment, provider: ['COD'] } },
    { ...r, payment: { ...r.payment, amount: 10000 } },
    { ...r, payment: { ...r.payment, status: 'UNPAID' } },
    { ...r, timeline: [] },
    { ...r, completedAt: 'bad' },
    { ...r, completedAt: '2026-10-01T00:00:00.000Z' },
    { ...r, timeline: [{ ...r.timeline[0], actorType: 'ADMIN' }] },
  ])('rejects persisted receipt %#', (v) =>
    expect(() => validateCompletionResult(v, 1)).toThrow(),
  );
});
