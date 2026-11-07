import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setAccessToken } from '../../services/apiClient';
import { createAttributeWriteApi, isUnknownWriteOutcome } from './attributeWriteApi';

const definition = { id: 7, categoryId: 3, name: 'Màu sắc', slug: 'mau-sac', dataType: 'SINGLE_SELECT', isRequired: false, isFilterable: true, allowsCustom: false, sortOrder: 0, isActive: true, revision: 4, createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', usage: { referencedProductCount: 0 } };
const response = { definition, option: null, searchReconciliation: { jobId: '19', status: 'PENDING' } };
const option = { id: 8, attributeDefinitionId: 7, value: 'Đỏ', slug: 'do', sortOrder: 0, isActive: true, referencedProductCount: 0 };

describe('attributeWriteApi', () => {
  beforeEach(() => setAccessToken('token', 1));
  it('maps the four write endpoints and sends the exact caller payload without 401 replay', async () => {
    const request = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ ...response, option }).mockResolvedValueOnce({ ...response, option });
    const api = createAttributeWriteApi(request);
    await api.createDefinition(3, { name: 'Màu sắc', slug: 'mau-sac', dataType: 'SINGLE_SELECT', isRequired: false, isFilterable: true, allowsCustom: false, sortOrder: 0, isActive: true });
    await api.patchDefinition(3, 7, { name: 'Màu', expectedRevision: 4 });
    await api.createOption(3, 7, { value: 'Đỏ', slug: 'do', sortOrder: 0, isActive: true, expectedRevision: 4 });
    await api.patchOption(3, 7, 8, { isActive: false, expectedRevision: 4, confirmPolicyChange: true, reason: 'Ngừng sử dụng lựa chọn cũ' });
    expect(request.mock.calls.map(call => [call[0], call[1].method, JSON.parse(call[1].body as string), call[1].retryOnUnauthorized])).toEqual([
      ['/admin/categories/3/attributes', 'POST', expect.objectContaining({ slug: 'mau-sac' }), false],
      ['/admin/categories/3/attributes/7', 'PATCH', { name: 'Màu', expectedRevision: 4 }, false],
      ['/admin/categories/3/attributes/7/options', 'POST', expect.objectContaining({ expectedRevision: 4, slug: 'do' }), false],
      ['/admin/categories/3/attributes/7/options/8', 'PATCH', expect.objectContaining({ expectedRevision: 4, confirmPolicyChange: true }), false],
    ]);
  });
  it('rejects malformed success envelopes as an unknown write outcome', async () => {
    const api = createAttributeWriteApi(vi.fn().mockResolvedValue({ ...response, extra: true }));
    const error = await api.patchDefinition(3, 7, { name: 'Màu', expectedRevision: 4 }).catch(value => value);
    expect(error).toMatchObject({ status: 502, code: 'INVALID_ATTRIBUTE_WRITE_RESPONSE' });
    expect(isUnknownWriteOutcome(error)).toBe(true);
  });
  it.each([
    ['patch definition identity', { ...response, definition: { ...definition, id: 99 } }, 'patchDefinition'],
    ['definition with unrelated option', { ...response, option }, 'patchDefinition'],
    ['missing created option', response, 'createOption'],
    ['wrong option parent', { ...response, option: { ...option, attributeDefinitionId: 99 } }, 'createOption'],
    ['wrong definition parent', { ...response, definition: { ...definition, id: 99 }, option: { ...option, attributeDefinitionId: 99 } }, 'createOption'],
    ['wrong patched option', { ...response, option: { ...option, id: 99 } }, 'patchOption'],
  ] as const)('rejects %s without replay', async (_label, result, operation) => {
    const request = vi.fn().mockResolvedValue(result);
    const api = createAttributeWriteApi(request);
    const pending = operation === 'patchDefinition' ? api.patchDefinition(3, 7, { expectedRevision: 4 })
      : operation === 'createOption' ? api.createOption(3, 7, { value: 'Đỏ', slug: 'do', sortOrder: 0, isActive: true, expectedRevision: 4 })
      : api.patchOption(3, 7, 8, { expectedRevision: 4 });
    await expect(pending).rejects.toMatchObject({ status: 502, code: 'INVALID_ATTRIBUTE_WRITE_RESPONSE' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('accepts a no-op PATCH with unchanged revision', async () => {
    await expect(createAttributeWriteApi(vi.fn().mockResolvedValue(response)).patchDefinition(3, 7, { expectedRevision: 4 }))
      .resolves.toMatchObject({ definition: { id: 7, revision: 4 } });
  });
  it('refreshes after 401 without replaying the write', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('expired', 401));
    const refresh = vi.fn().mockResolvedValue({});
    await expect(createAttributeWriteApi(request, refresh).patchDefinition(3, 7, { name: 'Draft', expectedRevision: 4 }))
      .rejects.toMatchObject({ code: 'ATTRIBUTE_SESSION_REFRESHED' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('discards a refresh if the login identity changes and never replays', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('expired', 401));
    const refresh = vi.fn().mockImplementation(async () => { setAccessToken('other', 2); });
    await expect(createAttributeWriteApi(request, refresh).patchDefinition(3, 7, { expectedRevision: 4 }))
      .rejects.toMatchObject({ name: 'AuthSessionChangedError' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('keeps known 400/409 separate from timeout, network and 5xx uncertainty', () => {
    expect(isUnknownWriteOutcome(new ApiError('validation', 400))).toBe(false);
    expect(isUnknownWriteOutcome(new ApiError('stale', 409))).toBe(false);
    expect(isUnknownWriteOutcome(new ApiError('server', 503))).toBe(true);
    expect(isUnknownWriteOutcome(new TypeError('network'))).toBe(true);
  });
});
