import { getAuthSessionVersion } from "../../services/apiClient";
import { orderApi } from "../../services/orderApi";
import { validOrderId } from "../../services/orderResponse";
import type { OrderDetail } from "../../types/order";
import {
  createBuyerCommandRuntime,
  type BuyerRecoveryState,
} from "./buyerCommandRecovery";
import type { BuyerPendingIntent } from "./buyerIntentJournal";
import type { BuyerCommand } from "./buyerCommandFingerprint";
import type { BuyerReviewRequest } from "./BuyerCommandReview";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import { OrderRecoveryBlockedError } from "./orderIntentJournal";

type Phase =
  | "loading"
  | "ready"
  | "confirm-new"
  | "sending"
  | "unknown"
  | "resolving"
  | "committed-refresh-error"
  | "closed-refresh-error"
  | "error"
  | "blocked";
export type BuyerWorkflowState = Readonly<{
  revision: number;
  phase: Phase;
  order: OrderDetail | null;
  pending: BuyerPendingIntent | null;
  command: BuyerCommand | null;
  outcome: "committed" | "closed" | null;
}>;
const initial: BuyerWorkflowState = Object.freeze({
  revision: 0,
  phase: "loading",
  order: null,
  pending: null,
  command: null,
  outcome: null,
});
const blocked: BuyerWorkflowState = Object.freeze({
  ...initial,
  phase: "blocked",
});
export function buyerCanChoose(order: OrderDetail, command: BuyerCommand) {
  if (command !== "cancel" && command !== "complete") return false;
  const payment = order.payment;
  if (!payment || payment.currency !== "VND" || payment.amount !== order.total)
    return false;
  return command === "cancel"
    ? order.status === "PENDING_CONFIRMATION" &&
        payment.provider === "COD" &&
        payment.status === "UNPAID" &&
        payment.paidAt === null
    : order.status === "DELIVERED" &&
        payment.status === "PAID" &&
        typeof payment.paidAt === "string" &&
        Number.isFinite(Date.parse(payment.paidAt)) &&
        new Date(payment.paidAt).toISOString() === payment.paidAt;
}

/** One view/controller, one runtime per mounted epoch. No POST on mount/read.
 * Epoch fencing is essential: StrictMode setup -> cleanup -> setup must never
 * revive a disposed runtime or let the first GET publish/release a new job.
 */
