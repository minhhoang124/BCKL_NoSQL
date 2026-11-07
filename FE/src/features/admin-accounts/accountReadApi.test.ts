import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountReadApi, normalizeAccountSearch } from './accountReadApi';
import { setAccessToken } from '../../services/apiClient';
const row = (id = 1) => ({ id, email: `account${id}@example.test`, fullName: null, role: 'USER', isActive: false,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', store: null });
afterEach(() => { setAccessToken(null); vi.restoreAllMocks(); });
describe('Accounts read adapter', () => {
  it('only GET with no-store/no refresh, preserves inactive/nulls; no writes', async () => {
    const request = vi.fn().mockResolvedValue({ items: [row()], nextCursor: null });
    expect((await createAccountReadApi(request).list()).items[0]).toEqual(row());
    expect(request).toHaveBeenCalledWith('/admin/accounts?limit=50', expect.objectContaining({ method: 'GET', cache: 'no-store', retryOnUnauthorized: false }));
    expect(request.mock.calls[0][1].body).toBeUndefined();
  });
  it('encodes NFC query/literal wildcard and false without losing cursor', async () => {
    const request = vi.fn().mockResolvedValue({ items: [{ ...row(7), role: 'SELLER', store: { id: 3, name: 'QA', status: 'SUSPENDED' } }], nextCursor: 7 });
    await createAccountReadApi(request).list({ limit: 1, afterId: 4, role: 'SELLER', isActive: false, q: ' A\u0301 %_\\ ' });
    const url = new URL(request.mock.calls[0][0], 'https://test.invalid');
    expect(url.searchParams.get('q')).toBe('Á %_\\'); expect(url.searchParams.get('isActive')).toBe('false'); expect(url.searchParams.get('afterId')).toBe('4');
  });
  it('preserves a mixed ACTIVE/CLOSED/null Store page from the current Backend enum', async () => {
    const items = [
      { ...row(1), role: 'SELLER', isActive: true, store: { id: 10, name: 'Active store', status: 'ACTIVE' } },
      { ...row(2), role: 'SELLER', isActive: true, store: { id: 11, name: 'Closed store', status: 'CLOSED' } },
      row(3),
    ];
    await expect(createAccountReadApi(async () => ({ items, nextCursor: null })).list()).resolves.toEqual({ items, nextCursor: null });
  });
  it('counts codepoints after NFC, not raw UTF16', () => {
    expect(normalizeAccountSearch('😀'.repeat(120))).toHaveLength(240);
    expect(normalizeAccountSearch(('a\u0301').repeat(120))).toBe('á'.repeat(120));
  });
  it.each([{ limit: 0 }, { limit: 101 }, { limit: 1.2 }, { afterId: 0 }, { afterId: 2147483648 },
    { role: 'buyer' }, { isActive: 'false' }, { extra: true }, { q: 'x'.repeat(121) }, { q: 'x\ny' }, { q: null }])('rejects bad query before HTTP %j', async query => {
    const request = vi.fn(); await expect(createAccountReadApi(request).list(query as never)).rejects.toBeDefined(); expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { items: [row()], nextCursor: 1 }, { items: [], nextCursor: 1 },
    { items: [row(2), row(1)], nextCursor: null }, { items: [row(), row()], nextCursor: null },
    { items: [row()], nextCursor: null, totalCount: 1 },
    { items: [{ ...row(), passwordHash: 'PRIVATE' }], nextCursor: null },
    { items: [{ ...row(), role: 'ROOT' }], nextCursor: null },
    { items: [{ ...row(), fullName: 0 }], nextCursor: null },
    { items: [{ ...row(), isActive: 'false' }], nextCursor: null },
    { items: [{ ...row(), store: { id: 1, name: 'QA', status: 'ACTIVE', address: 'PRIVATE' } }], nextCursor: null },
    { items: [{ ...row(), store: { id: 1, name: 'QA', status: 'UNKNOWN' } }], nextCursor: null },
  ])('rejects malformed/private/unsorted response %#', async result => {
    await expect(createAccountReadApi(async () => result).list()).rejects.toMatchObject({ status: 502 });
  });
  it('validates response filters and forward cursor, but never filters by q locally', async () => {
    const api = createAccountReadApi(async () => ({ items: [row()], nextCursor: null }));
    await expect(api.list({ role: 'SELLER' })).rejects.toMatchObject({ status: 502 });
    await expect(api.list({ isActive: true })).rejects.toMatchObject({ status: 502 });
    await expect(api.list({ afterId: 1 })).rejects.toMatchObject({ status: 502 });
    expect((await api.list({ q: 'server-collation' })).items).toHaveLength(1);
  });
  it('does not send whitespace-only q', async () => {
    const request = vi.fn().mockResolvedValue({ items: [], nextCursor: null }); await createAccountReadApi(request).list({ q: '  ' });
    expect(request.mock.calls[0][0]).toBe('/admin/accounts?limit=50');
  });
  it('discards late response after abort', async () => {
    const controller = new AbortController();
    const api = createAccountReadApi(async () => { controller.abort(); return { items: [row()], nextCursor: null }; });
    await expect(api.list({}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('discards late response after session boundary', async () => {
    const api = createAccountReadApi(async () => { setAccessToken(null); return { items: [row()], nextCursor: null }; });
    await expect(api.list()).rejects.toMatchObject({ name: 'AuthSessionChangedError' });
  });
});
