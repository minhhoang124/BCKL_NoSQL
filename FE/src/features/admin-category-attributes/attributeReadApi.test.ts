import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAttributeReadApi } from './attributeReadApi';
import { setAccessToken } from '../../services/apiClient';

const definitionFixture = (id = 1) => ({ id, categoryId: 12, name: `Thuộc tính ${id}`, slug: `thuoc-tinh-${id}`, dataType: 'SINGLE_SELECT' as const,
  isRequired: false, isFilterable: false, allowsCustom: false, sortOrder: 0, isActive: true, revision: 3,
  usage: { referencedProductCount: 0 }, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' });
const optionFixture = (id = 1) => ({ id, attributeDefinitionId: 1, value: `Lựa chọn ${id}`, slug: `lua-chon-${id}`, sortOrder: 0, isActive: false, referencedProductCount: 0 });
afterEach(() => { setAccessToken(null); vi.restoreAllMocks(); });
describe('Attributes read adapter', () => {
  it('GET only, no cache, allows session refresh; preserves zero/false', async () => {
    const request = vi.fn().mockResolvedValue({ items: [definitionFixture()], nextCursor: null });
    const result = await createAttributeReadApi(request).list(12);
    expect(result.items[0].usage.referencedProductCount).toBe(0);
    expect(result.items[0].isRequired).toBe(false);
    expect(request).toHaveBeenCalledWith('/admin/categories/12/attributes?limit=50', expect.objectContaining({ method: 'GET', cache: 'no-store', retryOnUnauthorized: true }));
    expect(request.mock.calls[0][1].body).toBeUndefined();
  });
  it('serializes false and cursor and validates options ownership/revision', async () => {
    const request = vi.fn().mockResolvedValue({ items: [optionFixture(4)], nextCursor: 4, definitionRevision: 3 });
    const result = await createAttributeReadApi(request).options(12, 1, { limit: 1, afterId: 3, isActive: false });
    expect(result.definitionRevision).toBe(3);
    expect(request.mock.calls[0][0]).toBe('/admin/categories/12/attributes/1/options?limit=1&afterId=3&isActive=false');
  });
  it.each([0, -1, 1.2, 2147483648, NaN])('rejects category ID %s before HTTP', async id => {
    const request = vi.fn(); await expect(createAttributeReadApi(request).list(id)).rejects.toMatchObject({ status: 400 }); expect(request).not.toHaveBeenCalled();
  });
  it.each([{ limit: 0 }, { limit: 101 }, { afterId: -1 }, { isActive: 'false' }, { unknown: 1 }])('rejects invalid query %j', async query => {
    const request = vi.fn(); await expect(createAttributeReadApi(request).list(12, query as never)).rejects.toMatchObject({ status: 400 }); expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { items: [definitionFixture()], nextCursor: 1 },
    { items: [definitionFixture(2), definitionFixture(1)], nextCursor: null },
    { items: [definitionFixture(1), definitionFixture(1)], nextCursor: null },
    { items: [{ ...definitionFixture(), categoryId: 13 }], nextCursor: null },
    { items: [{ ...definitionFixture(), revision: 0 }], nextCursor: null },
    { items: [{ ...definitionFixture(), usage: null }], nextCursor: null },
    { items: [{ ...definitionFixture(), extra: true }], nextCursor: null },
    { items: [], nextCursor: 2 },
    { items: [], nextCursor: null, total: 0 },
  ])('rejects malformed/foreign/out-of-order pages %#', async response => {
    await expect(createAttributeReadApi(async () => response).list(12)).rejects.toMatchObject({ status: 502 });
  });
  it('does not apply future write-validation to legacy read names/slugs', async () => {
    const row = { ...definitionFixture(), name: 'X', slug: 'Legacy_slug' };
    expect(await createAttributeReadApi(async () => row).detail(12, 1)).toEqual(row);
  });
  it('rejects wrong detail ID', async () => {
    await expect(createAttributeReadApi(async () => definitionFixture(2)).detail(12, 1)).rejects.toMatchObject({ status: 502 });
  });
  it.each([0, undefined, '3'])('rejects missing/invalid option revision %s', async revision => {
    await expect(createAttributeReadApi(async () => ({ items: [], nextCursor: null, definitionRevision: revision })).options(12, 1)).rejects.toMatchObject({ status: 502 });
  });
  it('rejects foreign options and filter violations', async () => {
    await expect(createAttributeReadApi(async () => ({ items: [{ ...optionFixture(), attributeDefinitionId: 9 }], nextCursor: null, definitionRevision: 3 })).options(12, 1)).rejects.toMatchObject({ status: 502 });
    await expect(createAttributeReadApi(async () => ({ items: [definitionFixture()], nextCursor: null })).list(12, { isActive: false })).rejects.toMatchObject({ status: 502 });
  });
  it('rejects a cursor page returning old IDs', async () => {
    await expect(createAttributeReadApi(async () => ({ items: [definitionFixture()], nextCursor: null })).list(12, { afterId: 1 })).rejects.toMatchObject({ status: 502 });
  });
  it('discards response after cancellation even when requester ignores abort', async () => {
    const controller = new AbortController();
    const api = createAttributeReadApi(async () => { controller.abort(); return definitionFixture(); });
    await expect(api.detail(12, 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('discards response after login/logout boundary', async () => {
    const api = createAttributeReadApi(async () => { setAccessToken(null); return definitionFixture(); });
    await expect(api.detail(12, 1)).rejects.toMatchObject({ name: 'AuthSessionChangedError' });
  });
});
