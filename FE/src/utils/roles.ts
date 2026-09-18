import type { User, Role } from '../types/auth';

/**
 * Helper to check if a user has any of the accepted roles.
 * TODO: Mô hình multi-role/capability đang chờ PR nghiệp vụ riêng.
 * Currently, a user has exactly one role. In the future, this helper can be expanded
 * to support an array of roles or complex capabilities.
 */
export function hasRole(user: User | null, acceptedRoles: Role[]): boolean {
  if (!user) return false;
  return acceptedRoles.includes(user.role);
}
