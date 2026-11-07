import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brandApi } from './brandApi';
const transport = vi.hoisted(() => vi.fn());
vi.mock('../../services/apiClient', async (original) => ({ ...await original<typeof import('../../services/apiClient')>(), fetchApi: transport }));
const row = { id: 5, name: 'Brand New', slug: 'brand-old', isActive: false };
beforeEach(() => transport.mockReset());

describe('Brand API uses existing Admin contract', () => {
  it('reads all brands through shared client and projects only needed fields', async () => {
    transport.mockResolvedValue([{ ...row, createdAt: '2026-10-16T00:00:00Z' }]);
    expect(await brandApi.list(new AbortController().signal)).toEqual([row]);
    expect(transport).toHaveBeenCalledWith('/admin/brands', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it.each([{}, [{ ...row, id: '5' }], [row, row]])('rejects malformed/duplicate list responses: %j', async (response) => {
    transport.mockResolvedValue(response);
    await expect(brandApi.list(new AbortController().signal)).rejects.toThrow();
  });
  it('PATCHes only intended fields, never active status; disables automatic 401 write replay', async () => {
    transport.mockResolvedValue({ ...row, searchReconciliation: { jobId: '15', status: 'PENDING' } });
    expect(await brandApi.update(5, { name: ' Brand New ' }, new AbortController().signal)).toMatchObject({ ...row, searchReconciliation: { jobId: '15', status: 'PENDING' } });
    const [path, options] = transport.mock.calls[0];
    expect(path).toBe('/admin/brands/5');
    expect(options.method).toBe('PATCH');
    expect(options.retryOnUnauthorized).toBe(false);
    expect(JSON.parse(options.body)).toEqual({ name: 'Brand New' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('accepts slug-only response with no reconciliation job', async () => {
    transport.mockResolvedValue({ ...row, slug: 'new-slug', searchReconciliation: null });
    expect(await brandApi.update(5, { slug: 'new-slug' }, new AbortController().signal)).toMatchObject({ slug: 'new-slug', searchReconciliation: null });
  });
  it.each([{}, { name: 'x' }, { slug: 'Bad_Slug' }, { isActive: true }, { name: 'Valid', isActive: true }])('rejects invalid/extra patch before sending: %j', async (patch) => {
    await expect(brandApi.update(5, patch as never, new AbortController().signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { ...row, id: 7, searchReconciliation: null },
    { ...row, name: 'Wrong response', searchReconciliation: null },
    { ...row },
    { ...row, searchReconciliation: { jobId: 15, status: 'PENDING' } },
  ])('does not confirm malformed/mismatched successful response: %j', async (response) => {
    transport.mockResolvedValue(response);
    await expect(brandApi.update(5, { name: 'Brand New' }, new AbortController().signal)).rejects.toThrow();
  });
});
