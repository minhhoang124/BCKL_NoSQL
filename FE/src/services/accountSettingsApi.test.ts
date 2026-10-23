import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changePassword, updateProfile } from './accountSettingsApi';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./apiClient', async load => ({ ...await load<typeof import('./apiClient')>(), fetchApi: mocks.fetch }));
const owner = { id: 1, email: 'a@example.test', role: 'USER' as const, isActive: true, fullName: 'Original Name' };
const response = { ...owner, fullName: 'New Name', createdAt: '2026-01-01T00:00:00.000Z' };
beforeEach(() => vi.clearAllMocks());
describe('Account settings strict adapter', () => {
  it('sends CAS snapshot and never auto-refreshes/replays mutation on401', async () => {
    mocks.fetch.mockResolvedValue(response); expect(await updateProfile('New Name','Original Name',owner,new AbortController().signal)).toEqual({ ...owner, fullName: 'New Name' });
    expect(mocks.fetch).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ retryOnUnauthorized: false, method: 'PATCH', body: JSON.stringify({ fullName: 'New Name', expectedFullName: 'Original Name' }) }));
  });
  it.each([{ ...response, id: 2 }, { ...response, role: 'ADMIN' }, { ...response, passwordHash: 'secret' }, { ...response, fullName: 'Other' }, { ...response, isActive: false }, {}, null])('rejects wrong-owner/malformed response %#', async value => { mocks.fetch.mockResolvedValue(value); await expect(updateProfile('New Name',null,owner,new AbortController().signal)).rejects.toThrow(); });
  it('accepts exact password acknowledgement', async () => { mocks.fetch.mockResolvedValue({ status: 'PASSWORD_CHANGED', reauthenticationRequired: true }); await changePassword('old','new',new AbortController().signal); expect(mocks.fetch).toHaveBeenCalledWith('/auth/password',expect.objectContaining({ retryOnUnauthorized: false })); });
  it.each([{}, { status: 'PASSWORD_CHANGED', reauthenticationRequired: false }, { status: 'PASSWORD_CHANGED', reauthenticationRequired: true, accessToken: 'unexpected' }, null])('rejects malformed acknowledgement %#', async value => { mocks.fetch.mockResolvedValue(value); await expect(changePassword('old','new',new AbortController().signal)).rejects.toThrow(); });
});
