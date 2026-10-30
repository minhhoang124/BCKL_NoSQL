import { describe, expect, it } from 'vitest';
import { sameReconciliationJson } from './search-reconciliation.service.js';

describe('Reconciliation JSONB structural equality', () => {
  it('ignores JSON object key order recursively without dropping attributes', () => {
    const source = { VeryLongAttributeName: ['Blue'], a: ['Cotton'], nested: { z: false, a: 0 } };
    const stored = { nested: { a: 0, z: false }, a: ['Cotton'], VeryLongAttributeName: ['Blue'] };
    expect(JSON.stringify(source)).not.toBe(JSON.stringify(stored));
    expect(sameReconciliationJson(source, stored)).toBe(true);
  });
  it.each([
    [{ a: ['x'] }, { a: ['x'], unrecognizedAttribute: ['new'] }],
    [{ a: ['x'], unrecognizedAttribute: ['old'] }, { a: ['x'], unrecognizedAttribute: ['new'] }],
    [{ a: ['x'] }, { b: ['x'] }],
    [{ a: null }, {}],
  ])('compares the complete own-key set and every value (%j vs %j)', (a, b) => {
    expect(sameReconciliationJson(a, b)).toBe(false);
    expect(sameReconciliationJson(b, a)).toBe(false);
  });
  it.each([
    [['first', 'second'], ['second', 'first']],
    [['first'], ['first', 'second']],
    [[1, 2], { 0: 1, 1: 2 }],
    [[false, 0], [0, false]],
  ])('preserves array identity, order and length (%j vs %j)', (a, b) =>
    expect(sameReconciliationJson(a, b)).toBe(false));
  it.each([[false, 'false'], [0, '0'], [null, false], [[], {}], [1, true]])(
    'never coerces distinct JSON types (%j vs %j)', (a, b) =>
      expect(sameReconciliationJson(a, b)).toBe(false),
  );
  it('retains false, zero, null and ordered nested arrays', () => {
    expect(sameReconciliationJson({ flags: [false, 0, null, { b: 'B', a: 'A' }] },
      { flags: [false, 0, null, { a: 'A', b: 'B' }] })).toBe(true);
  });
  it('does not treat an inherited key as the corresponding own JSON field', () => {
    const inherited = Object.create({ a: 'value' }) as Record<string, unknown>;
    expect(sameReconciliationJson({ a: 'value' }, inherited)).toBe(false);
  });
});
