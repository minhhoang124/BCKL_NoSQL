import { getAuthSessionVersion } from "../../services/apiClient";
import { orderApi } from "../../services/orderApi";
import { validateOrderDetail } from "../../services/orderResponse";
import type { OrderDetail } from "../../types/order";
import type { SellerResolution } from "../../services/orderResolutionApi";
import type { createSellerCommandRecovery } from "./sellerCommandRecovery";
import {
  OrderRecoveryBlockedError,
  type PendingOrderIntent,
} from "./orderIntentJournal";
import {
  OrderRecoverySessionChangedError,
  type VerifiedOrderSession,
} from "./orderCommandCoordinator";

export type SellerResolutionPhase =
  | "confirm-resolution"
  | "resolving"
  | "committed-refreshing"
  | "closed-refreshing"
  | "committed-refresh-error"
  | "closed-refresh-error"
  | "ready"
  | "blocked";
export type ResolutionFlowState = Readonly<{
  phase: SellerResolutionPhase;
  order: OrderDetail | null;
}>;
/** Unmounted controller. A resolution is NOT a fresh GET and cannot advance the next command.
 * Keep one instance per view/session; old async work cannot publish into a new login.
 */
export function createSellerResolutionFlow(options: {
  recovery: ReturnType<typeof createSellerCommandRecovery>;
  getSession: () => VerifiedOrderSession | null;
  loadDetail?: (id: number) => Promise<OrderDetail>;
}) {
  let busy = false;
  let state: ResolutionFlowState = Object.freeze({
    phase: "confirm-resolution",
    order: null,
  });
  let settled: {
    session: VerifiedOrderSession;
    intent: PendingOrderIntent;
    result: SellerResolution;
  } | null = null;
  function session() {
    const s = options.getSession();
    if (
      !s?.isActive ||
      s.actor.role !== "SELLER" ||
      s.version !== getAuthSessionVersion()
    )
      throw new OrderRecoverySessionChangedError();
    return {
      actor: { ...s.actor },
      version: s.version,
      isActive: true,
    } as const;
  }
  function assertCurrent(s: VerifiedOrderSession) {
    const now = session();
    if (
      now.version !== s.version ||
      now.actor.id !== s.actor.id ||
      now.actor.role !== s.actor.role
    )
      throw new OrderRecoverySessionChangedError();
  }
  async function reload() {
    if (!settled) throw new OrderRecoveryBlockedError();
    const item = settled;
    assertCurrent(item.session);
    const committed = item.result.outcome === "COMMITTED";
    state = Object.freeze({
      phase: committed ? "committed-refreshing" : "closed-refreshing",
      order: null,
    });
    try {
      const raw = await (
        options.loadDetail ?? ((id) => orderApi.detail("seller", id))
      )(item.intent.orderId);
      assertCurrent(item.session);
      const order = validateOrderDetail(raw, item.intent.orderId);
      // If another action appeared meanwhile, the refreshed order cannot unlock a new command.
      if (options.recovery.pending() !== null)
        throw new OrderRecoveryBlockedError();
      state = Object.freeze({ phase: "ready", order });
    } catch (error) {
      assertCurrent(item.session);
      state = Object.freeze({
        phase: committed ? "committed-refresh-error" : "closed-refresh-error",
        order: null,
      });
      throw error;
    }
    return state;
  }
  return Object.freeze({
    snapshot: (): ResolutionFlowState => {
      // Even reading this controller after a switch never exposes the previous Order.
      if (settled) {
        try {
          assertCurrent(settled.session);
        } catch {
          return { phase: "blocked", order: null };
        }
      }
      return state;
    },
    isBusy: () => busy,
    // Freshness/recovery gate ONLY; the existing state/payment policy still decides each command.
    canStartNext: () => {
      if (!settled || busy || state.phase !== "ready") return false;
      try {
        assertCurrent(settled.session);
        return options.recovery.pending() === null;
      } catch {
        return false;
      }
    },
    resolve: async (intent: PendingOrderIntent, confirmed: boolean) => {
      if (busy || settled || confirmed !== true)
        throw new OrderRecoveryBlockedError();
      const captured = session();
      const original = Object.freeze({ ...intent });
      busy = true;
      state = Object.freeze({ phase: "resolving", order: null });
      try {
        const result = await options.recovery.resolve({
          intent: original,
          confirmed,
        });
        assertCurrent(captured);
        settled = { session: captured, intent: original, result };
        return await reload();
      } catch (error) {
        assertCurrent(captured);
        if (!settled)
          state = Object.freeze({ phase: "confirm-resolution", order: null });
        throw error;
      } finally {
        busy = false;
      }
    },
    retryRefresh: async () => {
      if (busy || !settled) throw new OrderRecoveryBlockedError();
      busy = true;
      try {
        return await reload();
      } finally {
        busy = false;
      }
    },
  });
}
