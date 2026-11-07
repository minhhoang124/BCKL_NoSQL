import { UnauthorizedException } from '@nestjs/common';

/** Check AFTER taking the existing actor User row lock, before replay or writes.
 * HTTP callers always supply the credentialVersion from the verified JWT actor.
 * Undefined is reserved for trusted internal service calls (legacy fixtures and
 * scheduler paths); controllers pass 0 if an authenticated actor lacks an epoch,
 * which deliberately fails closed. Never derive the expectation from fresh DB.
 */
export function assertCurrentWriteEpoch(
  actor: { credentialVersion: number } | null,
  expectedCredentialVersion?: number,
): void {
  if (expectedCredentialVersion === undefined) return;
  if (
    !Number.isInteger(expectedCredentialVersion) ||
    expectedCredentialVersion < 1 ||
    expectedCredentialVersion > 2147483647 ||
    !actor || actor.credentialVersion !== expectedCredentialVersion
  ) {
    throw new UnauthorizedException({
      code: 'AUTH_SESSION_REVOKED',
      message: 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.',
    });
  }
}
