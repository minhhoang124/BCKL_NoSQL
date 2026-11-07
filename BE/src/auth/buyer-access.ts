import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/** Explicit opt-in: USER is a Buyer context, not a role hierarchy. */
export const BUYER_ACCESS_KEY = 'buyer-access';
export const BuyerAccess = () => SetMetadata(BUYER_ACCESS_KEY, true);

// Phase A only. Default off until the cross-role runtime suite and review pass.
// DB role is always read again by the transaction; JWT claims grant nothing here.
export function canActAsBuyer(
  role: unknown,
  enabled = process.env.ACCOUNT_BUYER_ACCESS_ENABLED === 'true',
): boolean {
  return role === Role.USER || (enabled && role === Role.SELLER);
}
