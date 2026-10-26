import { fetchApi, type ApiRequestOptions } from "../../services/apiClient";

export type Scope = "ADMIN" | "SELLER";
export type Query = {
  from: string;
  to: string;
  bucket: "day" | "month" | "quarter";
};
export function defaultQuery(now = new Date()): Query {
  const local = new Date(now.getTime() + 7 * 3600000);
  local.setUTCDate(1);
  const from = local.toISOString().slice(0, 10);
  local.setUTCMonth(local.getUTCMonth() + 1);
  return { from, to: local.toISOString().slice(0, 10), bucket: "day" };
}
export type Money = {
  completedOrderCount: number;
  grossMerchandise: string;
  effectiveRefundMerchandise: string;
  netMerchandise: string;
  completedShipping: string;
};
export type Window = {
  periodStart: string;
  from: string;
  to: string;
  partial: boolean;
};
export type Summary = {
  scope: Scope;
  store: { id: number; name: string; status: string } | null;
  asOf: string;
  totals: Money;
  buckets: (Money & Window)[];
  pendingRefundMerchandise: string;
  invalidSnapshotOrderCount: number;
  orders: Record<string, number>;
  products: {
    bySellerStatus: Record<string, number>;
    byModerationStatus: Record<string, number>;
  };
  stores?: Record<string, number>;
  users?: Record<string, { active: number; inactive: number }>;
};
export type Quality = {
  items: { orderId: number; storeId: number; issues: string[] }[];
  nextBeforeId: number | null;
  asOf: string;
};
type Requester = (path: string, options: ApiRequestOptions) => Promise<unknown>;
const stores = ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "CLOSED"];
const orders = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PACKING",
  "READY_TO_SHIP",
  "SHIPPING",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "DELIVERY_FAILED",
];
const invalid = () => {
  throw new Error(
    "Dữ liệu thống kê không hợp lệ. Vui lòng tải lại hoặc liên hệ quản trị.",
  );
};
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : invalid();
const text = (v: unknown) =>
  typeof v === "string" && v.length > 0 ? v : invalid();
const count = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
const id = (v: unknown) =>
  count(v) > 0 && count(v) <= 2147483647 ? count(v) : invalid();
