import {
  ApiError,
  getAuthSessionVersion,
  fetchApi,
} from "../../services/apiClient";
import { orderApi } from "../../services/orderApi";
import { validOrderId } from "../../services/orderResponse";
import type { User } from "../../types/auth";
import type { OrderDetail, PreparationCommand } from "../../types/order";
import { orderActions } from "../order-readiness/orderPolicy";
import { createSellerCommandRecovery } from "./sellerCommandRecovery";
import { pendingSellerClose } from "./sellerCloseClient";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import {
  OrderRecoveryBlockedError,
  type PendingOrderIntent,
} from "./orderIntentJournal";

type Phase =
  | "loading"
  | "ready"
  | "confirm-new"
  | "sending"
  | "unknown"
  | "resolving"
  | "committed-refreshing"
  | "closed-refreshing"
  | "committed-refresh-error"
  | "closed-refresh-error"
  | "error"
  | "blocked";
export type SellerWorkflowState = Readonly<{
  revision: number;
  outcome: "committed" | "closed" | null;
  phase: Phase;
  order: OrderDetail | null;
  store: { id: number; status: string } | null;
  pending: PendingOrderIntent | null;
  command: PreparationCommand | null;
}>;
const initial: SellerWorkflowState = Object.freeze({
  revision: 0,
  outcome: null,
  phase: "loading",
  order: null,
  store: null,
  pending: null,
  command: null,
});
const blockedState: SellerWorkflowState = Object.freeze({
  ...initial,
  phase: "blocked",
});

/** One view owns one stable controller. No POST on construction, mount or refresh.
 * PostgreSQL remains the ownership/idempotency boundary; this is UX coordination.
 */
export function createSellerOrderWorkflow(options: {
  orderId: number;
  storage: Parameters<typeof createSellerCommandRecovery>[0]["storage"];
  getSession: () => VerifiedOrderSession | null;
}) {
  const origin = options.getSession();
  if (
    !origin?.isActive ||
    origin.actor.role !== "SELLER" ||
    !validOrderId(options.orderId)
  )
    throw new OrderRecoveryBlockedError();
  const identity = { actorId: origin.actor.id, version: origin.version };
  let state = initial;
  let revision = 0;
  let busy = false;
  let mounted = true;
  // Keep the acknowledgement after journal settlement even when GET fails.
  let settled: "committed" | "closed" | null = null;
  const listeners = new Set<() => void>();
  function current() {
    const s = options.getSession();
    return (
      mounted &&
      !!s?.isActive &&
      s.actor.role === "SELLER" &&
      s.actor.id === identity.actorId &&
      s.version === identity.version &&
      s.version === getAuthSessionVersion()
    );
  }
  function assertCurrent() {
    if (!current()) throw new OrderRecoveryBlockedError();
  }
  const recovery = createSellerCommandRecovery({
    storage: options.storage,
    getSession: () => (current() ? options.getSession() : null),
  });
  function publish(next: Omit<SellerWorkflowState, "revision">) {
    state = current()
      ? Object.freeze({ ...next, revision: ++revision })
      : blockedState;
    listeners.forEach((fn) => fn());
  }
  function pending() {
    assertCurrent();
    return recovery.pending();
  }
  function user(): User {
    return {
      id: identity.actorId,
      role: "SELLER",
      isActive: true,
      email: "",
      fullName: null,
    };
  }
  function eligible(command: PreparationCommand) {
    return (
      state.order !== null &&
      state.store !== null &&
      orderActions(state.order, {
        scope: "seller",
        user: user(),
        store: state.store,
        fresh: true,
        busy: false,
        outcomeUnknown: false,
      }).some((a) => a.id === command && a.enabled)
    );
  }
  async function read() {
    assertCurrent();
    publish({
      ...state,
      phase: settled ? `${settled}-refreshing` : "loading",
      command: null,
    });
    try {
      const [order, raw] = await Promise.all([
        orderApi.detail("seller", options.orderId),
        fetchApi<unknown>("/seller/store", {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        }),
      ]);
      assertCurrent();
      // Store API is an existing full entity response; validate only the projection
      // needed here, never assume ACTIVE or manufacture ownership from Order.
      const v = raw as Record<string, unknown> | null;
      if (
        !v ||
        typeof v !== "object" ||
        Array.isArray(v) ||
        !validOrderId(v.id) ||
        v.sellerId !== identity.actorId ||
        v.id !== order.store.id ||
        typeof v.status !== "string" ||
        !["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "CLOSED"].includes(
          v.status,
        )
      )
        throw new ApiError(
          "Dữ liệu cửa hàng không hợp lệ.",
          502,
          "INVALID_STORE_RESPONSE",
        );
      const old = pending();
      publish({
        phase: old ? "unknown" : "ready",
        outcome: settled,
        order,
        store: { id: v.id, status: v.status },
        pending: old,
        command: null,
      });
      if (!old) settled = null;
    } catch {
      let old: PendingOrderIntent | null = null;
      try {
        old = pending();
      } catch {
        publish(blockedState);
        return;
      }
      publish({
        ...initial,
        pending: old,
        phase: settled ? `${settled}-refresh-error` : old ? "unknown" : "error",
      });
    }
  }
  async function reload() {
    if (busy) return;
    busy = true;
    try {
      await read();
    } finally {
      busy = false;
    }
  }
  async function execute(confirmed: boolean) {
    assertCurrent();
    if (
      busy ||
      state.phase !== "confirm-new" ||
      !state.command ||
      !confirmed ||
      pending() ||
      pendingSellerClose(options.storage, identity.actorId) ||
      !eligible(state.command)
    )
      throw new OrderRecoveryBlockedError();
    const command = state.command;
    busy = true;
    publish({ ...state, phase: "sending" });
    try {
      await recovery.execute({
        orderId: options.orderId,
        command,
        confirmed: true,
      });
      assertCurrent();
      settled = "committed";
      await read();
    } catch {
      try {
        const old = pending();
        publish({
          ...state,
          phase: old ? "unknown" : "blocked",
          pending: old,
          command: null,
        });
      } catch {
        publish(blockedState);
      }
    } finally {
      busy = false;
    }
  }
  async function resolve(intent: PendingOrderIntent, confirmed: boolean) {
    assertCurrent();
    if (
      busy ||
      state.phase !== "unknown" ||
      !confirmed ||
      intent.orderId !== options.orderId
    )
      throw new OrderRecoveryBlockedError();
    busy = true;
    publish({ ...state, phase: "resolving" });
    try {
      const result = await recovery.resolve({ intent, confirmed: true });
      assertCurrent();
      settled = result.outcome === "COMMITTED" ? "committed" : "closed";
      publish({ ...state, pending: null });
      await read();
    } catch {
      try {
        const old = pending();
        publish({
          ...state,
          phase: old ? "unknown" : "blocked",
          pending: old,
          command: null,
        });
      } catch {
        publish(blockedState);
      }
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    setMounted(value: boolean) {
      mounted = value;
    },
    snapshot: () => (current() ? state : blockedState),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    reload,
    execute,
    resolve,
    choose(command: PreparationCommand) {
      assertCurrent();
      if (
        busy ||
        state.phase !== "ready" ||
        pending() ||
        pendingSellerClose(options.storage, identity.actorId) ||
        !eligible(command)
      )
        throw new OrderRecoveryBlockedError();
      publish({ ...state, phase: "confirm-new", outcome: null, command });
    },
    cancelConfirmation() {
      assertCurrent();
      if (!busy && state.phase === "confirm-new")
        publish({ ...state, phase: "ready", command: null });
    },
  });
}
