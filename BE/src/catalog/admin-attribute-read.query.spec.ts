import { describe, expect, it } from 'vitest';
import {
  attributeReadId,
  attributeReadQuery,
} from './admin-attribute-read.query.js';

describe('Admin attribute strict read query', () => {
  it('defaults to all states and a bounded page', () => {
    expect(attributeReadQuery({})).toEqual({
      limit: 50,
      afterId: undefined,
      isActive: undefined,
    });
  });
  it('accepts a typed cursor and explicit inactive filter', () => {
    expect(
      attributeReadQuery({ limit: '100', afterId: '3', isActive: 'false' }),
    ).toEqual({ limit: 100, afterId: 3, isActive: false });
  });
  it.each(['0', '-1', '1.5', '1e2', ' 1', '01', '2147483648', '', 'Infinity'])(
    'rejects unsafe ID %s',
    (id) => {
      expect(() => attributeReadId(id)).toThrow();
    },
  );
  it.each([
    { limit: '101' },
    { limit: ['1', '2'] },
    { afterId: ['1', '2'] },
    { isActive: ['true', 'false'] },
    { isActive: '1' },
    { isActive: true },
    { actorId: '1' },
    { categoryId: '2' },
    { limit: null },
  ])('rejects duplicate, unknown, or malformed fields %j', (query) => {
    expect(() => attributeReadQuery(query)).toThrow();
  });
});
