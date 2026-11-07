import { parseAdminOrderLookupQuery } from './admin-order-lookup.js';

const uuid = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

describe('Admin order-number lookup query', () => {
  it('empty query keeps the delivery queue', () => {
    expect(parseAdminOrderLookupQuery({})).toBeUndefined();
  });
  it.each([
    [`ORD-${uuid}`, `ORD-${uuid}`],
    [`  ord-${uuid.toUpperCase()}  `, `ORD-${uuid}`],
    [uuid, `ORD-${uuid}`],
    ['ORD-1a2b3c4d', 'ORD-1a2b3c4d'],
    ['1A2B3C4D', 'ORD-1a2b3c4d'],
    ['ORD-1a2b3c4d-5e', 'ORD-1a2b3c4d-5e'],
  ])('normalizes %j', (input, expected) => {
    expect(parseAdminOrderLookupQuery({ orderNumber: input })).toBe(expected);
  });
  it.each([
    'ORD-1a2b3c4',
    'ORD-',
    '',
    '   ',
    'ORD-1a2b-3c4',
    'ORD-%',
    'ORD-1a2b3c4d%',
    'ORD-1a2b3c4d_',
    "ORD-1a2b3c4d' OR 1=1",
    'ORD-1a2b3c4g',
    'ORD--1a2b3c4d',
    'ORD-1a2b3c4d--5e',
    'ORD-1a2b 3c4d',
    'ORD-ORD-1a2b3c4d',
    `ORD-${uuid}0`,
    'x'.repeat(65),
  ])('rejects %j', (input) => {
    expect(() => parseAdminOrderLookupQuery({ orderNumber: input })).toThrow();
  });
  it.each([
    null,
    [],
    'ORD-1a2b3c4d',
    { orderNumber: ['ORD-1a2b3c4d'] },
    { orderNumber: 12345678 },
    { orderNumber: 'ORD-1a2b3c4d', limit: '5' },
    { limit: '100' },
    { buyerEmail: 'x@example.test' },
  ])('rejects non-string, repeated or extra parameters %j', (query) => {
    expect(() => parseAdminOrderLookupQuery(query)).toThrow();
  });
});
