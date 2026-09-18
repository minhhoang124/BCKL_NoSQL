import type { SessionResponse } from '../types/auth';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let memoryToken: string | null = null;
let refreshPromise: Promise<SessionResponse> | null = null;
let _onAuthFailure: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  memoryToken = token;
};

export const getAccessToken = () => memoryToken;

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
export function refreshSession(): Promise<SessionResponse> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
        const session = await parseResponse<SessionResponse>(response);
        setAccessToken(session.accessToken);
        return session;
      } catch (error) {
        setAccessToken(null);
        if (_onAuthFailure) {
          _onAuthFailure();
        }
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export interface ApiRequestOptions extends RequestInit {
  retryOnUnauthorized?: boolean;
}

/**
 * Generic API client
 */
export async function fetchApi<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
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
    return await parseResponse<T>(response);
  } catch (error) {
    if (retryOnUnauthorized && error instanceof ApiError && error.status === 401) {
      if (endpoint === '/auth/refresh') {
        throw error;
      }

      const session = await refreshSession();
      headers.set('Authorization', `Bearer ${session.accessToken}`);
      const retryResponse = await fetch(`${API_URL}${endpoint}`, { ...config, headers });
      return await parseResponse<T>(retryResponse);
    }

    throw error;
  }
}
