import { publicStoreId, publicStoreQuery } from './public-store.controller.js';
describe('Public Store strict input', () => {
  it.each([
    '0',
    '01',
    '-1',
    '1.0',
    '+1',
    ' 1',
    '2147483648',
    '1e2',
    '',
    undefined,
    null,
    1,
  ])('rejects invalid id %s', (x) => expect(() => publicStoreId(x)).toThrow());
  it.each([
    '?limit=0',
    '?limit=49',
    '?limit=01',
    '?limit=1&limit=2',
    '?afterId=0',
    '?afterId=2147483648',
    '?afterId[]=2',
    '?storeId=2',
    '?sellerId=1',
    '?limit=%ZZ',
    '?limit=%00',
    '?limit=',
  ])('rejects query %s', (q) =>
    expect(() => publicStoreQuery('/stores/1' + q)).toThrow(),
  );
  it('accepts bounded keyset pagination', () => {
    expect(publicStoreId('2147483647')).toBe(2147483647);
    expect(publicStoreQuery('/stores/1')).toEqual({ limit: 24 });
    expect(publicStoreQuery('/stores/1?limit=48&afterId=12')).toEqual({
      limit: 48,
      afterId: 12,
    });
  });
});
