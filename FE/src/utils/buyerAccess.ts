import type { User } from '../types/auth';

/** UI hint only. Backend independently verifies current role and ownership. */
export function hasBuyerAccess(user: User | null): boolean {
  return Boolean(user?.isActive && (user.role === 'USER' ||
    (import.meta.env.VITE_ACCOUNT_BUYER_ACCESS_ENABLED === 'true' && user.role === 'SELLER')));
}
