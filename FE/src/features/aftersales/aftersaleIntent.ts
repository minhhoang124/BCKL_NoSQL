import { getAuthSessionVersion } from "../../services/apiClient";

export type Scope = "BUYER" | "SELLER" | "ADMIN";
export type Action =
  "create" | "cancel" | "dispute" | "approve" | "reject" | "receive";
export type Kind = "REFUND_ONLY" | "RETURN_AND_REFUND";
export type State =
  | "PENDING"
  | "REJECTED"
  | "CANCELLED"
  | "DISPUTED"
  | "AWAITING_RETURN"
  | "REFUNDED"
  | "ADMIN_REJECTED";
export type RequestRow = {
  id: number;
  orderItemId: number;
  kind: Kind;
  state: State;
  revision: number;
};
export type Body =
  | { kind: Kind; reasonCode: string; description: string }
  | { expectedRevision: number; reason: string; restockable?: boolean };
export type Intent = {
  version: 1;
  actorId: number;
  scope: Scope;
  action: Action;
  targetId: number;
  commandId: string;
  requestHash: string;
  expected: {
    requestId: number | null;
    orderItemId: number;
    kind: Kind;
    state: State;
    revision: number;
    refundAmount: string | null;
  };
};
export type Pending = { value: Intent; raw: string };
const prefix = (actorId: number) => `aftersale-pending:v1:${actorId}`;
export const kinds: readonly Kind[] = ["REFUND_ONLY", "RETURN_AND_REFUND"];
export const states: readonly State[] = [
  "PENDING",
  "REJECTED",
  "CANCELLED",
  "DISPUTED",
  "AWAITING_RETURN",
  "REFUNDED",
  "ADMIN_REJECTED",
];
export const actions: readonly Action[] = [
  "create",
  "cancel",
  "dispute",
  "approve",
  "reject",
  "receive",
];
const invalid = (): never => {
  throw Error(
    "Dữ liệu yêu cầu hậu mãi không hợp lệ; cần đối chiếu, không tự xóa mã chờ.",
  );
};
export function record(value: unknown, keys?: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (keys && Object.keys(value).sort().join(",") !== keys)
  )
    return invalid();
  return value as Record<string, unknown>;
}
export function positive(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 2147483647
    ? value
    : invalid();
}
export function money(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,11})\.00$/.test(value))
    return invalid();
  return value;
}
export function parseRequest(value: unknown): RequestRow {
  const r = record(value);
  if (!kinds.includes(r.kind as Kind) || !states.includes(r.state as State))
    return invalid();
  return {
    id: positive(r.id),
    orderItemId: positive(r.orderItemId),
    kind: r.kind as Kind,
    state: r.state as State,
    revision: positive(r.revision),
  };
}
export function normalizeReason(value: unknown) {
  if (
    typeof value !== "string" ||
    /[\p{Cc}\p{Cs}]/u.test(value.replace(/[\t\n\r]/g, ""))
  )
    return invalid();
  const normalized = value.normalize("NFC").trim();
  if ([...normalized].length < 10 || [...normalized].length > 1000)
    return invalid();
  return normalized;
}
export function nextState(scope: Scope, action: Action, r: RequestRow): State {
  if (scope === "BUYER" && action === "cancel" && r.state === "PENDING")
    return "CANCELLED";
  if (scope === "BUYER" && action === "dispute" && r.state === "REJECTED")
    return "DISPUTED";
  const decide =
    (scope === "SELLER" && r.state === "PENDING") ||
    (scope === "ADMIN" && r.state === "DISPUTED");
  if (decide && action === "reject")
    return scope === "ADMIN" ? "ADMIN_REJECTED" : "REJECTED";
  if (decide && action === "approve")
    return r.kind === "REFUND_ONLY" ? "REFUNDED" : "AWAITING_RETURN";
  if (
    (scope === "SELLER" || scope === "ADMIN") &&
    action === "receive" &&
    r.state === "AWAITING_RETURN" &&
    r.kind === "RETURN_AND_REFUND"
  )
    return "REFUNDED";
  return invalid();
}
export function normalizeBody(action: Action, value: unknown): Body {
  const r = record(
    value,
    action === "create"
      ? "description,kind,reasonCode"
      : action === "receive"
        ? "expectedRevision,reason,restockable"
        : "expectedRevision,reason",
  );
  if (action === "create") {
    if (
      !kinds.includes(r.kind as Kind) ||
      typeof r.reasonCode !== "string" ||
      !["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "OTHER"].includes(
        r.reasonCode,
      )
    )
      return invalid();
    return Object.freeze({
      kind: r.kind as Kind,
      reasonCode: r.reasonCode as string,
      description: normalizeReason(r.description),
    });
  }
  const base = {
    expectedRevision: positive(r.expectedRevision),
    reason: normalizeReason(r.reason),
  };
  if (action === "receive" && typeof r.restockable !== "boolean")
    return invalid();
  return Object.freeze(
    action === "receive"
      ? { ...base, restockable: r.restockable as boolean }
      : base,
  );
}
export async function fingerprint(
  scope: Scope,
  action: Action,
  targetId: number,
  body: Body,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ scope, action, targetId, body }),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function loadPending(actorId: number): Pending | null {
  positive(actorId);
  const raw = sessionStorage.getItem(prefix(actorId));
  if (raw === null) return null;
  if (raw.length > 2048) return invalid();
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return invalid();
  }
  const r = record(
    decoded,
    "action,actorId,commandId,expected,requestHash,scope,targetId,version",
  );
  const e = record(
    r.expected,
    "kind,orderItemId,refundAmount,requestId,revision,state",
  );
  if (
    r.version !== 1 ||
    r.actorId !== actorId ||
    !["BUYER", "SELLER", "ADMIN"].includes(String(r.scope)) ||
    !actions.includes(r.action as Action) ||
    typeof r.commandId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      r.commandId,
    ) ||
    typeof r.requestHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(r.requestHash) ||
    !kinds.includes(e.kind as Kind) ||
    !states.includes(e.state as State)
  )
    return invalid();
  const targetId = positive(r.targetId),
    revision = positive(e.revision),
    itemId = positive(e.orderItemId);
  if (r.action === "create") {
    if (
      r.scope !== "BUYER" ||
      e.requestId !== null ||
      itemId !== targetId ||
      revision !== 1 ||
      e.state !== "PENDING"
    )
      return invalid();
  } else {
    if (
      e.requestId !== targetId ||
      revision < 2 ||
      (r.scope === "BUYER"
        ? !["cancel", "dispute"].includes(r.action as string)
        : !["approve", "reject", "receive"].includes(r.action as string))
    )
      return invalid();
    const expectedState =
      r.action === "cancel"
        ? "CANCELLED"
        : r.action === "dispute"
          ? "DISPUTED"
          : r.action === "reject"
            ? r.scope === "ADMIN"
              ? "ADMIN_REJECTED"
              : "REJECTED"
            : r.action === "approve"
              ? e.kind === "REFUND_ONLY"
                ? "REFUNDED"
                : "AWAITING_RETURN"
              : "REFUNDED";
    if (
      e.state !== expectedState ||
      (r.action === "receive" && e.kind !== "RETURN_AND_REFUND")
    )
      return invalid();
  }
  if (e.refundAmount !== null) {
    money(e.refundAmount);
    if (
      e.state !== "REFUNDED" ||
      BigInt((e.refundAmount as string).replace(".", "")) <= 0n
    )
      return invalid();
  } else if (e.state === "REFUNDED") return invalid();
  return {
    raw,
    value: Object.freeze({
      version: 1,
      actorId,
      scope: r.scope as Scope,
      action: r.action as Action,
      targetId,
      commandId: r.commandId,
      requestHash: r.requestHash,
      expected: Object.freeze({
        requestId: e.requestId === null ? null : positive(e.requestId),
        orderItemId: itemId,
        kind: e.kind as Kind,
        state: e.state as State,
        revision,
        refundAmount: e.refundAmount as string | null,
      }),
    }),
  };
}
export async function prepareIntent(
  actorId: number,
  scope: Scope,
  action: Action,
  targetId: number,
  value: unknown,
  request?: RequestRow,
  lineTotal?: string,
) {
  const session = getAuthSessionVersion();
  positive(actorId);
  positive(targetId);
  if (
    !["BUYER", "SELLER", "ADMIN"].includes(scope) ||
    !actions.includes(action) ||
    loadPending(actorId)
  )
    return invalid();
  const body = normalizeBody(action, value);
  let expected: Intent["expected"];
  if (action === "create") {
    if (scope !== "BUYER" || !("kind" in body)) return invalid();
    expected = {
      requestId: null,
      orderItemId: targetId,
      kind: body.kind,
      state: "PENDING",
      revision: 1,
      refundAmount: null,
    };
  } else {
    const row = parseRequest(request);
    if (
      row.id !== targetId ||
      !("expectedRevision" in body) ||
      body.expectedRevision !== row.revision
    )
      return invalid();
    const state = nextState(scope, action, row);
    expected = {
      requestId: row.id,
      orderItemId: row.orderItemId,
      kind: row.kind,
      state,
      revision: positive(row.revision + 1),
      refundAmount: state === "REFUNDED" ? money(lineTotal) : null,
    };
    if (
      expected.refundAmount !== null &&
      BigInt(expected.refundAmount.replace(".", "")) <= 0n
    )
      return invalid();
  }
  const commandId = crypto.randomUUID();
  const requestHash = await fingerprint(scope, action, targetId, body);
  if (
    session !== getAuthSessionVersion() ||
    sessionStorage.getItem(prefix(actorId)) !== null
  )
    throw Error("Phiên hoặc yêu cầu chờ đã đổi; chưa gửi thao tác.");
  const intent: Intent = Object.freeze({
    version: 1,
    actorId,
    scope,
    action,
    targetId,
    commandId,
    requestHash,
    expected: Object.freeze(expected),
  });
  const raw = JSON.stringify(intent);
  sessionStorage.setItem(prefix(actorId), raw);
  if (sessionStorage.getItem(prefix(actorId)) !== raw)
    throw Error("Không giữ được mã yêu cầu; chưa gửi thao tác.");
  return { value: intent, raw, body, session };
}
export function clearPending(actorId: number, raw: string, session: number) {
  if (
    session !== getAuthSessionVersion() ||
    sessionStorage.getItem(prefix(actorId)) !== raw
  )
    throw Error("Phiên hoặc mã chờ đã đổi; không xóa yêu cầu khác.");
  sessionStorage.removeItem(prefix(actorId));
  if (sessionStorage.getItem(prefix(actorId)) !== null)
    throw Error("Không thể khép mã yêu cầu; cần kiểm tra bộ nhớ của tab.");
}
