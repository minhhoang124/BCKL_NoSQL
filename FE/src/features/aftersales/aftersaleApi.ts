import {
  ApiError,
  fetchApi,
  getAuthSessionVersion,
  type ApiRequestOptions,
} from "../../services/apiClient";
import {
  clearPending,
  fingerprint,
  loadPending,
  money,
  normalizeBody,
  parseRequest,
  positive,
  record,
  states,
  type Body,
  type Intent,
  type Pending,
  type RequestRow,
  type Scope,
} from "./aftersaleIntent";
export type Context = {
  orderId: number;
  storeId: number;
  buyerId: number;
  storeName: string;
  productName: string;
  quantity: number;
  lineTotal: string;
};
export type Summary = RequestRow & { context: Context };
export type Detail = {
  request: RequestRow & {
    reasonCode: string;
    description: string;
    deadlineAt: string;
    receivedAt: string | null;
    restockable: boolean | null;
  };
  context: Context;
  history: {
    id: string;
    actorId: number;
    fromState: string | null;
    toState: string;
    fromRevision: number;
    toRevision: number;
    reason: string;
    createdAt: string;
  }[];
  nextBeforeRevision: number | null;
  refund: {
    id: string;
    amount: string;
    currency: "VND";
    mode: "SIMULATED";
    succeededAt: string;
  } | null;
};
export type Resolution = {
  commandId: string;
  outcome: "APPLIED" | "CLOSED";
  receipt: {
    request: RequestRow;
    historyId: string;
    refund: {
      id: string;
      amount: string;
      currency: "VND";
      mode: "SIMULATED";
    } | null;
  } | null;
  current: RequestRow | null;
};
type Requester = (path: string, options: ApiRequestOptions) => Promise<unknown>;
const invalid = (): never => {
  throw new ApiError(
    "Phản hồi hậu mãi không hợp lệ; giữ mã yêu cầu để đối chiếu.",
    502,
  );
};
const text = (v: unknown) => (typeof v === "string" ? v : invalid());
const timestamp = (v: unknown): string => {
  const s = text(v);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString() === s
    ? s
    : invalid();
};
const bigintId = (v: unknown): string =>
  typeof v === "string" &&
  /^[1-9][0-9]{0,18}$/.test(v) &&
  BigInt(v) <= 9223372036854775807n
    ? v
    : invalid();
