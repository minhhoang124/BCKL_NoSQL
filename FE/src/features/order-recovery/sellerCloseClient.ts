import {
  ApiError,
  fetchApi,
  getAuthSessionVersion,
} from "../../services/apiClient";
import { orderApi } from "../../services/orderApi";
import { validOrderId, validOrderMoney } from "../../services/orderResponse";
import type { OrderDetail } from "../../types/order";
import { createOrderIntentJournal } from "./orderIntentJournal";
export type CloseCommand = "cancel" | "confirm-returned";
export type CloseBody = {
  reasonCode: string;
  reasonText: string;
  receiptReference?: string | null;
  restockable?: boolean;
};
export type CloseIntent = {
  schemaVersion: 1;
  actorId: number;
  orderId: number;
  command: CloseCommand;
  idempotencyKey: string;
  requestHash: string;
};
export type CloseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ClosePayment = Pick<NonNullable<OrderDetail["payment"]>, "provider" | "amount">;
export class SellerCloseBlocked extends Error {
  constructor() {
    super(
      "Chưa xác minh được yêu cầu đang chờ. Không tạo lệnh mới; quay lại đúng đơn để đối chiếu.",
    );
  }
}
export const sellerCloseKey = (actorId: number) =>
  "bckl-seller-close-v1:" + actorId;
