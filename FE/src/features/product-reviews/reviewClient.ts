import {
  fetchApi,
  getAuthSessionVersion,
  type ApiRequestOptions,
} from "../../services/apiClient";
export type Scope = "BUYER" | "SELLER" | "ADMIN";
export type Action = "create" | "edit" | "reply" | "hide";
export type Body = {
  confirmed: true;
  expectedRevision?: number;
  rating?: number;
  body?: string;
  reason?: string;
};
export type Reply = { body: string; createdAt: string };
export type Review = {
  id: number;
  orderItemId: number;
  productId: number;
  storeId: number;
  revision: number;
  rating: number;
  body: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  reply: Reply | null;
  isRefunded: boolean;
};
export type Summary = Review & { productName: string };
export type History = {
  revision: number;
  action: Action;
  rating: number;
  body: string;
  hidden: boolean;
  replyBody: string | null;
  reason?: string | null;
  createdAt: string;
};
export type View = {
  orderItemId: number;
  productName: string;
  deadline: string | null;
  canCreate: boolean;
  canEdit: boolean;
  review: Review | null;
  historyTruncated: boolean;
  history: History[];
};
export type Intent = {
  version: 1;
  actorId: number;
  scope: Scope;
  action: Action;
  orderItemId: number;
  commandId: string;
  requestHash: string;
  expected: {
    reviewId: number | null;
    revision: number;
    rating: number;
    hidden: boolean;
  };
};
export type Pending = { raw: string; value: Intent };
type Requester = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
const key = (id: number) => `product-review-pending:v1:${id}`;
const invalid = (): never => {
  throw new Error(
    "Dữ liệu đánh giá không hợp lệ. Giữ mã yêu cầu và tải lại để kiểm tra.",
  );
};
const number = (x: unknown): number =>
  typeof x === "number" && Number.isInteger(x) && x > 0 && x <= 2147483647
    ? x
    : invalid();
const rating = (x: unknown) => (number(x) <= 5 ? (x as number) : invalid());
const bool = (x: unknown) => (typeof x === "boolean" ? x : invalid());
const object = (x: unknown, fields: string[]): Record<string, unknown> =>
  x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  Object.keys(x).sort().join(",") === [...fields].sort().join(",")
    ? (x as Record<string, unknown>)
    : invalid();
function text(x: unknown, min = 1, max = 2000) {
  if (typeof x !== "string") return invalid();
  const v = x.replace(/\r\n/g, "\n").normalize("NFC").trim();
  if (
    [...v].length < min ||
    [...v].length > max ||
    /[\p{Cc}\p{Cs}]/u.test(v.replace(/\n/g, ""))
  )
    return invalid();
  return v;
}
const date = (x: unknown): string =>
  typeof x === "string" &&
  Number.isFinite(Date.parse(x)) &&
  new Date(x).toISOString() === x
    ? x
    : invalid();
function actionScope(scope: unknown, action: unknown) {
  if (!(
    (scope === "BUYER" && (action === "create" || action === "edit")) ||
    (scope === "SELLER" && action === "reply") ||
    (scope === "ADMIN" && action === "hide")
  ))
    invalid();
}
const uuid = (x: unknown): string =>
  typeof x === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    x,
  )
    ? x
    : invalid();
const hash = (x: unknown): string =>
  typeof x === "string" && /^[0-9a-f]{64}$/.test(x) ? x : invalid();