function context(value: unknown, actorId: number, scope: Scope): Context {
  const c = record(value);
  const buyerId = positive(c.buyerId);
  if (scope === "BUYER" && buyerId !== actorId) return invalid();
  return {
    orderId: positive(c.orderId),
    storeId: positive(c.storeId),
    buyerId,
    storeName: text(c.storeName),
    productName: text(c.productName),
    quantity: positive(c.quantity),
    lineTotal: money(c.lineTotal),
  };
}
function refund(value: unknown) {
  const r = record(value);
  if (
    r.currency !== "VND" ||
    r.mode !== "SIMULATED" ||
    BigInt(money(r.amount).replace(".", "")) <= 0n
  )
    return invalid();
  return {
    id: bigintId(r.id),
    amount: r.amount as string,
    currency: "VND" as const,
    mode: "SIMULATED" as const,
  };
}
export function parseResolution(
  value: unknown,
  intent: Intent,
  reconcile: boolean,
): Resolution {
  const r = record(value, "commandId,current,outcome,receipt");
  if (
    r.commandId !== intent.commandId ||
    (r.outcome !== 'APPLIED' && !(reconcile && r.outcome === 'CLOSED'))
  )
    return invalid();
  const expected = intent.expected;
  const current = r.current === null ? null : parseRequest(r.current);
  if (
    intent.action === "create"
      ? current !== null && (current.orderItemId !== expected.orderItemId || current.kind !== expected.kind)
      : !current ||
        current.id !== intent.targetId ||
        current.orderItemId !== expected.orderItemId ||
        current.kind !== expected.kind
  )
    return invalid();
  if (r.outcome === "CLOSED") {
    if (r.receipt !== null || (intent.action === 'create' && current !== null)) return invalid();
    return {
      commandId: intent.commandId,
      outcome: "CLOSED",
      current,
      receipt: null,
    };
  }
  const receipt = record(r.receipt, "historyId,refund,request"),
    request = parseRequest(receipt.request);
  if (
    (expected.requestId !== null && request.id !== expected.requestId) ||
    request.orderItemId !== expected.orderItemId ||
    request.kind !== expected.kind ||
    request.state !== expected.state ||
    request.revision !== expected.revision ||
    (current !== null && (current.id !== request.id || current.orderItemId !== request.orderItemId || current.kind !== request.kind || current.revision < request.revision))
  )
    return invalid();
  const itemRefund = receipt.refund === null ? null : refund(receipt.refund);
  if (
    expected.refundAmount === null
      ? itemRefund !== null
      : !itemRefund || itemRefund.amount !== expected.refundAmount
  )
    return invalid();
  return {
    commandId: intent.commandId,
    outcome: "APPLIED",
    current,
    receipt: {
      request,
      historyId: bigintId(receipt.historyId),
      refund: itemRefund,
    },
  };
}
export function aftersaleApi(
  actorId: number,
  scope: Scope,
  requester: Requester = fetchApi,
) {
  positive(actorId);
  if (!["BUYER", "SELLER", "ADMIN"].includes(scope)) return invalid();
  const base =
    scope === "BUYER"
      ? "/aftersales"
      : scope === "SELLER"
        ? "/seller/aftersales"
        : "/admin/aftersales";
  async function send(
    pending: Pending,
    signal: AbortSignal,
    body?: Body,
  ): Promise<Resolution> {
    const session = getAuthSessionVersion(),
      stored = loadPending(actorId);
    if (!stored || stored.raw !== pending.raw || stored.value.scope !== scope)
      return invalid();
    const { value: intent, raw } = stored;
    const reconcile = body === undefined,
      snapshot = reconcile ? undefined : normalizeBody(intent.action, body);
    if (
      snapshot &&
      (await fingerprint(scope, intent.action, intent.targetId, snapshot)) !==
        intent.requestHash
    )
      return invalid();
    signal.throwIfAborted();
    if (
      session !== getAuthSessionVersion() ||
      loadPending(actorId)?.raw !== raw
    )
      throw Error("Phiên hoặc mã chờ đã đổi; chưa gửi yêu cầu.");
    const path = reconcile
      ? `${base}/commands/${intent.action}/${intent.targetId}/reconcile`
      : intent.action === "create"
        ? `${base}/items/${intent.targetId}/requests`
        : `${base}/requests/${intent.targetId}/${intent.action}`;
    const response = await requester(path, {
      method: "POST",
      signal,
      retryOnUnauthorized: false,
      body: JSON.stringify(
        reconcile
          ? { commandId: intent.commandId, requestHash: intent.requestHash }
          : { commandId: intent.commandId, ...snapshot },
      ),
    });
    if (session !== getAuthSessionVersion())
      throw Error("Phiên đã thay đổi; giữ mã yêu cầu cho tài khoản gốc.");
    const resolution = parseResolution(response, intent, reconcile);
    clearPending(actorId, raw, session);
    return resolution;
  }
  return {
    async list(signal: AbortSignal, beforeId?: number) {
      if (beforeId !== undefined) positive(beforeId);
      const query = new URLSearchParams({
        limit: "20",
        ...(beforeId ? { beforeId: String(beforeId) } : {}),
      });
      const r = record(
        await requester(`${base}?${query}`, {
          method: "GET",
          cache: "no-store",
          signal,
        }),
        "items,nextBeforeId",
      );
      if (!Array.isArray(r.items) || r.items.length > 20) return invalid();
      let previous = beforeId ?? 2147483648;
      const items: Summary[] = r.items.map((value) => {
        const row = parseRequest(value),
          c = context(record(value).context, actorId, scope);
        if (row.id >= previous) return invalid();
        previous = row.id;
        return { ...row, context: c };
      });
      const next = r.nextBeforeId === null ? null : positive(r.nextBeforeId);
      if (next !== null && (items.length !== 20 || next !== previous))
        return invalid();
      return { items, nextBeforeId: next };
    },
    async detail(
      id: number,
      signal: AbortSignal,
      beforeRevision?: number,
    ): Promise<Detail> {
      positive(id);
      if (beforeRevision !== undefined) positive(beforeRevision);
      const query = new URLSearchParams({
        limit: "20",
        ...(beforeRevision ? { beforeRevision: String(beforeRevision) } : {}),
      });
      const r = record(
        await requester(`${base}/requests/${id}?${query}`, {
          method: "GET",
          cache: "no-store",
          signal,
        }),
        "context,history,nextBeforeRevision,refund,request",
      );
      const row = parseRequest(r.request),
        raw = record(r.request);
      if (
        row.id !== id ||
        !Array.isArray(r.history) ||
        r.history.length > 20 ||
        (raw.restockable !== null && typeof raw.restockable !== "boolean")
      )
        return invalid();
      const c = context(r.context, actorId, scope);
      let previous = beforeRevision ?? 2147483648;
      const history = r.history.map((value) => {
        const h = record(value),
          toRevision = positive(h.toRevision);
        if (
          toRevision >= previous ||
          toRevision > row.revision ||
          h.fromRevision !== toRevision - 1 ||
          !states.includes(h.toState as RequestRow["state"]) ||
          (h.fromState !== null &&
            !states.includes(h.fromState as RequestRow["state"]))
        )
          return invalid();
        previous = toRevision;
        return {
          id: bigintId(h.id),
          actorId: positive(h.actorId),
          fromState: h.fromState as string | null,
          toState: h.toState as string,
          fromRevision: toRevision - 1,
          toRevision,
          reason: text(h.reason),
          createdAt: timestamp(h.createdAt),
        };
      });
      const next =
        r.nextBeforeRevision === null ? null : positive(r.nextBeforeRevision);
      if (next !== null && (history.length !== 20 || next !== previous))
        return invalid();
      const ref =
        r.refund === null
          ? null
          : {
              ...refund(r.refund),
              succeededAt: timestamp(record(r.refund).succeededAt),
            };
      if (
        row.state === "REFUNDED"
          ? !ref || ref.amount !== c.lineTotal
          : ref !== null
      )
        return invalid();
      return {
        request: {
          ...row,
          reasonCode: text(raw.reasonCode),
          description: text(raw.description),
          deadlineAt: timestamp(raw.deadlineAt),
          receivedAt:
            raw.receivedAt === null ? null : timestamp(raw.receivedAt),
          restockable: raw.restockable as boolean | null,
        },
        context: c,
        history,
        nextBeforeRevision: next,
        refund: ref,
      };
    },
    execute(pending: Pending, body: Body, signal: AbortSignal) {
      if (body === undefined) return invalid();
      return send(pending, signal, body);
    },
    reconcile(pending: Pending, signal: AbortSignal, consent: boolean) {
      if (consent !== true)
        throw Error("Cần đồng ý đối chiếu mã yêu cầu trước khi tiếp tục.");
      return send(pending, signal);
    },
  };
}
export type AftersaleApi = ReturnType<typeof aftersaleApi>;
