import { describe, expect, it, vi } from "vitest";
import {
  dashboardApi,
  defaultQuery,
  formatMoney,
  parseQuality,
  parseSummary,
  windows,
  type Query,
} from "./dashboardApi";
import { qualityFixture, summaryFixture } from "./dashboard.fixtures";
const q: Query = { from: "2026-01-31", to: "2026-02-02", bucket: "day" };
describe("Dashboard exact financial boundary", () => {
  it("accepts negative net and canonical CLOSED Store without float conversion", () => {
    expect(
      parseSummary(summaryFixture(q, "SELLER"), "SELLER", q, 7).totals
        .netMerchandise,
    ).toBe("-100000.00");
    expect(formatMoney("9007199254740993.01")).toBe(
      "9.007.199.254.740.993,01 ₫",
    );
    expect(formatMoney("-0.50")).toBe("−0,50 ₫");
  });
  it.each(["NaN", "Infinity", "1e5", "001.00", "100", "-1.00", "1.001"])(
    "rejects malformed unsigned money %s",
    (value) => {
      const body = summaryFixture(q);
      body.totals.grossMerchandise = value;
      expect(() => parseSummary(body, "ADMIN", q)).toThrow();
    },
  );
  it.each([
    "scope",
    "range",
    "timezone",
    "currency",
    "net",
    "bucket-sum",
    "bucket-gap",
    "window",
    "count",
    "closed",
  ])("rejects mismatched %s", (kind) => {
    const body = summaryFixture(q);
    if (kind === "scope") body.scope = "SELLER";
    if (kind === "range") body.range.from = "2026-01-30";
    if (kind === "timezone") body.timezone = "UTC";
    if (kind === "currency") body.currency = "USD";
    if (kind === "net") body.totals.netMerchandise = "0.00";
    if (kind === "bucket-sum") body.buckets[1]!.completedShipping = "1.00";
    if (kind === "bucket-gap") body.buckets.pop();
    if (kind === "window") body.buckets[0]!.partial = true;
    if (kind === "count")
      body.totals.completedOrderCount = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "closed")
      delete (body.currentStoreCountsByStatus as Record<string, number>).CLOSED;
    expect(() => parseSummary(body, "ADMIN", q)).toThrow();
  });
  it("refuses wrong Seller Store and projects only allowed financial fields", () => {
    const body = summaryFixture(q, "SELLER");
    expect(() => parseSummary(body, "SELLER", q, 9)).toThrow();
    expect(
      parseSummary(
        { ...body, passwordHash: "not a real secret" },
        "SELLER",
        q,
        7,
      ),
    ).not.toHaveProperty("passwordHash");
  });
  it("creates local calendar windows including leap-day and partial quarters", () => {
    expect(
      windows({ from: "2024-02-28", to: "2024-03-01", bucket: "day" }).map(
        (v) => v.from,
      ),
    ).toEqual(["2024-02-28", "2024-02-29"]);
    expect(
      windows({ from: "2026-03-31", to: "2026-04-02", bucket: "quarter" }),
    ).toEqual([
      {
        periodStart: "2026-01-01",
        from: "2026-03-31",
        to: "2026-04-01",
        partial: true,
      },
      {
        periodStart: "2026-04-01",
        from: "2026-04-01",
        to: "2026-04-02",
        partial: true,
      },
    ]);
    expect(defaultQuery(new Date("2026-01-31T17:00:00Z"))).toEqual({
      from: "2026-02-01",
      to: "2026-03-01",
      bucket: "day",
    });
    expect(() =>
      windows({ from: "2026-02-30", to: "2026-03-01", bucket: "day" }),
    ).toThrow();
    expect(
      windows({ from: "2024-01-01", to: "2025-01-01", bucket: "day" }),
    ).toHaveLength(366);
    expect(() =>
      windows({ from: "2024-01-01", to: "2025-01-02", bucket: "day" }),
    ).toThrow();
  });
  it("requires exclusive descending quality pages with canonical Store and usable cursor", () => {
    const body = qualityFixture(q, "SELLER");
    expect(parseQuality(body, "SELLER", q, undefined, 7).nextBeforeId).toBe(81);
    expect(() => parseQuality(body, "SELLER", q, 100, 7)).toThrow();
    body.items[0]!.storeId = 8;
    expect(() => parseQuality(body, "SELLER", q)).toThrow();
    body.items[0]!.storeId = 7;
    body.nextBeforeId = 82;
    expect(() => parseQuality(body, "SELLER", q)).toThrow();
  });
  it("accepts a missing orderNumber from an older API but refuses malformed ones", () => {
    const body = qualityFixture(q, "SELLER");
    expect(parseQuality(body, "SELLER", q, undefined, 7).items[0]!.orderNumber).toBe("ORD-100");
    const legacy = qualityFixture(q, "SELLER") as { items: Record<string, unknown>[] };
    for (const item of legacy.items) delete item.orderNumber;
    expect(parseQuality(legacy, "SELLER", q, undefined, 7).items[0]!.orderNumber).toBeNull();
    for (const bad of ["", "   ", "x".repeat(65), 12, null]) {
      const broken = qualityFixture(q, "SELLER") as { items: Record<string, unknown>[] };
      broken.items[0]!.orderNumber = bad;
      expect(() => parseQuality(broken, "SELLER", q, undefined, 7)).toThrow();
    }
  });
  it("sends only bounded GET requests and never sends bucket to quality route", async () => {
    const requester = vi
      .fn()
      .mockResolvedValueOnce(summaryFixture(q))
      .mockResolvedValueOnce(qualityFixture(q));
    const api = dashboardApi("ADMIN", requester),
      signal = new AbortController().signal;
    await api.summary(q, signal);
    await api.quality(q, signal);
    expect(requester.mock.calls.map((c) => c[0])).toEqual([
      "/admin/dashboard?from=2026-01-31&to=2026-02-02&bucket=day",
      "/admin/dashboard/data-quality?from=2026-01-31&to=2026-02-02&limit=20",
    ]);
    expect(
      requester.mock.calls.every(
        (c) =>
          c[1].method === "GET" &&
          c[1].cache === "no-store" &&
          c[1].signal === signal,
      ),
    ).toBe(true);
  });
  it("snapshots query identity before awaiting the response", async () => {
    const mutable = { ...q },
      body = summaryFixture(q);
    let release!: (v: unknown) => void;
    const requester = vi.fn(
      () =>
        new Promise<unknown>((done) => {
          release = done;
        }),
    );
    const pending = dashboardApi("ADMIN", requester).summary(
      mutable,
      new AbortController().signal,
    );
    mutable.from = "2026-01-01";
    mutable.bucket = "quarter";
    release(body);
    expect((await pending).totals.netMerchandise).toBe("-100000.00");
  });
});
