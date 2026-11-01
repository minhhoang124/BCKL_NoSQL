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
  items: { orderId: number; orderNumber: string | null; storeId: number; issues: string[] }[];
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
      owner = id(item.storeId),
      // Optional for an older API: absent → null; present must be a bounded non-empty string.
      legacy = !("orderNumber" in item),
      orderNumber = legacy ? null : item.orderNumber;
    if (
      (!legacy &&
        (typeof orderNumber !== "string" || !orderNumber.trim() || orderNumber.length > 64)) ||
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
    return { orderId, orderNumber: orderNumber as string | null, storeId: owner, issues: item.issues as string[] };
  });
  const next = row.nextBeforeId === null ? null : id(row.nextBeforeId);
  if (next !== null && (items.length !== 20 || next !== previous))
    return invalid();
  return { items, nextBeforeId: next, asOf };
}
export type Transaction = {
  key: string;
  type: "PAYMENT" | "REFUND";
  at: string;
  orderNumber: string;
  storeId: number;
  storeName: string;
  provider: "COD" | "VNPAY" | "MOMO";
  status: string;
  amount: string;
};
export type Transactions = {
  asOf: string;
  filterStoreId: number | null;
  totals: {
    paidCount: number;
    paidAmount: string;
    refundCount: number;
    refundAmount: string;
  };
  items: Transaction[];
  nextCursor: string | null;
};
const paymentStatuses = [
  "UNPAID",
  "PENDING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUND_PENDING",
  "REFUNDED",
  "REVIEW_REQUIRED",
];
const cursorPattern = /^([1-9][0-9]{0,14})_([PR])([1-9][0-9]{0,18})$/;
/** Server order is (at, kind, id) descending; kind "R" sorts above "P". */
function sortKey(at: string, key: string) {
  return { ms: Date.parse(at), kind: key[0]!, id: BigInt(key.slice(1)) };
}
function before(
  a: ReturnType<typeof sortKey>,
  b: ReturnType<typeof sortKey>,
) {
  return a.ms !== b.ms ? a.ms < b.ms : a.kind !== b.kind ? a.kind < b.kind : a.id < b.id;
}
export function parseTransactions(
  value: unknown,
  scope: Scope,
  q: Query,
  filterStoreId?: number,
  storeId?: number,
  sentCursor?: string,
): Transactions {
  const { row, store, asOf } = envelope(value, scope, q, storeId);
  const totals = object(row.totals);
  const expectedFilter = scope === "SELLER" ? store!.id : (filterStoreId ?? null);
  if (
    row.currency !== "VND" ||
    row.filterStoreId !== expectedFilter ||
    !Array.isArray(row.items) ||
    row.items.length > 50
  )
    return invalid();
  const seen = new Set<string>();
  let previous: ReturnType<typeof sortKey> | null = null;
  if (sentCursor !== undefined) {
    const m = cursorPattern.exec(sentCursor) ?? invalid();
    previous = { ms: Number(m[1]), kind: m[2]!, id: BigInt(m[3]!) };
  }
  const items = row.items.map((v): Transaction => {
    const item = object(v),
      key = text(item.key),
      at = timestamp(item.at),
      owner = id(item.storeId);
    if (
      !/^[PR][1-9][0-9]{0,18}$/.test(key) ||
      seen.has(key) ||
      (previous !== null && !before(sortKey(at, key), previous)) ||
      (item.type !== "PAYMENT" && item.type !== "REFUND") ||
      (item.type === "PAYMENT") !== key.startsWith("P") ||
      !["COD", "VNPAY", "MOMO"].includes(item.provider as string) ||
      !paymentStatuses.includes(item.status as string) ||
      (item.type === "REFUND" && item.status !== "REFUNDED") ||
      (expectedFilter !== null && owner !== expectedFilter) ||
      text(item.orderNumber).length > 64
    )
      return invalid();
    cents(item.amount);
    seen.add(key);
    previous = sortKey(at, key);
    return {
      key,
      type: item.type,
      at,
      orderNumber: item.orderNumber as string,
      storeId: owner,
      storeName: text(item.storeName),
      provider: item.provider as Transaction["provider"],
      status: item.status as string,
      amount: item.amount as string,
    };
  });
  const paidAmount = cents(totals.paidAmount),
    refundAmount = cents(totals.refundAmount),
    paidCount = count(totals.paidCount),
    refundCount = count(totals.refundCount);
  const paid = items.filter((i) => i.type === "PAYMENT" && i.status === "PAID"),
    refunds = items.filter((i) => i.type === "REFUND");
  const sum = (rows: Transaction[]) =>
    rows.reduce((total, i) => total + cents(i.amount), 0n);
  // Totals cover the whole range: a page can never exceed them, and a single
  // complete page (no cursor in or out) must match them exactly.
  if (
    paid.length > paidCount ||
    refunds.length > refundCount ||
    sum(paid) > paidAmount ||
    sum(refunds) > refundAmount
  )
    return invalid();
  const last = items[items.length - 1];
  const next =
    row.nextCursor === null
      ? null
      : last &&
          row.nextCursor ===
            `${Date.parse(last.at)}_${last.key[0]}${last.key.slice(1)}`
        ? (row.nextCursor as string)
        : invalid();
  if (
    sentCursor === undefined &&
    next === null &&
    (paid.length !== paidCount ||
      refunds.length !== refundCount ||
      sum(paid) !== paidAmount ||
      sum(refunds) !== refundAmount)
  )
    return invalid();
  return {
    asOf,
    filterStoreId: expectedFilter,
    totals: {
      paidCount,
      paidAmount: totals.paidAmount as string,
      refundCount,
      refundAmount: totals.refundAmount as string,
    },
    items,
    nextCursor: next,
  };
}
export function parseStores(value: unknown) {
  if (!Array.isArray(value) || value.length > 10000) return invalid();
  return value.map((v) => {
    const s = object(v);
    return { id: id(s.id), name: text(s.name) };
  });
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
    async transactions(
      q: Query,
      signal: AbortSignal,
      options: { cursor?: string; filterStoreId?: number } = {},
    ) {
      const query = Object.freeze({ ...q });
      windows(query);
      if (options.filterStoreId !== undefined) {
        if (scope !== "ADMIN") return invalid();
        id(options.filterStoreId);
      }
      if (
        options.cursor !== undefined &&
        !/^[1-9][0-9]{0,14}_[PR][1-9][0-9]{0,18}$/.test(options.cursor)
      )
        return invalid();
      const params = new URLSearchParams({
        from: query.from,
        to: query.to,
        limit: "20",
        ...(options.filterStoreId
          ? { storeId: String(options.filterStoreId) }
          : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
      });
      return parseTransactions(
        await requester(`${prefix}/transactions?${params}`, {
          method: "GET",
          signal,
          cache: "no-store",
        }),
        scope,
        query,
        options.filterStoreId,
        storeId,
        options.cursor,
      );
    },
    async stores(signal: AbortSignal) {
      if (scope !== "ADMIN") return [];
      return parseStores(
        await requester("/admin/stores", {
          method: "GET",
          signal,
          cache: "no-store",
        }),
      );
    },
  };
}
export type DashboardApi = ReturnType<typeof dashboardApi>;
