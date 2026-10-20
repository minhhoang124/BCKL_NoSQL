import { describe, expect, it } from 'vitest';
import { parseAccountListQuery } from './admin-account-list.js';

describe('Admin account list query boundary', () => {
  it('defaults to a bounded page', () => {
    expect(parseAccountListQuery('/admin/accounts')).toEqual({ limit: 50 });
  });
  it('normalizes Unicode and accepts strict filters', () => {
    expect(
      parseAccountListQuery(
        '/admin/accounts?limit=1&afterId=2147483647&role=SELLER&isActive=false&q=%20A%CC%81%20',
      ),
    ).toEqual({
      limit: 1,
      afterId: 2147483647,
      role: 'SELLER',
      isActive: false,
      q: 'Á',
    });
  });
  it.each([
    'limit=0',
    'limit=101',
    'limit=-1',
    'limit=1.5',
    'limit=1e2',
    'limit=01',
    'limit=',
    'afterId=2147483648',
    'afterId=NaN',
    'role=buyer',
    'isActive=1',
    'isActive=null',
    'isActive=',
    'q=a&q=b',
    'limit=1&limit=2',
    'role=USER&role=SELLER',
    'q[]=a',
    'q[x]=a',
    '__proto__=x',
    'unknown=x',
    'q=%00bad',
    'q=x%0Ay',
    `q=${'x'.repeat(121)}`,
  ])('rejects malformed query %s', (query) => {
    expect(() => parseAccountListQuery(`/admin/accounts?${query}`)).toThrow();
  });
  it('counts Unicode code points, not UTF-16 units', () => {
    expect(
      parseAccountListQuery(`/admin/accounts?q=${'😀'.repeat(120)}`).q,
    ).toHaveLength(240);
  });
});
