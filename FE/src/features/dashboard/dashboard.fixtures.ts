import { windows, type Query, type Scope } from "./dashboardApi";
export function summaryFixture(q: Query, scope: Scope = "ADMIN") {
  const zero = {
    completedOrderCount: 0,
    grossMerchandise: "0.00",
    effectiveRefundMerchandise: "0.00",
    netMerchandise: "0.00",
    completedShipping: "0.00",
  };
  const totals = {
    completedOrderCount: 1,
    grossMerchandise: "100000.00",
    effectiveRefundMerchandise: "200000.00",
    netMerchandise: "-100000.00",
    completedShipping: "20000.00",
  };
  return {
    scope,
    store:
      scope === "ADMIN" ? null : { id: 7, name: "QA Store", status: "CLOSED" },
    asOf: "2026-10-26T00:00:00.000Z",
    timezone: "Asia/Ho_Chi_Minh",
    currency: "VND",
    bucket: q.bucket,
    range: {
      from: q.from,
      to: q.to,
      fromUtc: new Date(
        Date.parse(q.from + "T00:00:00Z") - 7 * 3600000,
      ).toISOString(),
      toUtc: new Date(
        Date.parse(q.to + "T00:00:00Z") - 7 * 3600000,
      ).toISOString(),
    },
    totals,
    buckets: windows(q).map((w, i) => ({ ...w, ...(i === 0 ? totals : zero) })),
    pendingRefundMerchandise: "30000.00",
    pendingRefundScope: "LIFETIME_AS_OF",
    dataQuality: { invalidSnapshotOrderCount: 1 },
    createdOrderCountsByCurrentStatus: Object.fromEntries(
      [
        "PENDING_CONFIRMATION",
        "CONFIRMED",
        "PACKING",
        "READY_TO_SHIP",
        "SHIPPING",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
        "DELIVERY_FAILED",
      ].map((k) => [k, 0]),
    ),
    currentProductCountsByStatus: {
      bySellerStatus: { DRAFT: 0, ACTIVE: 0, HIDDEN: 0 },
      byModerationStatus: {
        NOT_SUBMITTED: 0,
        PENDING: 0,
        APPROVED: 0,
        REJECTED: 0,
        FROZEN: 0,
      },
    },
    ...(scope === "ADMIN"
      ? {
          currentStoreCountsByStatus: {
            PENDING: 0,
            ACTIVE: 0,
            REJECTED: 0,
            SUSPENDED: 0,
            CLOSED: 1,
          },
          currentUserCountsByRoleAndActive: {
            USER: { active: 1, inactive: 0 },
            SELLER: { active: 1, inactive: 0 },
            ADMIN: { active: 1, inactive: 0 },
          },
        }
      : {}),
  };
}
export function qualityFixture(q: Query, scope: Scope = "ADMIN", page = 1) {
  return {
    scope,
    store:
      scope === "ADMIN" ? null : { id: 7, name: "QA Store", status: "CLOSED" },
    asOf: "2026-10-26T00:00:00.000Z",
    timezone: "Asia/Ho_Chi_Minh",
    range: { from: q.from, to: q.to },
    items: (page === 1
      ? Array.from({ length: 20 }, (_, i) => 100 - i)
      : [80]
    ).map((orderId) => ({
      orderId,
      storeId: 7,
      issues: ["REFUND_PROJECTION_INVALID"],
    })),
    nextBeforeId: page === 1 ? 81 : null,
  };
}
