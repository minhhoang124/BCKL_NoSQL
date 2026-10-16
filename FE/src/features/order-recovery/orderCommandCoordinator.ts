import {
  OrderRecoveryBlockedError,
  type PendingOrderIntent,
  type RecoverableCommand,
  type RecoveryActor,
  type ValidatedCommandAcknowledgement,
  createOrderIntentJournal,
} from "./orderIntentJournal";

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
  return Object.freeze({
    execute,
    isBusy: () => busy,
    pending: () => options.journal.pending(session().actor),
  });
}
