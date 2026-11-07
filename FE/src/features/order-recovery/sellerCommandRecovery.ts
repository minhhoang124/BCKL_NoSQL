import { getAuthSessionVersion } from "../../services/apiClient";
import {
  prepareSellerCommand,
  sendSellerCommand,
} from "../../services/orderApi";
import type { PreparationCommand } from "../../types/order";
import { PREPARATION_COMMANDS } from "../../types/order";
import {
  prepareSellerResolution,
  sendSellerResolution,
} from "../../services/orderResolutionApi";
import {
  createOrderCommandCoordinator,
  OrderRecoverySessionChangedError,
  type VerifiedOrderSession,
} from "./orderCommandCoordinator";
import {
  createOrderIntentJournal,
  OrderRecoveryBlockedError,
} from "./orderIntentJournal";

/** Preparation bridge only; NOT mounted by a route and never automatically sends.
 * Caller owns one stable instance per verified session, confirmation and fresh GET.
 * Unknown/rejected results keep the old intent; resolve requires explicit confirmation.
 */
export function createSellerCommandRecovery(options: {
  storage: Parameters<typeof createOrderIntentJournal>[0];
  getSession: () => VerifiedOrderSession | null;
}) {
  const session = () => {
    const current = options.getSession();
    if (
      !current?.isActive ||
      current.actor.role !== "SELLER" ||
      current.version !== getAuthSessionVersion()
    )
      throw new OrderRecoverySessionChangedError();
    return current;
  };
  const journal = createOrderIntentJournal(options.storage);
  const coordinator = createOrderCommandCoordinator({
    journal,
    getSession: session,
    resolveValidated: async (intent) => {
      session();
      return sendSellerResolution(
        prepareSellerResolution({
          actorId: intent.actorId,
          orderId: intent.orderId,
          command: intent.command as PreparationCommand,
          idempotencyKey: intent.idempotencyKey,
        }),
      );
    },
    sendValidated: async (intent) => {
      const current = session();
      if (
        intent.role !== "SELLER" ||
        intent.actorId !== current.actor.id ||
        !PREPARATION_COMMANDS.includes(intent.command as PreparationCommand)
      )
        throw new OrderRecoveryBlockedError();
      // A persisted JSON object is not a WeakSet handle. Re-create a handle
      // under the current verified session, retaining the ORIGINAL key/body.
      const handle = prepareSellerCommand(
        intent.orderId,
        intent.command as PreparationCommand,
        intent.actorId,
        intent.idempotencyKey,
      );
      const receipt = await sendSellerCommand(handle);
      // Full runtime receipt validation already happened in orderApi. GET detail
      // or a typed object must never substitute for this acknowledgement.
      return {
        orderId: receipt.orderId,
        command: receipt.command,
        commandId: receipt.commandId,
      };
    },
  });
  return Object.freeze({
    pending: coordinator.pending,
    isBusy: coordinator.isBusy,
    resolve: coordinator.resolve,
    execute: (input: {
      orderId: number;
      command: PreparationCommand;
      confirmed: boolean;
    }) => {
      if (!PREPARATION_COMMANDS.includes(input.command))
        return Promise.reject(new OrderRecoveryBlockedError());
      return coordinator.execute(input);
    },
  });
}