export function normalize(scope: Scope, action: Action, raw: unknown): Body {
  actionScope(scope, action);
  const r = object(raw, [
    "confirmed",
    ...(action === "create" ? [] : ["expectedRevision"]),
    ...(scope === "BUYER"
      ? ["rating", "body"]
      : action === "reply"
        ? ["body"]
        : ["reason"]),
  ]);
  if (r.confirmed !== true) return invalid();
  const b: Body = { confirmed: true };
  if (action !== "create") b.expectedRevision = number(r.expectedRevision);
  if (scope === "BUYER") b.rating = rating(r.rating);
  if (scope === "BUYER" || action === "reply") b.body = text(r.body);
  if (action === "hide") b.reason = text(r.reason, 10, 500);
  return Object.freeze(b);
}
export async function fingerprint(
  scope: Scope,
  action: Action,
  itemId: number,
  body: Body,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      scope,
      action,
      orderItemId: number(itemId),
      body,
    }),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function reply(raw: unknown): Reply | null {
  if (raw === null) return null;
  const r = object(raw, ["body", "createdAt"]);
  return { body: text(r.body), createdAt: date(r.createdAt) };
}
const reviewFields = [
  "id",
  "orderItemId",
  "productId",
  "storeId",
  "revision",
  "rating",
  "body",
  "hidden",
  "createdAt",
  "updatedAt",
  "reply",
  "isRefunded",
];
function review(raw: unknown): Review {
  const r = object(raw, reviewFields);
  return {
    id: number(r.id),
    orderItemId: number(r.orderItemId),
    productId: number(r.productId),
    storeId: number(r.storeId),
    revision: number(r.revision),
    rating: rating(r.rating),
    body: text(r.body),
    hidden: bool(r.hidden),
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
    reply: reply(r.reply),
    isRefunded: bool(r.isRefunded),
  };
}
function parseView(raw: unknown, itemId: number, scope: Scope): View {
  const r = object(raw, [
    "orderItemId",
    "productName",
    "deadline",
    "canCreate",
    "canEdit",
    "review",
    "historyTruncated",
    "history",
  ]);
  if (
    r.orderItemId !== itemId ||
    !Array.isArray(r.history) ||
    r.history.length > 50
  )
    return invalid();
  const current = r.review === null ? null : review(r.review);
  if (current && current.orderItemId !== itemId) return invalid();
  const history: History[] = r.history.map((raw) => {
    const a = object(raw, [
      "revision",
      "action",
      "rating",
      "body",
      "hidden",
      "replyBody",
      ...(scope === "ADMIN" ? ["reason"] : []),
      "createdAt",
    ]);
    if (!["create", "edit", "reply", "hide"].includes(a.action as string))
      return invalid();
    return {
      revision: number(a.revision),
      action: a.action as Action,
      rating: rating(a.rating),
      body: text(a.body),
      hidden: bool(a.hidden),
      replyBody: a.replyBody === null ? null : text(a.replyBody),
      ...(scope === "ADMIN"
        ? { reason: a.reason === null ? null : text(a.reason, 10, 500) }
        : {}),
      createdAt: date(a.createdAt),
    };
  });
  if (
    current ? history[0]?.revision !== current.revision : history.length !== 0
  )
    return invalid();
  for (let i = 1; i < history.length; i++)
    if (history[i].revision !== history[i - 1].revision - 1) return invalid();
  const canCreate = bool(r.canCreate),
    canEdit = bool(r.canEdit);
  if (
    (scope !== "BUYER" && (canCreate || canEdit)) ||
    (canCreate && !!current) ||
    (canEdit && !current)
  )
    return invalid();
  return {
    orderItemId: itemId,
    productName: text(r.productName, 1, 500),
    deadline: r.deadline === null ? null : date(r.deadline),
    canCreate,
    canEdit,
    review: current,
    historyTruncated: bool(r.historyTruncated),
    history,
  };
}
export function loadPending(actorId: number): Pending | null {
  number(actorId);
  const raw = sessionStorage.getItem(key(actorId));
  if (raw === null) return null;
  if (raw.length > 1300) return invalid();
  const r = object(JSON.parse(raw), [
      "version",
      "actorId",
      "scope",
      "action",
      "orderItemId",
      "commandId",
      "requestHash",
      "expected",
    ]),
    e = object(r.expected, ["reviewId", "revision", "rating", "hidden"]);
  if (r.version !== 1 || r.actorId !== actorId) return invalid();
  actionScope(r.scope, r.action);
  const action = r.action as Action,
    revision = number(e.revision),
    reviewId = e.reviewId === null ? null : number(e.reviewId),
    hidden = bool(e.hidden);
  if (
    action === "create"
      ? reviewId !== null || revision !== 1 || hidden
      : reviewId === null || revision < 2
  )
    return invalid();
  if (action === "hide" && !hidden) return invalid();
  return {
    raw,
    value: Object.freeze({
      version: 1,
      actorId,
      scope: r.scope as Scope,
      action,
      orderItemId: number(r.orderItemId),
      commandId: uuid(r.commandId),
      requestHash: hash(r.requestHash),
      expected: Object.freeze({
        reviewId,
        revision,
        rating: rating(e.rating),
        hidden,
      }),
    }),
  };
}
export async function prepare(
  actorId: number,
  scope: Scope,
  action: Action,
  itemId: number,
  raw: unknown,
  current: Review | null,
) {
  const epoch = getAuthSessionVersion();
  number(actorId);
  number(itemId);
  if (loadPending(actorId)) throw Error("Còn yêu cầu đánh giá chờ đối chiếu.");
  const body = normalize(scope, action, raw);
  if (
    action === "create"
      ? current !== null
      : !current ||
        current.orderItemId !== itemId ||
        body.expectedRevision !== current.revision
  )
    return invalid();
  if (
    (action === "reply" && current?.reply) ||
    (action === "hide" && current?.hidden)
  )
    return invalid();
  const expected = Object.freeze({
    reviewId: current?.id ?? null,
    revision: action === "create" ? 1 : number(current!.revision + 1),
    rating: scope === "BUYER" ? body.rating! : current!.rating,
    hidden: action === "hide" || !!current?.hidden,
  });
  const commandId = crypto.randomUUID(),
    requestHash = await fingerprint(scope, action, itemId, body);
  if (
    epoch !== getAuthSessionVersion() ||
    sessionStorage.getItem(key(actorId)) !== null
  )
    return invalid();
  const value: Intent = Object.freeze({
      version: 1,
      actorId,
      scope,
      action,
      orderItemId: itemId,
      commandId,
      requestHash,
      expected,
    }),
    serialized = JSON.stringify(value);
  sessionStorage.setItem(key(actorId), serialized);
  if (sessionStorage.getItem(key(actorId)) !== serialized) return invalid();
  return { pending: { raw: serialized, value }, body };
}
export function createReviewApi(
  actorId: number,
  scope: Scope,
  requester: Requester = fetchApi,
) {
  const epoch = getAuthSessionVersion();
  const check = () => {
    if (epoch !== getAuthSessionVersion()) return invalid();
  };
  async function send(p: Pending, signal: AbortSignal, body?: Body) {
    check();
    const stored = loadPending(actorId);
    if (!stored || stored.raw !== p.raw || stored.value.scope !== scope)
      return invalid();
    const i = stored.value,
      snapshot =
        body === undefined ? undefined : normalize(scope, i.action, body);
    if (
      snapshot &&
      (await fingerprint(scope, i.action, i.orderItemId, snapshot)) !==
        i.requestHash
    )
      return invalid();
    signal.throwIfAborted();
    check();
    if (sessionStorage.getItem(key(actorId)) !== p.raw) return invalid();
    const path = snapshot
      ? scope === "BUYER"
        ? `/account/order-items/${i.orderItemId}/review/${i.action}`
        : scope === "SELLER"
          ? `/seller/reviews/${i.orderItemId}/reply`
          : `/admin/reviews/${i.orderItemId}/hide`
      : `/review-commands/${scope}/${i.action}/${i.orderItemId}/reconcile`;
    const r = object(
      await requester(path, {
        method: "POST",
        signal,
        retryOnUnauthorized: false,
        body: JSON.stringify(
          snapshot
            ? { commandId: i.commandId, ...snapshot }
            : {
                commandId: i.commandId,
                requestHash: i.requestHash,
                confirmed: true,
              },
        ),
      }),
      ["commandId", "outcome", "receipt"],
    );
    check();
    if (r.commandId !== i.commandId) return invalid();
    if (r.outcome === "CLOSED") {
      if (snapshot || r.receipt !== null) return invalid();
    } else if (r.outcome === "APPLIED") {
      const x = object(r.receipt, [
          "orderItemId",
          "reviewId",
          "revision",
          "rating",
          "hidden",
          "action",
          "auditId",
        ]),
        e = i.expected;
      if (
        x.orderItemId !== i.orderItemId ||
        x.action !== i.action ||
        x.revision !== e.revision ||
        x.rating !== e.rating ||
        x.hidden !== e.hidden ||
        (e.reviewId !== null && x.reviewId !== e.reviewId) ||
        typeof x.auditId !== "string" ||
        !/^[1-9][0-9]*$/.test(x.auditId) ||
        BigInt(x.auditId) > 9223372036854775807n
      )
        return invalid();
      number(x.reviewId);
    } else return invalid();
    signal.throwIfAborted();
    check();
    if (sessionStorage.getItem(key(actorId)) !== p.raw) return invalid();
    sessionStorage.removeItem(key(actorId));
    if (sessionStorage.getItem(key(actorId)) !== null) return invalid();
    return r.outcome as "APPLIED" | "CLOSED";
  }
  return {
    async detail(itemId: number, signal: AbortSignal) {
      check();
      if (scope === "SELLER") return invalid();
      const data = await requester(
        scope === "ADMIN"
          ? `/admin/reviews/${number(itemId)}`
          : `/account/order-items/${number(itemId)}/review`,
        { signal, cache: "no-store" },
      );
      check();
      return parseView(data, itemId, scope);
    },
    async list(signal: AbortSignal, before?: number) {
      check();
      if (scope === "BUYER") return invalid();
      const r = object(
        await requester(
          `/${scope === "ADMIN" ? "admin" : "seller"}/reviews?limit=20${before ? `&beforeId=${number(before)}` : ""}`,
          { signal, cache: "no-store" },
        ),
        ["items", "nextBeforeId"],
      );
      check();
      if (!Array.isArray(r.items) || r.items.length > 20) return invalid();
      const items = r.items.map((raw) => {
        const x = object(raw, [...reviewFields, "productName"]);
        const { productName, ...base } = x;
        return { ...review(base), productName: text(productName, 1, 500) };
      });
      for (let n = 0; n < items.length; n++)
        if (
          (n && items[n].id >= items[n - 1].id) ||
          (before && items[n].id >= before)
        )
          return invalid();
      const next = r.nextBeforeId === null ? null : number(r.nextBeforeId);
      if (next !== null && next !== items.at(-1)?.id) return invalid();
      return { items, nextBeforeId: next };
    },
    execute(p: Pending, body: Body, signal: AbortSignal) {
      if (body === undefined)
        return Promise.reject(Error("Thiếu nội dung đã xác nhận."));
      return send(p, signal, body);
    },
    reconcile(p: Pending, signal: AbortSignal, confirmed: boolean) {
      if (confirmed !== true)
        return Promise.reject(Error("Cần đồng ý đối chiếu."));
      return send(p, signal);
    },
  };
}
export type PublicPage = {
  productId: number;
  count: number;
  average: number | null;
  counts: Record<string, number>;
  items: Array<{
    id: number;
    rating: number;
    body: string;
    author: string;
    createdAt: string;
    updatedAt: string;
    reply: Reply | null;
    isRefunded: boolean;
  }>;
  nextBeforeId: number | null;
};
export async function readPublic(
  productId: number,
  signal: AbortSignal,
  before?: number,
  requester: Requester = fetchApi,
): Promise<PublicPage> {
  const r = object(
    await requester(
      `/products/${number(productId)}/reviews?limit=20${before ? `&beforeId=${number(before)}` : ""}`,
      { signal, cache: "no-store" },
    ),
    ["productId", "count", "average", "counts", "items", "nextBeforeId"],
  );
  if (
    r.productId !== productId ||
    typeof r.count !== "number" ||
    !Number.isSafeInteger(r.count) ||
    r.count < 0 ||
    !Array.isArray(r.items) ||
    r.items.length > 20
  )
    return invalid();
  const c = object(r.counts, ["1", "2", "3", "4", "5"]),
    counts: Record<string, number> = {};
  let count = 0,
    sum = 0;
  for (const k of ["1", "2", "3", "4", "5"]) {
    const v = c[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
      return invalid();
    counts[k] = v;
    count += v;
    sum += Number(k) * v;
  }
  if (
    count !== r.count ||
    r.average !== (count ? Math.round((sum / count) * 10) / 10 : null)
  )
    return invalid();
  const items = r.items.map((raw) => {
    const x = object(raw, [
      "id",
      "rating",
      "body",
      "author",
      "createdAt",
      "updatedAt",
      "reply",
      "isRefunded",
    ]);
    if (x.author !== "Người mua đã xác minh") return invalid();
    return {
      id: number(x.id),
      rating: rating(x.rating),
      body: text(x.body),
      author: x.author,
      createdAt: date(x.createdAt),
      updatedAt: date(x.updatedAt),
      reply: reply(x.reply),
      isRefunded: bool(x.isRefunded),
    };
  });
  if (items.length > count) return invalid();
  for (let n = 0; n < items.length; n++)
    if (
      (n && items[n].id >= items[n - 1].id) ||
      (before && items[n].id >= before)
    )
      return invalid();
  const next = r.nextBeforeId === null ? null : number(r.nextBeforeId);
  if (next !== null && next !== items.at(-1)?.id) return invalid();
  return {
    productId,
    count,
    average: r.average as number | null,
    counts,
    items,
    nextBeforeId: next,
  };
}
