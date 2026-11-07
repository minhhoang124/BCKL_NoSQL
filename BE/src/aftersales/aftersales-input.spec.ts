import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  commandHash,
  commandInput,
  pageInput,
  positiveId,
  reconcileInput,
} from './aftersales-input.js';
const create = () => ({
  commandId: randomUUID(),
  kind: 'REFUND_ONLY',
  reasonCode: 'DAMAGED',
  description: 'A damaged delivered item',
});
describe('Aftersales strict boundary and canonical fingerprint', () => {
  it.each([
    null,
    [],
    {},
    { ...create(), amount: '10.00' },
    { ...create(), kind: ['REFUND_ONLY'] },
    { ...create(), reasonCode: ['DAMAGED'] },
    { ...create(), commandId: 'D493AB07-2C84-4D3A-9E98-BCD636189740' },
    { ...create(), description: 'short' },
    { ...create(), description: 'bad control\u0000 reason' },
    { ...create(), description: 'bad surrogate\ud800 reason' },
  ])('refuses malformed creation %j', (value) => {
    expect(() => commandInput('create', value)).toThrow();
  });
  it('canonicalizes NFC/reason whitespace without mutating input', () => {
    const body = {
      ...create(),
      description: '  Nguye\u0302\u0303n nhận hàng bị hỏng  ',
    };
    const snapshot = { ...body };
    const input = commandInput('create', body);
    expect(input.body.description).toBe('Nguyễn nhận hàng bị hỏng');
    expect(body).toEqual(snapshot);
    expect(commandHash('BUYER', 'create', 1, input)).toBe(
      commandHash(
        'BUYER',
        'create',
        1,
        commandInput('create', {
          ...body,
          description: 'Nguyễn nhận hàng bị hỏng',
        }),
      ),
    );
    expect(commandHash('BUYER', 'create', 1, input)).not.toBe(
      commandHash('BUYER', 'create', 2, input),
    );
    expect(commandHash('BUYER', 'create', 1, input)).not.toBe(
      commandHash('ADMIN', 'create', 1, input),
    );
  });
  it('requires exact revision and explicit boolean restockability', () => {
    const value = {
      commandId: randomUUID(),
      expectedRevision: 1,
      reason: 'Explicit decision reason',
    };
    expect(() => commandInput('receive', value)).toThrow();
    expect(() =>
      commandInput('receive', { ...value, restockable: 'false' }),
    ).toThrow();
    expect(
      commandInput('receive', { ...value, restockable: false }).body
        .restockable,
    ).toBe(false);
    expect(() =>
      commandInput('approve', { ...value, expectedRevision: '1' }),
    ).toThrow();
    expect(() =>
      commandInput('approve', { ...value, restockable: false }),
    ).toThrow();
  });
  it.each([
    '?limit=0',
    '?limit=51',
    '?limit=01',
    '?limit=1&limit=2',
    '?q=x',
    '?limit[]=2',
    '?beforeId=2147483648',
  ])('rejects query smuggling %s', (query) => {
    expect(() => pageInput('/aftersales' + query)).toThrow();
  });
  it('keeps maximum revision inclusive unless an exclusive cursor was supplied', () => {
    expect(pageInput('/aftersales')).toEqual({ limit: 20 });
    expect(pageInput('/aftersales?beforeRevision=2147483647', true)).toEqual({
      limit: 20,
      before: 2147483647,
    });
    expect(() => positiveId(2147483648)).toThrow();
  });
  it('reconcile accepts only metadata; no amount/reason or loose hash shape', () => {
    const value = { commandId: randomUUID(), requestHash: 'a'.repeat(64) };
    expect(reconcileInput(value)).toEqual(value);
    expect(() =>
      reconcileInput({ ...value, reason: 'Must not be persisted' }),
    ).toThrow();
    expect(() =>
      reconcileInput({ ...value, requestHash: 'A'.repeat(64) }),
    ).toThrow();
  });
});