const timestamp = (v: unknown) => {
  const s = text(v);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString() === s
    ? s
    : invalid();
};
export const cents = (value: unknown, signed = false): bigint => {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !(signed ? /^-?(0|[1-9][0-9]*)\.\d{2}$/ : /^(0|[1-9][0-9]*)\.\d{2}$/).test(
      value,
    )
  )
    return invalid();
  return BigInt(value.replace(".", ""));
};
export function formatMoney(value: string) {
  cents(value, true);
  const negative = value.startsWith("-"),
    unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  return `${negative ? "−" : ""}${BigInt(whole!).toLocaleString("vi-VN")}${fraction === "00" ? "" : "," + fraction} ₫`;
}
function calendar(value: string) {
  const d = new Date(value + "T00:00:00Z");
  if (
    !/^20\d\d-\d\d-\d\d$/.test(value) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== value
  )
    return invalid();
  return d;
}
export function windows(q: Query): Window[] {
  const from = calendar(q.from),
    to = calendar(q.to);
  if (
    to <= from ||
    (+to - +from) / 86400000 > 366 ||
    !["day", "month", "quarter"].includes(q.bucket)
  )
    return invalid();
  const result: Window[] = [];
  const cursor = new Date(from);
  if (q.bucket !== "day") cursor.setUTCDate(1);
  if (q.bucket === "quarter")
    cursor.setUTCMonth(Math.floor(cursor.getUTCMonth() / 3) * 3);
  while (cursor < to) {
    const next = new Date(cursor);
    if (q.bucket === "day") next.setUTCDate(next.getUTCDate() + 1);
    else next.setUTCMonth(next.getUTCMonth() + (q.bucket === "month" ? 1 : 3));
    result.push({
      periodStart: cursor.toISOString().slice(0, 10),
      from: new Date(Math.max(+cursor, +from)).toISOString().slice(0, 10),
      to: new Date(Math.min(+next, +to)).toISOString().slice(0, 10),
      partial: cursor < from || next > to,
    });
    cursor.setTime(+next);
  }
  return result;
}
function money(v: unknown): Money {
  const row = object(v);
  const gross = cents(row.grossMerchandise),
    refund = cents(row.effectiveRefundMerchandise);
  if (cents(row.netMerchandise, true) !== gross - refund) return invalid();
  cents(row.completedShipping);
  return {
    completedOrderCount: count(row.completedOrderCount),
    grossMerchandise: row.grossMerchandise as string,
    effectiveRefundMerchandise: row.effectiveRefundMerchandise as string,
    netMerchandise: row.netMerchandise as string,
    completedShipping: row.completedShipping as string,
  };
}
function counts(v: unknown, keys: string[]) {
  const row = object(v);
  if (Object.keys(row).sort().join(",") !== [...keys].sort().join(","))
    return invalid();
  return Object.fromEntries(keys.map((k) => [k, count(row[k])]));
}
function envelope(v: unknown, scope: Scope, q: Query, storeId?: number) {
  const row = object(v),
    range = object(row.range);
  if (
    row.scope !== scope ||
    row.timezone !== "Asia/Ho_Chi_Minh" ||
    range.from !== q.from ||
    range.to !== q.to
  )
    return invalid();
  const store = row.store === null ? null : object(row.store);
  if (
    scope === "ADMIN"
      ? store !== null
      : !store || (storeId !== undefined && store.id !== storeId)
  )
    return invalid();
  const projected = store
    ? { id: id(store.id), name: text(store.name), status: text(store.status) }
    : null;
  if (projected && !stores.includes(projected.status)) return invalid();
  return { row, store: projected, asOf: timestamp(row.asOf) };
}
export function parseSummary(
  value: unknown,
  scope: Scope,
  q: Query,
  storeId?: number,
): Summary {
  const { row, store, asOf } = envelope(value, scope, q, storeId),
    range = object(row.range);
  if (
    row.currency !== "VND" ||
    row.bucket !== q.bucket ||
    row.pendingRefundScope !== "LIFETIME_AS_OF" ||
    range.fromUtc !== new Date(+calendar(q.from) - 7 * 3600000).toISOString() ||
    range.toUtc !== new Date(+calendar(q.to) - 7 * 3600000).toISOString()
  )
    return invalid();
  const expected = windows(q),
    totals = money(row.totals);
  if (!Array.isArray(row.buckets) || row.buckets.length !== expected.length)
    return invalid();
  const buckets = row.buckets.map((value, i) => {
    const b = object(value),
      w = expected[i]!;
    if (
      b.periodStart !== w.periodStart ||
      b.from !== w.from ||
      b.to !== w.to ||
      b.partial !== w.partial
    )
      return invalid();
    return { ...w, ...money(b) };
  });
  for (const field of [
    "grossMerchandise",
    "effectiveRefundMerchandise",
    "netMerchandise",
    "completedShipping",
  ] as const)
    if (
      buckets.reduce(
        (sum, b) => sum + cents(b[field], field === "netMerchandise"),
        0n,
      ) !== cents(totals[field], field === "netMerchandise")
    )
      return invalid();
  if (
    buckets.reduce((sum, b) => sum + BigInt(b.completedOrderCount), 0n) !==
    BigInt(totals.completedOrderCount)
  )
    return invalid();
  cents(row.pendingRefundMerchandise);
  const products = object(row.currentProductCountsByStatus);
  const result: Summary = {
    scope,
    store,
    asOf,
    totals,
    buckets,
    pendingRefundMerchandise: row.pendingRefundMerchandise as string,
    invalidSnapshotOrderCount: count(
      object(row.dataQuality).invalidSnapshotOrderCount,
    ),
    orders: counts(row.createdOrderCountsByCurrentStatus, orders),
    products: {
      bySellerStatus: counts(products.bySellerStatus, [
        "DRAFT",
        "ACTIVE",
        "HIDDEN",
      ]),
      byModerationStatus: counts(products.byModerationStatus, [
        "NOT_SUBMITTED",
        "PENDING",
        "APPROVED",
        "REJECTED",
        "FROZEN",
      ]),
    },
  };
  if (scope === "ADMIN") {
    result.stores = counts(row.currentStoreCountsByStatus, stores);
    const users = object(row.currentUserCountsByRoleAndActive);
    result.users = Object.fromEntries(
      ["USER", "SELLER", "ADMIN"].map((role) => [
        role,
        counts(users[role], ["active", "inactive"]) as {
          active: number;
          inactive: number;
        },
      ]),
    );
  }
  return result;
}
export function parseQuality(
  value: unknown,
  scope: Scope,
  q: Query,
  beforeId?: number,
  storeId?: number,
): Quality {
  const { row, store, asOf } = envelope(value, scope, q, storeId);
  if (!Array.isArray(row.items) || row.items.length > 20) return invalid();
  let previous = beforeId ?? 2147483648;
  const items = row.items.map((value) => {
    const item = object(value),
      orderId = id(item.orderId),
      owner = id(item.storeId);
    if (
      orderId >= previous ||
      (scope === "SELLER" && owner !== store?.id) ||
      !Array.isArray(item.issues) ||
      !item.issues.length ||
      new Set(item.issues).size !== item.issues.length ||
      item.issues.some(
        (v) =>
          ![
            "MONEY_SNAPSHOT_INVALID",
            "FULFILLMENT_TIME_INVALID",
            "REFUND_PROJECTION_INVALID",
          ].includes(v),
      )
    )
      return invalid();
    previous = orderId;
    return { orderId, storeId: owner, issues: item.issues as string[] };
  });
  const next = row.nextBeforeId === null ? null : id(row.nextBeforeId);
  if (next !== null && (items.length !== 20 || next !== previous))
    return invalid();
  return { items, nextBeforeId: next, asOf };
}
export function dashboardApi(
  scope: Scope,
  requester: Requester = fetchApi,
  storeId?: number,
) {
  const prefix = scope === "ADMIN" ? "/admin/dashboard" : "/seller/dashboard";
  return {
    async summary(q: Query, signal: AbortSignal) {
      const query = Object.freeze({ ...q });
      windows(query);
      return parseSummary(
        await requester(`${prefix}?${new URLSearchParams(query)}`, {
          method: "GET",
          signal,
          cache: "no-store",
        }),
        scope,
        query,
        storeId,
      );
    },
    async quality(q: Query, signal: AbortSignal, beforeId?: number) {
      const query = Object.freeze({ ...q });
      windows(query);
      if (beforeId !== undefined) id(beforeId);
      const params = new URLSearchParams({
        from: query.from,
        to: query.to,
        limit: "20",
        ...(beforeId ? { beforeId: String(beforeId) } : {}),
      });
      return parseQuality(
        await requester(`${prefix}/data-quality?${params}`, {
          method: "GET",
          signal,
          cache: "no-store",
        }),
        scope,
        query,
        beforeId,
        storeId,
      );
    },
  };
}
export type DashboardApi = ReturnType<typeof dashboardApi>;
