import { describe, expect, it, vi } from 'vitest';
import { ApiError, AuthSessionChangedError, setAccessToken } from '../../services/apiClient';
import { createSystemHealthApi, parseAdminSystemHealth } from './systemHealthApi';
import { readyHealth, unknownHealth } from './systemHealth.fixtures';

describe('Admin system health API adapter', () => {
  it('calls only the Backend Admin endpoint with a bounded no-store read', async () => {
    const request = vi.fn().mockResolvedValue(unknownHealth);
    await expect(createSystemHealthApi(request).read()).resolves.toMatchObject({ search: { status: 'UNKNOWN' } });
    expect(request).toHaveBeenCalledWith('/admin/system-health', expect.objectContaining({
      method: 'GET', cache: 'no-store', retryOnUnauthorized: false, signal: expect.any(AbortSignal),
    }));
    expect(request.mock.calls[0][0]).not.toMatch(/internal|elasticsearch|faiss/i);
  });

  it('accepts the v1 Backend projection and keeps zero/vector metadata explicit', () => {
    const parsed = parseAdminSystemHealth(readyHealth);
    expect(parsed.search.snapshot?.components.faiss.vectorCount).toBe(86);
    expect(parsed.search.snapshot?.components.elasticsearch.readable).toBe(true);
  });

  it('rejects missing or extra fields instead of painting an invalid response green', () => {
    expect(() => parseAdminSystemHealth({ ...unknownHealth, secret: 'no' })).toThrow(ApiError);
    expect(() => parseAdminSystemHealth({ ...unknownHealth, search: { ...unknownHealth.search, status: 'OK' } })).toThrow(ApiError);
  });

  it('drops a response that belongs to an earlier login session', async () => {
    let finish!: (value: unknown) => void;
    const request = vi.fn(() => new Promise<unknown>((resolve) => { finish = resolve; }));
    setAccessToken('session-a', 1);
    const pending = createSystemHealthApi(request).read();
    setAccessToken('session-b', 2);
    finish(unknownHealth);
    await expect(pending).rejects.toBeInstanceOf(AuthSessionChangedError);
    setAccessToken(null);
  });
});
