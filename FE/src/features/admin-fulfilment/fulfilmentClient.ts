import { fetchApi, ApiError } from "../../services/apiClient";
import { ORDER_STATUSES } from "../../types/order";
export const commands = [
  "ship",
  "delivery-failed",
  "retry-delivery",
  "mark-delivered",
  "confirm-returned",
] as const;
export type Command = (typeof commands)[number];
export type Snapshot = {
  id: number;
  orderNumber: string;
  status: string;
  total: string;
  currentDeliveryAttempt: number | null;
  retryCount: number | null;
  currentAttempt: { trackingReference: string } | null;
  payment: {
    provider: string;
    status: string;
    amount: string;
    currency: string;
  } | null;
};
export type Pending = {
  actorId: number;
  orderId: number;
  command: Command;
  key: string;
  hash: string;
};
const fail = (): never => {
  throw new Error("Dữ liệu giao hàng không hợp lệ.");
};
export const validId = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
export const money = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9]\d{0,11})\.\d{2}$/.test(v);
export function snapshot(value: unknown): Snapshot {
  const v = value as Snapshot;
  if (
    !v ||
    !validId(v.id) ||
    typeof v.orderNumber !== "string" ||
    !money(v.total) ||
    !ORDER_STATUSES.includes(v.status as (typeof ORDER_STATUSES)[number])
  )
    fail();
  if (
    v.currentDeliveryAttempt !== null &&
    (!validId(v.currentDeliveryAttempt) || v.currentDeliveryAttempt > 4)
  )
    fail();
  if (
    v.retryCount !== null &&
    (!Number.isInteger(v.retryCount) || v.retryCount < 0 || v.retryCount > 3)
  )
    fail();
  if (
    v.currentAttempt !== null &&
    typeof v.currentAttempt?.trackingReference !== "string"
  )
    fail();
  if (
    v.payment !== null &&
    (!money(v.payment?.amount) ||
      v.payment.currency !== "VND" ||
      typeof v.payment.status !== "string" ||
      typeof v.payment.provider !== "string")
  )
    fail();
  return v;
}
export function allowed(s: Snapshot): Command[] {
  if (s.status === "READY_TO_SHIP") return ["ship"];
  if (s.status === "SHIPPING") return ["delivery-failed", "mark-delivered"];
  if (s.status === "DELIVERY_FAILED")
    return [
      ...((s.currentDeliveryAttempt ?? 4) < 4
        ? ["retry-delivery" as const]
        : []),
      ...(s.payment?.provider === "COD" ? ["confirm-returned" as const] : []),
    ];
  return [];
}
export const storageKey = (actorId: number) =>
  "bckl:admin-fulfilment:v1:" + actorId;
export function readPending(actorId: number): Pending | null {
  const raw = sessionStorage.getItem(storageKey(actorId));
  if (!raw) return null;
  const p = JSON.parse(raw) as Pending;
  if (
    !p ||
    Object.keys(p).sort().join(",") !== "actorId,command,hash,key,orderId" ||
    p.actorId !== actorId ||
    !validId(p.orderId) ||
    !commands.includes(p.command) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(p.key) ||
    !/^[a-f0-9]{64}$/.test(p.hash)
  )
    fail();
  return p;
}
export async function intentHash(
  actorId: number,
  orderId: number,
  command: Command,
  body: Record<string, unknown>,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ actorId, orderId, command, body }),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function validateReceipt(
  raw: unknown,
  p: Pending,
  body: Record<string, unknown>,
) {
  const r = raw as {
    orderId: number;
    commandId: number;
    command: Command;
    replayed: boolean;
    result: {
      status: string;
      delivery: {
        trackingReference: string;
        deliveryAttempt: number;
        retryCount: number;
      };
      payment: {
        amount: string;
        currency: string;
        status: string;
        provider: string;
      };
      restockable?: boolean;
      receiptReference?: string | null;
      timeline: Array<{ actorType: string; actorId: number }>;
    };
  };
  const status =
    p.command === "mark-delivered"
      ? "DELIVERED"
      : p.command === "delivery-failed"
        ? "DELIVERY_FAILED"
        : p.command === "confirm-returned"
          ? "CANCELLED"
          : "SHIPPING";
  if (
    !r ||
    r.orderId !== p.orderId ||
    r.command !== p.command ||
    !validId(r.commandId) ||
    typeof r.replayed !== "boolean" ||
    r.result?.status !== status ||
    !money(r.result.payment?.amount) ||
    r.result.payment.currency !== "VND" ||
    r.result.timeline?.length !== 1 ||
    r.result.timeline[0].actorType !== "ADMIN" ||
    r.result.timeline[0].actorId !== p.actorId
  )
    fail();
  if (
    !validId(r.result.delivery?.deliveryAttempt) ||
    r.result.delivery.deliveryAttempt > 4 ||
    r.result.delivery.retryCount !== r.result.delivery.deliveryAttempt - 1
  )
    fail();
  if (p.command === "confirm-returned") {
    if (
      r.result.restockable !== body.restockable ||
      r.result.receiptReference !== body.receiptReference ||
      r.result.payment.status !== "CANCELLED"
    )
      fail();
  } else if (
    r.result.delivery.trackingReference !== body.trackingReference ||
    (body.deliveryAttempt !== undefined &&
      r.result.delivery.deliveryAttempt !== body.deliveryAttempt)
  )
    fail();
  return r;
}
export const adminFulfilmentApi = {
  async list() {
    const r = await fetchApi<{ items: unknown[] }>("/admin/fulfilment/orders", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!Array.isArray(r?.items) || r.items.length > 20) fail();
    return r.items.map(snapshot);
  },
  async detail(id: number) {
    return snapshot(
      await fetchApi<unknown>("/admin/fulfilment/orders/" + id, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }),
    );
  },
  async send(p: Pending, body: Record<string, unknown>) {
    return validateReceipt(
      await fetchApi<unknown>(`/admin/orders/${p.orderId}/${p.command}`, {
        method: "POST",
        headers: { "Idempotency-Key": p.key },
        body: JSON.stringify(body),
        retryOnUnauthorized: false,
        signal: AbortSignal.timeout(30000),
      }),
      p,
      body,
    );
  },
};
export const definiteRejection = (error: unknown) =>
  error instanceof ApiError &&
  error.status !== undefined &&
  ([400, 401, 403, 404, 413, 415, 429].includes(error.status) ||
    (error.status === 409 &&
      [
        "INVALID_ORDER_TRANSITION",
        "STALE_DELIVERY_ATTEMPT",
        "DELIVERY_STATE_CONFLICT",
        "PAYMENT_STATE_CONFLICT",
        "DELIVERY_ATTEMPT_LIMIT",
        "INVENTORY_STATE_CONFLICT",
        "ORDER_INVENTORY_REVIEW_REQUIRED",
      ].includes(error.code ?? "")));
