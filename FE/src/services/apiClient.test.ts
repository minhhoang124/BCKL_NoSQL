// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError, AuthSessionChangedError, fetchApi, getAccessToken, getAuthSessionVersion,
  refreshSession, setAccessToken, setOnAuthFailure,
} from './apiClient';
import type { SessionResponse } from '../types/auth';

const session = (id: number, accessToken: string): SessionResponse => ({
  accessToken, user: { id, email: `buyer${id}@example.test`, fullName: 'QA', role: 'USER', isActive: true },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const address = { recipientName: 'A private address', phone: '0900000000', province: 'QA', ward: 'QA', addressLine: 'QA' };

const createAddress = () => fetchApi<{ id: number }>('/me/addresses', { method: 'POST', body: JSON.stringify(address) });

beforeEach(() => { setOnAuthFailure(null); setAccessToken('a-old', 1); });
afterEach(() => { setOnAuthFailure(null); setAccessToken(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('API session isolation', () => {
  it('preserves the Backend business error code without retrying the write', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ message: 'Giá đã thay đổi', code: 'PRICE_CHANGED' }, 409));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchApi('/checkouts', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 409, code: 'PRICE_CHANGED', message: 'Giá đã thay đổi',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, { message: null, code: { unsafe: true } }])('handles malformed error envelopes safely (%j)', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(body, 503)));
    await expect(fetchApi('/checkout/preview', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 503, code: undefined, message: 'Yêu cầu thất bại (503)',
    });
  });

  it('bounds stalled shared refresh and never replays the write after timeout', async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const started = deferred<void>();
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401)).mockImplementationOnce((_url, options: RequestInit) => {
      started.resolve();
      return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort',
        () => reject(options.signal!.reason), { once: true }));
    });
    vi.stubGlobal('fetch', fetch);
    const result = expect(createAddress()).rejects.toMatchObject({ name: 'TimeoutError' });
    await started.promise;
    expect(timeoutSpy).toHaveBeenCalledWith(15000);
    timeout.abort(new DOMException('Refresh timed out', 'TimeoutError'));
    await result;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBeNull();
  });

  it('retains business error codes on the one permitted same-session retry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json(session(1, 'a-new')))
      .mockResolvedValueOnce(json({ message: 'Đang đối chiếu', code: 'CHECKOUT_IN_PROGRESS' }, 409));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchApi('/checkouts', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 409, code: 'CHECKOUT_IN_PROGRESS',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE', 'GET'])('never refreshes/replays a delayed %s 401 under B', async method => {
    const delayed = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(delayed.promise);
    vi.stubGlobal('fetch', fetch);
    const request = fetchApi('/me/addresses', { method });
    const outcome = expect(request).rejects.toBeInstanceOf(AuthSessionChangedError);
    setAccessToken(null); setAccessToken('b', 2);
    delayed.resolve(json({}, 401));
    await outcome;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('b');
  });

  it('protects a personal-data POST during an A -> B switch', async () => {
    const delayed = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(delayed.promise);
    vi.stubGlobal('fetch', fetch);
    const request = createAddress();
    const outcome = expect(request).rejects.toBeInstanceOf(AuthSessionChangedError);
    setAccessToken(null); setAccessToken('b', 2); delayed.resolve(json({}, 401));
    await outcome;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(address));
  });

  it('blocks a delayed 401 after logout without login', async () => {
    const delayed = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(delayed.promise); vi.stubGlobal('fetch', fetch);
    const result = expect(fetchApi('/cart')).rejects.toBeInstanceOf(AuthSessionChangedError);
    setAccessToken(null); delayed.resolve(json({}, 401)); await result;
    expect(fetch).toHaveBeenCalledTimes(1); expect(getAccessToken()).toBeNull();
  });

  it('rejects old responses even after logging back into the same account', async () => {
    const delayed = deferred<Response>(); vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(delayed.promise));
    const result = expect(fetchApi('/me/addresses')).rejects.toBeInstanceOf(AuthSessionChangedError);
    setAccessToken(null); setAccessToken('a-new-login', 1); delayed.resolve(json({ items: [] }));
    await result; expect(getAccessToken()).toBe('a-new-login');
  });

  it.each(['success', '401', 'network'])('stale refresh %s does not replace/clear B or retry A', async outcome => {
    const delayed = deferred<Response>(); const started = deferred<void>();
    const failure = vi.fn(); setOnAuthFailure(failure);
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401)).mockImplementationOnce(() => { started.resolve(); return delayed.promise; });
    vi.stubGlobal('fetch', fetch);
    const request = expect(createAddress()).rejects.toBeInstanceOf(AuthSessionChangedError);
    await started.promise;
    const signal = fetch.mock.calls[1][1].signal as AbortSignal;
    setAccessToken(null); setAccessToken('b', 2);
    expect(signal.aborted).toBe(true);
    // Simulate a transport that completes despite cancellation; the epoch guard
    // must be sufficient even without AbortController cooperation.
    if (outcome === 'network') delayed.reject(new Error('offline'));
    else delayed.resolve(outcome === '401' ? json({}, 401) : json(session(1, 'a-refreshed')));
    await request;
    expect(getAccessToken()).toBe('b'); expect(failure).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a refreshed cookie belonging to a different Buyer without replay', async () => {
    const failure = vi.fn(); setOnAuthFailure(failure);
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(session(2, 'b')));
    vi.stubGlobal('fetch', fetch);
    await expect(createAddress()).rejects.toBeInstanceOf(AuthSessionChangedError);
    expect(fetch).toHaveBeenCalledTimes(2); expect(getAccessToken()).toBeNull();
    expect(failure).toHaveBeenCalledOnce();
  });

  it('still refreshes and retries once for the same Buyer without changing epoch', async () => {
    const version = getAuthSessionVersion();
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(session(1, 'a-new'))).mockResolvedValueOnce(json({ id: 7 }, 201));
    vi.stubGlobal('fetch', fetch);
    await expect(createAddress()).resolves.toEqual({ id: 7 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][1].headers.get('Authorization')).toBe('Bearer a-new');
    expect(fetch.mock.calls[2][1].body).toBe(JSON.stringify(address));
    expect(getAuthSessionVersion()).toBe(version); expect(getAccessToken()).toBe('a-new');
  });

  it('shares one refresh for concurrent requests within the same session', async () => {
    const delayed = deferred<Response>(); const started = deferred<void>(); let expired = 0;
    const fetch = vi.fn().mockImplementation((url: string, options: RequestInit) => {
      if (url.endsWith('/auth/refresh')) { started.resolve(); return delayed.promise; }
      if (new Headers(options.headers).get('Authorization') === 'Bearer a-old') { ++expired; return Promise.resolve(json({}, 401)); }
      return Promise.resolve(json({ items: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const requests = [fetchApi('/cart'), fetchApi('/me/addresses')];
    await started.promise; await vi.waitFor(() => expect(expired).toBe(2));
    delayed.resolve(json(session(1, 'a-new')));
    await expect(Promise.all(requests)).resolves.toHaveLength(2);
    expect(fetch.mock.calls.filter(call => call[0].endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('old completion cannot release the new session refresh flight', async () => {
    const old = deferred<Response>(), fresh = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise); vi.stubGlobal('fetch', fetch);
    const oldResult = expect(refreshSession()).rejects.toBeInstanceOf(AuthSessionChangedError);
    setAccessToken('b', 2); const current = refreshSession();
    old.resolve(json(session(1, 'a-new'))); await oldResult;
    expect(refreshSession()).toBe(current); expect(fetch).toHaveBeenCalledTimes(2);
    fresh.resolve(json(session(2, 'b-new'))); await current; expect(getAccessToken()).toBe('b-new');
  });

  it('does not start a refresh for an already-stale caller version', async () => {
    const version = getAuthSessionVersion(); setAccessToken('b', 2);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(refreshSession(version)).rejects.toBeInstanceOf(AuthSessionChangedError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not refresh an aborted request even if its late response is 401', async () => {
    const delayed = deferred<Response>(); const controller = new AbortController();
    const fetch = vi.fn().mockReturnValueOnce(delayed.promise); vi.stubGlobal('fetch', fetch);
    const result = expect(fetchApi('/me/addresses', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); delayed.resolve(json({}, 401)); await result;
    expect(fetch).toHaveBeenCalledTimes(1); expect(getAccessToken()).toBe('a-old');
  });

  it('does not clear a new session when a retry response arrives late', async () => {
    const delayed = deferred<Response>(); const started = deferred<void>();
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(session(1, 'a-new'))).mockImplementationOnce(() => { started.resolve(); return delayed.promise; });
    vi.stubGlobal('fetch', fetch);
    const result = expect(fetchApi('/cart')).rejects.toBeInstanceOf(AuthSessionChangedError);
    await started.promise; setAccessToken('b', 2); delayed.resolve(json({ items: [] })); await result;
    expect(getAccessToken()).toBe('b');
  });

  it('clears only the current session on genuine refresh failure', async () => {
    const failure = vi.fn(); setOnAuthFailure(failure);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 401)));
    await expect(refreshSession()).rejects.toBeInstanceOf(ApiError);
    expect(failure).toHaveBeenCalledOnce(); expect(getAccessToken()).toBeNull();
  });

  it('never retries the retry or auth endpoint when retry is disabled', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(session(1, 'a-new'))).mockResolvedValueOnce(json({}, 401));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchApi('/cart')).rejects.toMatchObject({ status: 401 }); expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockClear().mockResolvedValueOnce(json({}, 401));
    await expect(fetchApi('/auth/login', { retryOnUnauthorized: false })).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