export function pendingSellerClose(
  storage: CloseStorage,
  actorId: number,
): CloseIntent | null {
  try {
    const raw = storage.getItem(sellerCloseKey(actorId));
    if (raw === null) return null;
    const p = JSON.parse(raw) as CloseIntent;
    if (
      !p ||
      Object.keys(p).sort().join(",") !==
        "actorId,command,idempotencyKey,orderId,requestHash,schemaVersion" ||
      p.schemaVersion !== 1 ||
      p.actorId !== actorId ||
      !validOrderId(actorId) ||
      !validOrderId(p.orderId) ||
      !["cancel", "confirm-returned"].includes(p.command) ||
      typeof p.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(p.idempotencyKey) ||
      typeof p.requestHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(p.requestHash)
    )
      throw new SellerCloseBlocked();
    return Object.freeze(p);
  } catch {
    throw new SellerCloseBlocked();
  }
}
export function assertNoPreparationPending(
  storage: CloseStorage,
  actorId: number,
) {
  if (
    createOrderIntentJournal(storage).pending({ id: actorId, role: "SELLER" })
  )
    throw new SellerCloseBlocked();
}
export function closeBody(
  command: CloseCommand,
  reasonCode: string,
  reasonText: string,
  receiptReference = "",
  restockable = true,
): CloseBody {
  const text = reasonText.trim(),
    receipt = receiptReference.trim();
  if (!text || text.length > 500) throw Error("Nhập lý do từ 1 đến 500 ký tự.");
  if (command === "cancel") {
    if (!["OUT_OF_STOCK", "CANNOT_FULFIL", "OTHER"].includes(reasonCode))
      throw new SellerCloseBlocked();
    return { reasonCode, reasonText: text };
  }
  if (!receipt || receipt.length > 100)
    throw Error("Nhập biên nhận hàng quay về từ 1 đến 100 ký tự.");
  // Seller cannot classify LOST; only actual returned goods, received/damaged.
  return {
    reasonCode: restockable ? "RETURN_RECEIVED" : "DAMAGED",
    reasonText: text,
    receiptReference: receipt,
    restockable,
  };
}
export async function closeHash(
  actorId: number,
  orderId: number,
  command: CloseCommand,
  body: CloseBody,
) {
  if (!validOrderId(actorId) || !validOrderId(orderId))
    throw new SellerCloseBlocked();
  const canonical = JSON.stringify({
    actorScope: "USER:" + actorId,
    body,
    command,
    orderId,
  });
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical),
      ),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function prepareClose(
  storage: CloseStorage,
  input: Omit<CloseIntent, "schemaVersion" | "idempotencyKey">,
): CloseIntent {
  assertNoPreparationPending(storage, input.actorId);
  const old = pendingSellerClose(storage, input.actorId);
  if (old) {
    if (
      old.orderId !== input.orderId ||
      old.command !== input.command ||
      old.requestHash !== input.requestHash
    )
      throw new SellerCloseBlocked();
    return old;
  }
  const p = {
    schemaVersion: 1 as const,
    ...input,
    idempotencyKey: crypto.randomUUID(),
  };
  try {
    storage.setItem(sellerCloseKey(input.actorId), JSON.stringify(p));
    const saved = pendingSellerClose(storage, input.actorId);
    if (!saved || JSON.stringify(saved) !== JSON.stringify(p))
      throw new SellerCloseBlocked();
    return saved;
  } catch {
    throw new SellerCloseBlocked();
  }
}
export function settleClose(storage: CloseStorage, p: CloseIntent) {
  const current = pendingSellerClose(storage, p.actorId);
  if (!current || JSON.stringify(current) !== JSON.stringify(p))
    throw new SellerCloseBlocked();
  storage.removeItem(sellerCloseKey(p.actorId));
  if (pendingSellerClose(storage, p.actorId) !== null)
    throw new SellerCloseBlocked();
}
export function eligibleClose(
  order: OrderDetail,
  storeStatus: string,
  command: CloseCommand,
) {
  const pay = order.payment;
  if (
    !["ACTIVE", "SUSPENDED"].includes(storeStatus) ||
    !pay ||
    pay.paidAt !== null ||
    pay.currency !== "VND" ||
    pay.amount !== order.total
  )
    return false;
  return command === "cancel"
    ? ["PENDING_CONFIRMATION", "CONFIRMED"].includes(order.status) &&
        ((pay.provider === "COD" && pay.status === "UNPAID") ||
          (pay.provider === "VNPAY" &&
            ["UNPAID", "PENDING", "FAILED", "CANCELLED", "EXPIRED"].includes(
              pay.status,
            )))
    : order.status === "DELIVERY_FAILED" &&
        pay.provider === "COD" &&
        pay.status === "UNPAID";
}
const object = (v: unknown, keys: string[]) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw new SellerCloseBlocked();
  return v as Record<string, unknown>;
};
const iso = (v: unknown) =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
export function closeReceipt(raw: unknown, p: CloseIntent, body: CloseBody, expectedPayment: ClosePayment) {
  const root = object(raw, [
    "orderId",
    "commandId",
    "command",
    "replayed",
    "result",
  ]);
  if (
    root.orderId !== p.orderId ||
    root.command !== p.command ||
    !validOrderId(root.commandId) ||
    typeof root.replayed !== "boolean"
  )
    throw new SellerCloseBlocked();
  const returned = p.command === "confirm-returned",
    r = object(
      root.result,
      returned
        ? [
            "status",
            "payment",
            "cancellation",
            "restockable",
            "receiptReference",
            "delivery",
            "timeline",
          ]
        : ["status", "payment", "cancellation", "timeline"],
    );
  const pay = object(r.payment, [
      "provider",
      "status",
      "amount",
      "currency",
      "paidAt",
    ]),
    c = object(r.cancellation, [
      "cancelledBy",
      "reasonCode",
      "reasonText",
      "cancelledAt",
    ]),
    actor = object(c.cancelledBy, ["type", "id"]);
  if (
    r.status !== "CANCELLED" ||
    pay.status !== "CANCELLED" ||
    pay.currency !== "VND" ||
    pay.paidAt !== null ||
    !validOrderMoney(pay.amount) ||
    pay.amount !== expectedPayment.amount ||
    pay.provider !== expectedPayment.provider ||
    !["COD", ...(returned ? [] : ["VNPAY"])].includes(String(pay.provider)) ||
    actor.type !== "SELLER" ||
    actor.id !== p.actorId ||
    c.reasonCode !== body.reasonCode ||
    c.reasonText !== body.reasonText ||
    !iso(c.cancelledAt) ||
    !Array.isArray(r.timeline) ||
    r.timeline.length !== 1
  )
    throw new SellerCloseBlocked();
  const historyKeys = [
    "fromStatus",
    "toStatus",
    "actorType",
    "actorId",
    "reasonCode",
    "reasonText",
    ...(returned
      ? [
          "restockable",
          "receiptReference",
          "deliveryAttempt",
          "trackingReference",
        ]
      : []),
    "createdAt",
  ];
  const h = object(r.timeline[0], historyKeys);
  if (
    h.toStatus !== "CANCELLED" ||
    h.actorType !== "SELLER" ||
    h.actorId !== p.actorId ||
    h.reasonCode !== body.reasonCode ||
    h.reasonText !== body.reasonText ||
    h.createdAt !== c.cancelledAt ||
    !(returned
      ? h.fromStatus === "DELIVERY_FAILED"
      : ["PENDING_CONFIRMATION", "CONFIRMED"].includes(String(h.fromStatus)))
  )
    throw new SellerCloseBlocked();
  if (returned) {
    const d = object(r.delivery, [
      "deliveryAttempt",
      "retryCount",
      "trackingReference",
    ]);
    if (
      r.restockable !== body.restockable ||
      r.receiptReference !== body.receiptReference ||
      h.restockable !== body.restockable ||
      h.receiptReference !== body.receiptReference ||
      !validOrderId(d.deliveryAttempt) ||
      d.deliveryAttempt > 4 ||
      d.retryCount !== d.deliveryAttempt - 1 ||
      typeof d.trackingReference !== "string" ||
      !d.trackingReference.trim() ||
      d.trackingReference.length > 100 ||
      h.deliveryAttempt !== d.deliveryAttempt ||
      h.trackingReference !== d.trackingReference
    )
      throw new SellerCloseBlocked();
  }
  return {
    orderId: p.orderId,
    command: p.command,
    commandId: root.commandId,
    replayed: root.replayed,
  };
}
export const sellerCloseApi = {
  async resolve(p: CloseIntent, sessionVersion: number, expectedPayment: ClosePayment) {
    if (sessionVersion !== getAuthSessionVersion()) throw new SellerCloseBlocked();
    const raw = await fetchApi<unknown>(`/seller/orders/${p.orderId}/resolve-close-command`, {
      method: "POST",
      headers: { "Idempotency-Key": p.idempotencyKey },
      body: JSON.stringify({ command: p.command, hashVersion: 1, requestHash: p.requestHash }),
      retryOnUnauthorized: false,
      signal: AbortSignal.timeout(30000),
    });
    if (sessionVersion !== getAuthSessionVersion()) throw new SellerCloseBlocked();
    if (raw && typeof raw === "object" && "outcome" in raw && raw.outcome === "COMMITTED") {
      const result = object(raw, ["outcome", "receipt"]);
      // No current Order state can stand in for an immutable receipt. Recover
      // the original normalized body, then prove its hash matches the journal.
      const receipt = result.receipt as { result?: { cancellation?: { reasonCode?: unknown; reasonText?: unknown }; restockable?: unknown; receiptReference?: unknown } } | null;
      const snapshot = receipt?.result, reason = snapshot?.cancellation;
      if (typeof reason?.reasonCode !== "string" || typeof reason.reasonText !== "string" ||
        (p.command === "confirm-returned" && (typeof snapshot?.restockable !== "boolean" || typeof snapshot.receiptReference !== "string"))) throw new SellerCloseBlocked();
      const body = closeBody(p.command, reason.reasonCode, reason.reasonText,
        typeof snapshot?.receiptReference === "string" ? snapshot.receiptReference : "",
        typeof snapshot?.restockable === "boolean" ? snapshot.restockable : true);
      if (await closeHash(p.actorId, p.orderId, p.command, body) !== p.requestHash) throw new SellerCloseBlocked();
      const proof = closeReceipt(result.receipt, p, body, expectedPayment);
      if (!proof.replayed || sessionVersion !== getAuthSessionVersion()) throw new SellerCloseBlocked();
      return { outcome: "COMMITTED" as const };
    }
    const r = object(raw, ["outcome", "resolutionId", "orderId", "command", "hashVersion", "requestHash", "actorId", "resolvedAt"]);
    if (r.outcome !== "CLOSED_WITHOUT_EXECUTION" || !validOrderId(r.resolutionId) ||
      r.orderId !== p.orderId || r.command !== p.command || r.actorId !== p.actorId ||
      r.hashVersion !== 1 || r.requestHash !== p.requestHash || !iso(r.resolvedAt)) throw new SellerCloseBlocked();
    return { outcome: "CLOSED_WITHOUT_EXECUTION" as const };
  },
  async read(actorId: number, orderId: number) {
    const [order, raw] = await Promise.all([
      orderApi.detail("seller", orderId),
      fetchApi<unknown>("/seller/store", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }),
    ]);
    const store = raw as { id: number; sellerId: number; status: string };
    if (
      !store ||
      store.id !== order.store.id ||
      store.sellerId !== actorId ||
      !["ACTIVE", "SUSPENDED", "CLOSED", "PENDING", "REJECTED"].includes(
        store.status,
      )
    )
      throw new SellerCloseBlocked();
    return { order, storeStatus: store.status };
  },
  async send(p: CloseIntent, body: CloseBody, sessionVersion: number, expectedPayment: ClosePayment) {
    if (sessionVersion !== getAuthSessionVersion())
      throw new SellerCloseBlocked();
    const raw = await fetchApi<unknown>(
      `/seller/orders/${p.orderId}/${p.command}`,
      {
        method: "POST",
        headers: { "Idempotency-Key": p.idempotencyKey },
        body: JSON.stringify(body),
        retryOnUnauthorized: false,
        signal: AbortSignal.timeout(30000),
      },
    );
    if (sessionVersion !== getAuthSessionVersion())
      throw new SellerCloseBlocked();
    return closeReceipt(raw, p, body, expectedPayment);
  },
};
export const closeDefiniteRejection = (e: unknown) =>
  e instanceof ApiError &&
  ([400, 403, 404, 413].includes(e.status ?? 0) ||
    (e.status === 409 &&
      [
        "INVALID_ORDER_TRANSITION",
        "ORDER_CANNOT_CANCEL",
        "DELIVERY_STATE_CONFLICT",
        "STORE_STATE_CONFLICT",
        "PAYMENT_STATE_CONFLICT",
        "ORDER_INVENTORY_REVIEW_REQUIRED",
        "INVENTORY_STATE_CONFLICT",
      ].includes(e.code ?? "")));
