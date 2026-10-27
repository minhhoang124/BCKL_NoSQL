import { cancellableUnpaidPayment } from '../vnpay/paymentPolicy';
import { getAuthSessionVersion } from "../../services/apiClient";
import { orderApi } from "../../services/orderApi";
import {
  validateOrderDetail,
  validOrderId,
} from "../../services/orderResponse";
import {
  sendBuyerResolution,
  type BuyerResolution,
} from "../../services/buyerResolutionApi";
import { sendBuyerCommand } from "../../services/buyerCommandApi";
import {
  normalizeBuyerCommand,
  type BuyerCommand,
} from "./buyerCommandFingerprint";
import type { OrderDetail } from "../../types/order";
import {
  createBuyerSettlementJournal,
  type BuyerPendingIntent,
} from "./buyerIntentJournal";
import { OrderRecoveryBlockedError } from "./orderIntentJournal";
import {
  OrderRecoverySessionChangedError,
  type VerifiedOrderSession,
} from "./orderCommandCoordinator";

export type BuyerRecoveryState = Readonly<
  | { phase: "confirm-resolution" | "resolving" | "executing" | "blocked" }
  | {
      phase: "committed" | "closed";
      outcome: BuyerResolution;
      order: OrderDetail;
    }
  | {
      phase: "committed-refresh-error" | "closed-refresh-error";
      outcome: BuyerResolution;
    }
>;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Unmounted client runtime. No route/button, automatic execute/resolve,
 * fresh key, Backend/schema change or raw cancellation body persistence.
 * Create one instance for the current verified Auth session/view; dispose on
 * unmount. Unknown outcomes retain the journal; settled outcomes permit GET only.
 */
