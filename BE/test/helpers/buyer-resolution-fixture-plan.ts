import { prepareOrderCommand } from '../../src/order/order-command-request.js';
import { completeInput } from '../../src/order/order-completion-request.js';
import { assertOrderResolutionQaTarget } from './order-resolution-qa-target.js';

type FixtureIdentity = Readonly<{
  actorId: number;
  orderId: number;
  idempotencyKey: string;
}>;

/** TEST ONLY: original command inputs, not a resolver DTO or seeded DB state.
 * IDs must be obtained from the isolated test fixture, never a demo database.
 * This function does not connect, seed, send HTTP, close a key or grant rights.
 */
export function buyerCancellationFixtureInput(
  identity: FixtureIdentity,
  reason: Readonly<{
    reasonCode: 'CHANGED_MIND' | 'OTHER';
    reasonText: string;
  }>,
) {
  return prepareOrderCommand({
    ...identity,
    actorType: 'BUYER',
    command: 'cancel',
    body: reason,
  });
}

export function buyerCompletionFixtureInput(identity: FixtureIdentity) {
  return completeInput(
    identity.actorId,
    identity.orderId,
    identity.idempotencyKey,
    {},
  );
}

/** Validates the address ONLY; does not prove migration, credentials or DB
 * readiness. Reuses the existing strict loopback:5549 isolated namespace guard.
 * Call before any future fixture bootstrap/DB writes. No CI/demo bypass here.
 */
export function buyerResolutionFixtureTarget(raw: string | undefined): void {
  assertOrderResolutionQaTarget(raw);
}