export function createBuyerOrderWorkflow(options: {
  orderId: number;
  getSession: () => VerifiedOrderSession | null;
  getStorage: Parameters<typeof createBuyerCommandRuntime>[0]["getStorage"];
}) {
  const owner = options.getSession();
  if (
    !owner?.isActive ||
    owner.actor.role !== "USER" ||
    !validOrderId(options.orderId)
  )
    throw new OrderRecoveryBlockedError();
  const identity = { actorId: owner.actor.id, version: owner.version };
  let mounted = false,
    epoch = 0,
    revision = 0;
  let state = initial;
  let runtime: ReturnType<typeof createBuyerCommandRuntime> | null = null;
  let job: object | null = null,
    readController: AbortController | null = null;
  const listeners = new Set<() => void>();
  function current(at = epoch) {
    const session = options.getSession();
    return (
      mounted &&
      at === epoch &&
      !!session?.isActive &&
      session.actor.role === "USER" &&
      session.actor.id === identity.actorId &&
      session.version === identity.version &&
      session.version === getAuthSessionVersion()
    );
  }
  function assertCurrent(at = epoch) {
    if (!current(at)) throw new OrderRecoveryBlockedError();
  }
  function publish(next: Omit<BuyerWorkflowState, "revision">, at = epoch) {
    if (!current(at)) return;
    state = Object.freeze({ ...next, revision: ++revision });
    listeners.forEach((listener) => listener());
  }
  const readKey = () =>
    `${identity.version}:${options.orderId}:${epoch}:${state.revision}`;
  function pending() {
    assertCurrent();
    if (!runtime) throw new OrderRecoveryBlockedError();
    return runtime.pending();
  }
  function settled(value: BuyerRecoveryState, at: number) {
    assertCurrent(at);
    if (value.phase === "committed" || value.phase === "closed") {
      if (value.phase === "closed") {
        // A verified fence PLUS a fresh GET permits a separately confirmed new
        // intent. The old runtime deliberately refuses execute once settled.
        // Never replace it while a known outcome still has a failed GET.
        const next = createBuyerCommandRuntime({
          ...options,
          getSession: () => (current() ? options.getSession() : null),
        });
        runtime?.dispose();
        runtime = next;
      }
      publish(
        {
          phase: "ready",
          order: value.order,
          pending: null,
          command: null,
          outcome: value.phase,
        },
        at,
      );
    } else if (
      value.phase === "committed-refresh-error" ||
      value.phase === "closed-refresh-error"
    ) {
      publish(
        {
          ...state,
          phase: value.phase,
          pending: null,
          command: null,
          outcome:
            value.phase === "committed-refresh-error" ? "committed" : "closed",
        },
        at,
      );
    } else throw new OrderRecoveryBlockedError();
  }
  function failed(at: number) {
    if (!current(at)) return;
    try {
      const old = pending();
      publish(
        {
          ...state,
          phase: old ? "unknown" : "blocked",
          pending: old,
          command: null,
        },
        at,
      );
    } catch {
      publish({ ...blocked }, at);
    }
  }
  async function reload() {
    assertCurrent();
    if (job || state.phase === "confirm-new" || !runtime) return;
    const at = epoch,
      ownJob = {},
      ownRuntime = runtime;
    job = ownJob;
    const controller = new AbortController();
    readController = controller;
    const known = ownRuntime.getState().phase;
    const hasKnown = [
      "committed",
      "closed",
      "committed-refresh-error",
      "closed-refresh-error",
    ].includes(known);
    publish({ ...state, phase: "loading", command: null }, at);
    try {
      if (hasKnown) settled(await ownRuntime.reload(), at);
      else {
        const order = await orderApi.detail(
          "buyer",
          options.orderId,
          controller.signal,
        );
        assertCurrent(at);
        const old = ownRuntime.pending();
        publish(
          {
            phase: old ? "unknown" : "ready",
            order,
            pending: old,
            command: null,
            outcome: null,
          },
          at,
        );
      }
    } catch {
      if (current(at)) {
        try {
          const old = ownRuntime.pending();
          publish(
            {
              ...state,
              phase: old ? "unknown" : hasKnown ? "blocked" : "error",
              pending: old,
              command: null,
            },
            at,
          );
        } catch {
          publish({ ...blocked }, at);
        }
      }
    } finally {
      if (job === ownJob) job = null;
      if (readController === controller) readController = null;
    }
  }
  async function execute(request: BuyerReviewRequest) {
    assertCurrent();
    if (
      job ||
      !runtime ||
      state.phase !== "confirm-new" ||
      !state.order ||
      !state.command ||
      pending() ||
      request.actorId !== identity.actorId ||
      request.sessionVersion !== identity.version ||
      request.readKey !== readKey() ||
      request.orderId !== options.orderId ||
      request.command !== state.command ||
      request.expectedTotal !== state.order.total ||
      !buyerCanChoose(state.order, request.command)
    )
      throw new OrderRecoveryBlockedError();
    const at = epoch,
      ownJob = {},
      ownRuntime = runtime,
      order = state.order;
    job = ownJob;
    publish({ ...state, phase: "sending" }, at);
    try {
      settled(
        await ownRuntime.execute({
          orderId: options.orderId,
          order,
          command: request.command,
          body: request.body,
          confirmed: true,
        }),
        at,
      );
    } catch {
      failed(at);
    } finally {
      if (job === ownJob) job = null;
    }
  }
  async function resolve(intent: BuyerPendingIntent) {
    assertCurrent();
    if (
      job ||
      !runtime ||
      state.phase !== "unknown" ||
      !state.order ||
      intent.orderId !== options.orderId
    )
      throw new OrderRecoveryBlockedError();
    const at = epoch,
      ownJob = {},
      ownRuntime = runtime,
      order = state.order;
    job = ownJob;
    publish({ ...state, phase: "resolving" }, at);
    try {
      settled(await ownRuntime.resolve({ intent, order, confirmed: true }), at);
    } catch {
      failed(at);
    } finally {
      if (job === ownJob) job = null;
    }
  }
  return Object.freeze({
    snapshot: () => (current() ? state : blocked),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readKey,
    mount() {
      if (mounted) return;
      mounted = true;
      ++epoch;
      try {
        runtime = createBuyerCommandRuntime({
          ...options,
          getSession: () => (current() ? options.getSession() : null),
        });
        void reload();
      } catch {
        publish({ ...blocked });
      }
    },
    unmount() {
      mounted = false;
      ++epoch;
      readController?.abort();
      readController = null;
      runtime?.dispose();
      runtime = null;
      job = null;
    },
    reload,
    execute,
    resolve,
    choose(command: BuyerCommand) {
      assertCurrent();
      if (
        job ||
        state.phase !== "ready" ||
        !state.order ||
        !buyerCanChoose(state.order, command)
      )
        throw new OrderRecoveryBlockedError();
      try {
        const old = pending();
        if (old) {
          publish({ ...state, phase: "unknown", pending: old, command: null });
          return;
        }
      } catch {
        publish({ ...blocked });
        return;
      }
      publish({ ...state, phase: "confirm-new", command, outcome: null });
    },
    cancelConfirmation() {
      assertCurrent();
      if (!job && state.phase === "confirm-new")
        publish({ ...state, phase: "ready", command: null });
    },
  });
}
