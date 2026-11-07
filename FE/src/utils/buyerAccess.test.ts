import { afterEach, expect, it, vi } from 'vitest';
import type { User } from '../types/auth';
import { hasBuyerAccess } from './buyerAccess';
const user: User = { id: 7, email: 'qa@example.test', fullName: null, role: 'USER', isActive: true };
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, 'false', '', 'TRUE', '1'])('does not enable Seller buying for %s', flag => {
  vi.stubEnv('VITE_ACCOUNT_BUYER_ACCESS_ENABLED', flag);
  expect(hasBuyerAccess({ ...user, role: 'SELLER' })).toBe(false);
  expect(hasBuyerAccess(user)).toBe(true);
});
it('explicit true adds Buyer access without changing the real role or allowing Admin/inactive', () => {
  vi.stubEnv('VITE_ACCOUNT_BUYER_ACCESS_ENABLED', 'true');
  const seller = { ...user, role: 'SELLER' as const };
  expect(hasBuyerAccess(seller)).toBe(true);
  expect(seller.role).toBe('SELLER');
  expect(hasBuyerAccess({ ...seller, isActive: false })).toBe(false);
  expect(hasBuyerAccess({ ...user, role: 'ADMIN' })).toBe(false);
  expect(hasBuyerAccess(null)).toBe(false);
});