function createBuyerCommandLifecycle(options: {
  getStorage: Parameters<typeof createBuyerSettlementJournal>[0]["getStorage"];
  getSession: () => VerifiedOrderSession | null;
}) {
  function session(): VerifiedOrderSession {
    const s = options.getSession();
    if (
      !s?.isActive ||
      s.actor.role !== "USER" ||
      !validOrderId(s.actor.id) ||
      !Number.isSafeInteger(s.version) ||
      s.version < 0 ||
      s.version !== getAuthSessionVersion()
    )
      throw new OrderRecoverySessionChangedError();
    return Object.freeze({
      actor: Object.freeze({ ...s.actor }),
      version: s.version,
      isActive: true,
    });
  }
  const owner = session();
  let active = true,
    busy = false;
  const journal = createBuyerSettlementJournal({
    ...options,
    getSession: () => (active ? options.getSession() : null),
  });
  let state: BuyerRecoveryState = Object.freeze({
    phase: "confirm-resolution",
  });
  let settled: Readonly<{
    result: BuyerResolution;
    orderId: number;
    total: string;
  }> | null = null;
  let flight: AbortController | null = null;
  function current() {
    const s = session();
    if (!active || s.actor.id !== owner.actor.id || s.version !== owner.version)
      throw new OrderRecoverySessionChangedError();
  }
  function pending() {
    current();
    return journal.pending();
  }
  async function refreshSettled(): Promise<BuyerRecoveryState> {
    current();
    const known = settled;
    if (!known) throw new OrderRecoveryBlockedError();
    const committed = known.result.outcome === "COMMITTED";
    flight = new AbortController();
    try {
      if (journal.pending() !== null) throw new OrderRecoveryBlockedError();
      const order = await orderApi.detail(
        "buyer",
        known.orderId,
        flight.signal,
      );
      current();
      if (journal.pending() !== null || order.total !== known.total)
        throw new OrderRecoveryBlockedError();
      state = freeze({
        phase: committed ? "committed" : "closed",
        outcome: known.result,
        order,
      });
    } catch {
      current();
      // Settlement already succeeded. Read failures must never send resolve or
      // execute again, fabricate a new pending intent, or discard the outcome.
      state = freeze({
        phase: committed ? "committed-refresh-error" : "closed-refresh-error",
        outcome: known.result,
      });
    } finally {
      flight = null;
    }
    return state;
  }
  async function resolve(input: {
    intent: BuyerPendingIntent;
    order: unknown;
    confirmed: boolean;
  }): Promise<BuyerRecoveryState> {
    current();
    if (busy || settled || input.confirmed !== true)
      throw new OrderRecoveryBlockedError();
    busy = true; // Same-tick double-click guard, before hashing or HTTP.
    try {
      const saved = journal.pending();
      if (
        !saved ||
        !input.intent ||
        Reflect.ownKeys(saved).length !==
          Reflect.ownKeys(input.intent).length ||
        (Object.keys(saved) as (keyof BuyerPendingIntent)[]).some(
          (k) => saved[k] !== input.intent[k],
        )
      )
        throw new OrderRecoveryBlockedError();
      // Copy/validate before any await. Auth/Backend ownership remains authoritative;
      // GET detail is used ONLY for immutable total, never as settlement proof.
      const order = validateOrderDetail(
        structuredClone(input.order),
        saved.orderId,
      );
      const total = order.total;
      const intent =
        saved.schemaVersion === 1
          ? await journal.upgradeLegacyComplete()
          : saved;
      current();
      if(!order.payment)throw new OrderRecoveryBlockedError();
      const handle = journal.prepareResolution(intent, total,order.payment.provider);
      state = Object.freeze({ phase: "resolving" });
      flight = new AbortController();
      const result = await sendBuyerResolution(handle, flight.signal);
      current();
      journal.settleResolution(handle, result);
      // This point is the only transition to known outcome; never infer it from
      // HTTP errors, GET status or an arbitrary shape-valid JSON response.
      settled = Object.freeze({ result, orderId: intent.orderId, total });
      return await refreshSettled();
    } catch (error) {
      current();
      if (!settled)
        state = Object.freeze({
          phase: journal.isBlocked() ? "blocked" : "confirm-resolution",
        });
      throw error;
    } finally {
      busy = false;
      flight = null;
    }
  }
  async function reload(): Promise<BuyerRecoveryState> {
    current();
    if (busy || !settled) throw new OrderRecoveryBlockedError();
    busy = true;
    try {
      return await refreshSettled();
    } finally {
      busy = false;
    }
  }
  async function execute(input: {
    orderId: number;
    order: unknown;
    command: BuyerCommand;
    body: unknown;
    confirmed: boolean;
  }): Promise<BuyerRecoveryState> {
    current();
    if (busy || settled || input.confirmed !== true)
      throw new OrderRecoveryBlockedError();
    busy = true;
    try {
      if (journal.pending() !== null) throw new OrderRecoveryBlockedError();
      // Snapshot all caller-owned fields before either asynchronous fingerprint.
      const command = input.command;
      const body = normalizeBuyerCommand(command, input.body);
      if (!validOrderId(input.orderId)) throw new OrderRecoveryBlockedError();
      const order = validateOrderDetail(
        structuredClone(input.order),
        input.orderId,
      );
      if (
        (command === "cancel" &&
          (order.status !== "PENDING_CONFIRMATION" ||
            !cancellableUnpaidPayment(order.payment))) ||
        (command === "complete" &&
          (order.status !== "DELIVERED" || order.payment?.status !== "PAID"))
      )
        throw new OrderRecoveryBlockedError();
      const intent = await journal.prepareNew({
        orderId: order.id,
        command,
        body,
        confirmed: true,
      });
      current();
      const handle = await journal.prepareExecution(intent, order.total, body,order.payment?.provider);
      current();
      state = Object.freeze({ phase: "executing" });
      flight = new AbortController();
      const receipt = await sendBuyerCommand(handle, flight.signal);
      current();
      journal.settleExecution(handle, receipt);
      // COMMITTED here is an internal known-outcome state based on the execute
      // receipt proof, not a fabricated resolver response used as settlement.
      const result: BuyerResolution = freeze({ outcome: "COMMITTED", receipt });
      settled = Object.freeze({
        result,
        orderId: intent.orderId,
        total: order.total,
      });
      return await refreshSettled();
    } catch (error) {
      current();
      if (!settled)
        state = Object.freeze({
          phase: journal.isBlocked() ? "blocked" : "confirm-resolution",
        });
      throw error;
    } finally {
      busy = false;
      flight = null;
    }
  }
  return Object.freeze({
    pending,
    execute,
    resolve,
    reload,
    isBusy: () => busy,
    getState: (): BuyerRecoveryState => {
      try {
        current();
        return state;
      } catch {
        return Object.freeze({ phase: "blocked" });
      }
    },
    dispose: () => {
      active = false;
      flight?.abort();
    },
  });
}

/** Keep the resolver-only integration surface unchanged for existing callers. */
export function createBuyerCommandRecovery(
  options: Parameters<typeof createBuyerCommandLifecycle>[0],
) {
  const c = createBuyerCommandLifecycle(options);
  return Object.freeze({
    pending: c.pending,
    resolve: c.resolve,
    reload: c.reload,
    isBusy: c.isBusy,
    getState: c.getState,
    dispose: c.dispose,
  });
}
/** Explicit opt-in runtime. Still unmounted; only this factory exposes execute. */
export const createBuyerCommandRuntime = createBuyerCommandLifecycle;
