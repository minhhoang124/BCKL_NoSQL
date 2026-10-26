import { randomUUID } from 'node:crypto';
import {
  digest,
  input,
  page,
  positive,
  proof,
  text,
  validAction,
  windowDays,
} from './review-input.js';
const body = () => ({
  commandId: randomUUID(),
  confirmed: true,
  rating: 5,
  body: 'Sản phẩm tốt',
});
describe('Review strict boundaries and canonical command hashes', () => {
  it.each([null, [], {}, '1', 0, -1, 1.5, 2147483648, NaN, Infinity])(
    'rejects invalid id %j',
    (v) => expect(() => positive(v)).toThrow(),
  );
  it.each([0, 6, '5', null, [], NaN])('rejects invalid rating %j', (rating) =>
    expect(() => input('BUYER', 'create', { ...body(), rating })).toThrow(),
  );
  it('normalizes Unicode and CRLF, counts codepoints', () => {
    expect(text('  Nguye\u0302\u0303n\r\n😀  ')).toBe('Nguyễn\n😀');
    expect(text('😀'.repeat(2000))).toHaveLength(4000);
    expect(() => text('😀'.repeat(2001))).toThrow();
  });
  it.each(['', '\u0000', 'tab\there', '\u0085', '\ud800'])(
    'rejects invalid review text %j',
    (v) => expect(() => text(v)).toThrow(),
  );
  it('rejects unknown fields, wrong confirmation, uppercase UUID and missing values', () => {
    for (const extra of [
      { actorId: 1 },
      { confirmed: 'true' },
      { commandId: randomUUID().toUpperCase() },
      { body: undefined },
      { rating: undefined },
    ])
      expect(() => input('BUYER', 'create', { ...body(), ...extra })).toThrow();
  });
  it('reply/hide need revision, scope only permits matching action', () => {
    expect(
      input('SELLER', 'reply', {
        commandId: randomUUID(),
        confirmed: true,
        expectedRevision: 1,
        body: 'Cảm ơn bạn',
      }).body,
    ).toBe('Cảm ơn bạn');
    expect(() =>
      input('SELLER', 'reply', { ...body(), expectedRevision: 1 }),
    ).toThrow();
    expect(() => validAction('BUYER', ['create'])).toThrow();
    expect(() => validAction('ADMIN', 'edit')).toThrow();
    expect(() =>
      input('ADMIN', 'hide', {
        commandId: randomUUID(),
        confirmed: true,
        reason: 'Lý do quá ngắn',
      }),
    ).toThrow();
  });
  it('canonical hash ignores key order and UUID, includes scope/action/item/body/revision', () => {
    const b = input('BUYER', 'create', body());
    const h = digest('BUYER', 'create', 1, b);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(
      digest('BUYER', 'create', 1, { ...b, commandId: randomUUID() }),
    ).toBe(h);
    expect(digest('BUYER', 'create', 2, b)).not.toBe(h);
    expect(digest('BUYER', 'create', 1, { ...b, rating: 4 })).not.toBe(h);
  });
  it('proof accepts only key/hash/confirmation and rejects body leakage', () => {
    const p = {
      commandId: randomUUID(),
      requestHash: 'a'.repeat(64),
      confirmed: true,
    };
    expect(proof(p).requestHash).toBe(p.requestHash);
    expect(() => proof({ ...p, body: 'secret' })).toThrow();
    expect(() => proof({ ...p, requestHash: 'A'.repeat(64) })).toThrow();
  });
  it.each([
    '?limit=01',
    '?limit=0',
    '?limit=51',
    '?limit=2&limit=3',
    '?q=x',
    '?beforeId[]=1',
    '?beforeId=2147483648',
    '?beforeId=-1',
  ])('rejects query %s', (q) => expect(() => page('/reviews' + q)).toThrow());
  it('parses bounded deterministic cursor and rejects query on mine', () => {
    expect(page('/reviews?limit=50&beforeId=2')).toEqual({
      limit: 50,
      beforeId: 2,
    });
    expect(() => page('/mine?limit=2', false)).toThrow();
  });
  it.each(['', '0', '-1', '1.5', '366', 'NaN', 'Infinity', '01'])(
    'invalid config fails closed %s',
    (v) => expect(() => windowDays(v)).toThrow(),
  );
  it('default window is30 and supports bounded days', () => {
    expect(windowDays('30')).toBe(30);
    expect(windowDays('365')).toBe(365);
  });
});
