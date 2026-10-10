import type { SessionResponse } from '../types/auth';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let memoryToken: string | null = null;
let memoryUserId: number | null = null;
let authSessionVersion = 0;
let refreshFlight: { version: number; promise: Promise<SessionResponse>; controller: AbortController } | null = null;
let _onAuthFailure: (() => void) | null = null;

/** Explicit login/logout boundary. Token rotation inside refresh is NOT a new session. */
export const setAccessToken = (token: string | null, userId?: number) => {
  ++authSessionVersion;
  refreshFlight?.controller.abort();
  refreshFlight = null;
  memoryToken = token;
  memoryUserId = token ? userId ?? null : null;
};

export const getAccessToken = () => memoryToken;
export const getAuthSessionVersion = () => authSessionVersion;

export const setOnAuthFailure = (callback: (() => void) | null) => {
  _onAuthFailure = callback;
};

export class ApiError extends Error {
  public status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export class AuthSessionChangedError extends ApiError {
  constructor() {
    super('Phiên đăng nhập đã thay đổi. Yêu cầu cũ đã bị dừng; vui lòng thao tác lại trong tài khoản hiện tại.');
    this.name = 'AuthSessionChangedError';
  }
}

function assertSession(version: number) {
  if (version !== authSessionVersion) throw new AuthSessionChangedError();
}

/**
 * Handle HTTP response and parse JSON.
 */
async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new ApiError(message || `Yêu cầu thất bại (${response.status})`, response.status);
  }
  return data as T;
}

/**
 * Perform token refresh single-flight.
 */
export function refreshSession(version = authSessionVersion): Promise<SessionResponse> {
  if (version !== authSessionVersion) return Promise.reject(new AuthSessionChangedError());
  if (refreshFlight?.version === version) return refreshFlight.promise;

  const ownerId = memoryUserId;
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        signal: controller.signal,
      });
      const session = await parseResponse<SessionResponse>(response);
      assertSession(version);
      // A cookie may also change in another tab. Never replay an actor's request
      // using a refresh response belonging to a different account.
      if (ownerId !== null && session.user.id !== ownerId) throw new AuthSessionChangedError();
      memoryToken = session.accessToken;
      memoryUserId = session.user.id;
      return session;
    } catch (error) {
      // A stale refresh must not clear the new user's token or React state.
      assertSession(version);
      setAccessToken(null);
      if (_onAuthFailure) {
        _onAuthFailure();
      }
      throw error;
    }
  })();
  const flight = { version, promise, controller };
  refreshFlight = flight;
  const finish = () => { if (refreshFlight === flight) refreshFlight = null; };
  // Identity check prevents an old completion from removing B's active flight.
  void promise.then(finish, finish);
  return promise;
}

export interface ApiRequestOptions extends RequestInit {
  retryOnUnauthorized?: boolean;
}

/**
 * Generic API client
 */
export async function fetchApi<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
  const version = authSessionVersion;
  const { retryOnUnauthorized = true, ...restOptions } = options;

  const headers = new Headers(restOptions.headers);
  if (!headers.has('Content-Type') && !(restOptions.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const config: RequestInit = {
    ...restOptions,
    headers,
    credentials: 'include',
  };

  try {
    const response = await fetch(`${API_URL}${endpoint}`, config);
    const data = await parseResponse<T>(response);
    assertSession(version);
    return data;
  } catch (error) {
    assertSession(version);
    if (retryOnUnauthorized && error instanceof ApiError && error.status === 401) {
      restOptions.signal?.throwIfAborted();
      if (endpoint === '/auth/refresh') {
        throw error;
      }

      const session = await refreshSession(version);
      assertSession(version);
      restOptions.signal?.throwIfAborted();
      headers.set('Authorization', `Bearer ${session.accessToken}`);
      const retryResponse = await fetch(`${API_URL}${endpoint}`, { ...config, headers });
      const data = await parseResponse<T>(retryResponse);
      assertSession(version);
      return data;
    }

    throw error;
  }
}
