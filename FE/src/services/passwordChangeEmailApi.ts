import { ApiError, fetchApi } from './apiClient';

/**
 * BUY-02 email-confirmed password change (BE: POST /auth/password-change/*).
 * Every call is a write-or-check against a one-time token: never auto-retry,
 * including the refresh-on-401 replay, and never log token/binding values.
 */
export type PasswordChangeMode = 'DIRECT' | 'EMAIL';
export function passwordChangeMode(raw = import.meta.env.VITE_AUTH_PASSWORD_CHANGE_MODE): PasswordChangeMode {
  return raw === 'EMAIL' ? 'EMAIL' : 'DIRECT';
}

const SECRET = /^[A-Za-z0-9_-]{43}$/;
export const isOpaqueSecret = (value: unknown): value is string => typeof value === 'string' && SECRET.test(value);
const timestamp = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
function exact(data: unknown, keys: string[]): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== [...keys].sort().join(','))
    throw new ApiError('Phản hồi đổi mật khẩu không hợp lệ');
  return data as Record<string, unknown>;
}

export type PasswordChangeRequested = { email: string; expiresAt: string; bindingSecret: string };
export async function requestPasswordChangeEmail(currentPassword: string, signal: AbortSignal): Promise<PasswordChangeRequested> {
  const data = exact(
    await fetchApi<unknown>('/auth/password-change/request', {
      method: 'POST', body: JSON.stringify({ currentPassword, confirmed: true }), retryOnUnauthorized: false, signal,
    }),
    ['status', 'email', 'expiresAt', 'bindingSecret'],
  );
  if (data.status !== 'CHANGE_EMAIL_SENT' || typeof data.email !== 'string' || !/^[^@\s]{0,64}\*{3}@[^@\s]{1,255}$/.test(data.email) ||
      !timestamp(data.expiresAt) || !isOpaqueSecret(data.bindingSecret))
    throw new ApiError('Phản hồi đổi mật khẩu không hợp lệ');
  return { email: data.email, expiresAt: data.expiresAt as string, bindingSecret: data.bindingSecret };
}

export async function verifyPasswordChangeLink(token: string, bindingSecret: string, signal: AbortSignal): Promise<{ expiresAt: string }> {
  const data = exact(
    await fetchApi<unknown>('/auth/password-change/verify', {
      method: 'POST', body: JSON.stringify({ token, bindingSecret }), retryOnUnauthorized: false, signal,
    }),
    ['status', 'expiresAt'],
  );
  if (data.status !== 'VALID' || !timestamp(data.expiresAt)) throw new ApiError('Phản hồi đổi mật khẩu không hợp lệ');
  return { expiresAt: data.expiresAt as string };
}

export async function confirmPasswordChange(token: string, bindingSecret: string, newPassword: string, signal: AbortSignal): Promise<void> {
  const data = exact(
    await fetchApi<unknown>('/auth/password-change/confirm', {
      method: 'POST', body: JSON.stringify({ token, bindingSecret, newPassword, confirmed: true }), retryOnUnauthorized: false, signal,
    }),
    ['status', 'reauthenticationRequired'],
  );
  if (data.status !== 'PASSWORD_CHANGED' || data.reauthenticationRequired !== true)
    throw new ApiError('Chưa xác minh được kết quả đổi mật khẩu');
}
