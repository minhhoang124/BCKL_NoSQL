import { ApiError, fetchApi } from './apiClient';
import type { User } from '../types/auth';
export async function updateProfile(fullName: string, expectedFullName: string | null, owner: User, signal: AbortSignal): Promise<User> {
  const data = await fetchApi<unknown>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ fullName, expectedFullName }), retryOnUnauthorized: false, signal });
  if (!data || typeof data !== 'object') throw new ApiError('Phản hồi hồ sơ không hợp lệ');
  const user = data as Record<string, unknown>;
  if (user.id !== owner.id || user.email !== owner.email || user.role !== owner.role || user.isActive !== true || typeof user.fullName !== 'string' ||
      user.fullName !== fullName.normalize('NFC').trim() || typeof user.createdAt !== 'string' || !Number.isFinite(Date.parse(user.createdAt)) ||
      Object.keys(user).some(key => !['id', 'email', 'role', 'isActive', 'fullName', 'createdAt'].includes(key))) throw new ApiError('Phản hồi hồ sơ không hợp lệ');
  return { ...owner, fullName: user.fullName };
}
export async function changePassword(currentPassword: string, newPassword: string, signal: AbortSignal): Promise<void> {
  const data = await fetchApi<unknown>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }), retryOnUnauthorized: false, signal });
  if (!data || typeof data !== 'object' || Object.keys(data).length !== 2 ||
      !('status' in data) || data.status !== 'PASSWORD_CHANGED' || !('reauthenticationRequired' in data) || data.reauthenticationRequired !== true)
    throw new ApiError('Chưa xác minh được kết quả đổi mật khẩu');
}
