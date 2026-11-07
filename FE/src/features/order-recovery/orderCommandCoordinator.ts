import {
  OrderRecoveryBlockedError,
  type PendingOrderIntent,
  type RecoverableCommand,
  type RecoveryActor,
  type ValidatedCommandAcknowledgement,
  createOrderIntentJournal,
} from "./orderIntentJournal";
import {
  assertSellerResolutionProof,
  type SellerResolution,
} from "../../services/orderResolutionApi";
import type { PreparationCommand } from "../../types/order";

export type VerifiedOrderSession = Readonly<{
  actor: RecoveryActor;
  isActive: boolean;
  version: number;
}>;
export class OrderRecoverySessionChangedError extends Error {
  constructor() {
    super("Phiên tài khoản đã thay đổi. Yêu cầu cũ vẫn được giữ để đối chiếu.");
    this.name = "OrderRecoverySessionChangedError";
  }
}

/** Controller foundation, not a connected HTTP dispatcher.
 * Keep outside panels. Caller MUST derive getSession from verified Auth, and
 * sendValidated MUST validate the complete Backend receipt/result of this exact
 * invocation, not GET detail. No credentials or receipt are persisted here.
 */
export function createOrderCommandCoordinator(options: {
  journal: ReturnType<typeof createOrderIntentJournal>;
  getSession: () => VerifiedOrderSession | null;
  sendValidated: (
    intent: PendingOrderIntent,
  ) => Promise<ValidatedCommandAcknowledgement>;
  resolveValidated?: (intent: PendingOrderIntent) => Promise<SellerResolution>;
}) {
  let busy = false;
  function session(): VerifiedOrderSession {
    const s = options.getSession();
    if (!s?.isActive || !Number.isSafeInteger(s.version) || s.version < 0)
      throw new OrderRecoverySessionChangedError();
    // Snapshot identity: do not retain a mutable Auth object across await.
    return {
      actor: { id: s.actor.id, role: s.actor.role },
      version: s.version,
      isActive: true,
    };
  }
  function assertCurrent(captured: VerifiedOrderSession) {
    const current = session();
    if (
      current.version !== captured.version ||
      current.actor.id !== captured.actor.id ||
      current.actor.role !== captured.actor.role
    )
      throw new OrderRecoverySessionChangedError();
  }
  async function execute(input: {
    orderId: number;
    command: RecoverableCommand;
    confirmed: boolean;
  }): Promise<ValidatedCommandAcknowledgement> {
    if (busy || input.confirmed !== true) throw new OrderRecoveryBlockedError();
    const captured = session();
    busy = true; // Synchronous latch before any Promise/HTTP work.
    try {
      const intent = options.journal.prepare(
        captured.actor,
        input.orderId,
        input.command,
      );
      assertCurrent(captured);
      const receipt = await options.sendValidated(intent);
      // Session changes cannot acknowledge another account or a new login of
      // the same account. Backend may have committed: retain original intent.
      assertCurrent(captured);
      options.journal.acknowledge(captured.actor, intent, receipt);
      return receipt;
    } catch (error) {
      // Late failures belong to the old session too; never surface their raw
      // error as the current account's command result.
      assertCurrent(captured);
      throw error;
    } finally {
      busy = false;
    }
  }
  async function resolve(input: {
    intent: PendingOrderIntent;
    confirmed: boolean;
  }): Promise<SellerResolution> {
    if (busy || input.confirmed !== true || !options.resolveValidated)
      throw new OrderRecoveryBlockedError();
    const captured = session();
    if (captured.actor.role !== "SELLER") throw new OrderRecoveryBlockedError();
    busy = true;
    try {
      // Resolving must NEVER prepare/persist a fresh intent or key.
      const intent = options.journal.pending(captured.actor);
      if (
        !intent ||
        !input.intent ||
        (Object.keys(intent) as (keyof PendingOrderIntent)[]).some(
          (k) => intent[k] !== input.intent[k],
        )
      )
        throw new OrderRecoveryBlockedError();
      assertCurrent(captured);
      const result = await options.resolveValidated(intent);
      assertCurrent(captured);
      assertSellerResolutionProof(result, {
        actorId: captured.actor.id,
        orderId: intent.orderId,
        command: intent.command as PreparationCommand,
        idempotencyKey: intent.idempotencyKey,
      });
      if (result.outcome === "COMMITTED")
        options.journal.acknowledge(captured.actor, intent, result.receipt);
      else options.journal.settleClosedIntent(captured.actor, intent, result);
      return result;
    } catch (error) {
      assertCurrent(captured);
      throw error;
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    execute,
    resolve,
    isBusy: () => busy,
    pending: () => options.journal.pending(session().actor),
  });
}
