// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressApi } from './addressApi';
import { setAccessToken } from './apiClient';

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });
describe('Address HTTP adapter', () => {
  it('uses auth, no-store, correct routes/body and tolerates DELETE 204', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch); setAccessToken('test-access');
    const controller = new AbortController(); await addressApi.list(controller.signal);
    expect(fetch.mock.calls[0][0]).toMatch(/\/me\/addresses$/);
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store', signal: controller.signal });
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-access');
    const body = { recipientName: 'Test', phone: '0901234567', province: 'Test', ward: 'Test', addressLine: 'Test', district: null };
    await addressApi.create(body); await addressApi.update(7, { district: null }); await addressApi.setDefault(7);
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify(body) });
    expect(fetch.mock.calls[2][0]).toMatch(/\/me\/addresses\/7$/);
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'PATCH', body: '{"district":null}' });
    expect(fetch.mock.calls[3][0]).toMatch(/\/me\/addresses\/7\/default$/);
    expect(fetch.mock.calls[3][1]).toMatchObject({ method: 'PUT', body: '{}' });
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(addressApi.remove(7)).resolves.toBeUndefined(); expect(fetch.mock.calls[4][1].method).toBe('DELETE');
  });

  it('retains server status/message instead of replacing a business error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ statusCode: 409, code: 'ADDRESS_LIMIT_REACHED', message: 'Đã đạt giới hạn địa chỉ.' }), { status: 409 })));
    await expect(addressApi.create({ recipientName: 'Test', phone: '0901234567', province: 'Test', ward: 'Test', addressLine: 'Test' })).rejects.toMatchObject({ status: 409, message: 'Đã đạt giới hạn địa chỉ.' });
  });

  it('uses the existing single-flight refresh before retrying an expired session', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'renewed', user: { id: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(addressApi.list()).resolves.toEqual({ items: [] });
    expect(fetch.mock.calls[1][0]).toMatch(/\/auth\/refresh$/);
    expect(fetch.mock.calls[2][1].headers.get('Authorization')).toBe('Bearer renewed');
  });
});
