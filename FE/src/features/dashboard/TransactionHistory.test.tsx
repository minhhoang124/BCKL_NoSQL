// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionHistory } from "./TransactionHistory";
import { dashboardApi, parseTransactions, type Query } from "./dashboardApi";
import { setAccessToken } from "../../services/apiClient";

const query: Query = { from: "2026-01-01", to: "2026-03-01", bucket: "day" };
const store = { id: 7, name: "Cửa hàng QA", status: "ACTIVE" };
function payload(
  scope: "ADMIN" | "SELLER",
  overrides: Record<string, unknown> = {},
  items: Record<string, unknown>[] = [
    {
      key: "R5",
      type: "REFUND",
      at: "2026-02-03T00:00:00.000Z",
      orderNumber: "ORD-0001",
      storeId: 7,
      storeName: "Cửa hàng QA",
      provider: "COD",
      status: "REFUNDED",
      amount: "100000.00",
    },
    {
      key: "P12",
      type: "PAYMENT",
      at: "2026-01-15T00:00:00.000Z",
      orderNumber: "ORD-0001",
      storeId: 7,
      storeName: "Cửa hàng QA",
      provider: "VNPAY",
      status: "PAID",
      amount: "120000.00",
    },
  ],
) {
  return {
    scope,
    store: scope === "SELLER" ? store : null,
    filterStoreId: scope === "SELLER" ? 7 : null,
    asOf: "2026-03-01T00:00:00.000Z",
    timezone: "Asia/Ho_Chi_Minh",
    currency: "VND",
    range: { from: query.from, to: query.to },
    totals: {
      paidCount: 1,
      paidAmount: "120000.00",
      refundCount: 1,
      refundAmount: "100000.00",
    },
    items,
    nextCursor: null,
    ...overrides,
  };
}

beforeEach(() => setAccessToken("synthetic-test-token", 1));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("parseTransactions", () => {
  it("accepts a well-formed Seller page", () => {
    const page = parseTransactions(payload("SELLER"), "SELLER", query);
    expect(page.items.map((i) => i.key)).toEqual(["R5", "P12"]);
    expect(page.filterStoreId).toBe(7);
  });
  it.each([
    ["foreign Store row", { storeId: 8 }],
    ["unknown provider", { provider: "PAYPAL" }],
    ["type/key mismatch", { type: "PAYMENT" }],
    ["malformed money", { amount: "1e5" }],
    ["unsorted time", { at: "2026-01-02T00:00:00.000Z" }],
  ])("fails closed on %s", (_label, change) => {
    const bad = payload("SELLER");
    bad.items = [{ ...bad.items[0], ...change }, bad.items[1]!];
    expect(() => parseTransactions(bad, "SELLER", query)).toThrow(
      "Dữ liệu thống kê không hợp lệ",
    );
  });
  const pay = (key: string, at: string, status = "PAID", amount = "100.00") => ({
    key,
    type: "PAYMENT",
    at,
    orderNumber: "ORD-" + key,
    storeId: 7,
    storeName: "Cửa hàng QA",
    provider: "COD",
    status,
    amount,
  });
  const same = "2026-01-20T05:06:07.891Z";
  it("accepts REVIEW_REQUIRED and numeric id order within one millisecond", () => {
    const page = parseTransactions(
      payload(
        "SELLER",
        { totals: { paidCount: 1, paidAmount: "100.00", refundCount: 0, refundAmount: "0.00" } },
        [pay("P10", same), pay("P9", same, "REVIEW_REQUIRED")],
      ),
      "SELLER",
      query,
    );
    expect(page.items.map((i) => i.key)).toEqual(["P10", "P9"]);
  });
  it("rejects tuple order, a cursor not matching the last row, and totals below the rows", () => {
    const totals = { paidCount: 2, paidAmount: "200.00", refundCount: 0, refundAmount: "0.00" };
    expect(() =>
      parseTransactions(payload("SELLER", { totals }, [pay("P9", same), pay("P10", same)]), "SELLER", query),
    ).toThrow();
    expect(() =>
      parseTransactions(
        payload("SELLER", { totals, nextCursor: "1768435200000_P1" }, [pay("P10", same), pay("P9", same)]),
        "SELLER",
        query,
      ),
    ).toThrow();
    expect(
      parseTransactions(
        payload("SELLER", { totals, nextCursor: `${Date.parse(same)}_P9` }, [pay("P10", same), pay("P9", same)]),
        "SELLER",
        query,
      ).nextCursor,
    ).toBe(`${Date.parse(same)}_P9`);
    expect(() =>
      parseTransactions(
        payload("SELLER", { totals: { ...totals, paidCount: 0, paidAmount: "0.00" } }, [pay("P10", same)]),
        "SELLER",
        query,
      ),
    ).toThrow();
    // A follow-up page must sort strictly after the cursor that was sent.
    expect(() =>
      parseTransactions(payload("SELLER", { totals }, [pay("P11", same)]), "SELLER", query, undefined, undefined, `${Date.parse(same)}_P10`),
    ).toThrow();
  });
  it("rejects an Admin response for a different Store filter", () => {
    expect(() =>
      parseTransactions(payload("ADMIN", { filterStoreId: null }), "ADMIN", query, 7),
    ).toThrow();
    expect(
      parseTransactions(payload("ADMIN", { filterStoreId: 7 }), "ADMIN", query, 7)
        .filterStoreId,
    ).toBe(7);
  });
  it("never sends storeId for a Seller", async () => {
    const requester = vi.fn();
    await expect(
      dashboardApi("SELLER", requester).transactions(
        query,
        new AbortController().signal,
        { filterStoreId: 3 },
      ),
    ).rejects.toThrow();
    expect(requester).not.toHaveBeenCalled();
  });
});

describe("TransactionHistory", () => {
  it("loads on demand, shows Vietnamese labels and pages with the cursor", async () => {
    const requester = vi.fn(async (path: string) => {
      const url = new URL(path, "http://qa.invalid");
      if (url.searchParams.has("cursor"))
        return payload("SELLER", {}, [
          {
            key: "P11",
            type: "PAYMENT",
            at: "2026-01-10T00:00:00.000Z",
            orderNumber: "ORD-0000",
            storeId: 7,
            storeName: "Cửa hàng QA",
            provider: "COD",
            status: "PAID",
            amount: "50000.00",
          },
        ]);
      return payload("SELLER", { nextCursor: "1768435200000_P12" });
    });
    render(
      <TransactionHistory
        api={dashboardApi("SELLER", requester, 7)}
        scope="SELLER"
        query={query}
      />,
    );
    expect(requester).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Xem lịch sử giao dịch" }));
    const table = await screen.findByRole("table");
    expect(requester.mock.calls[0]![0]).toBe(
      "/seller/dashboard/transactions?from=2026-01-01&to=2026-03-01&limit=20",
    );
    expect(within(table).getByText("Hoàn tiền")).toBeInTheDocument();
    expect(within(table).getByText("VNPay")).toBeInTheDocument();
    expect(within(table).getByText("Đã hoàn tiền")).toBeInTheDocument();
    expect(within(table).queryByText("Cửa hàng QA")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem thêm giao dịch" }));
    expect(await screen.findByText("ORD-0000")).toBeInTheDocument();
    expect(requester.mock.calls[1]![0]).toContain("cursor=1768435200000_P12");
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
  it("Admin can filter by Store and sees the Store column", async () => {
    const requester = vi.fn(async (path: string) => {
      if (path === "/admin/stores")
        return [
          { id: 7, name: "Cửa hàng QA", status: "ACTIVE" },
          { id: 8, name: "Cửa hàng khác", status: "ACTIVE" },
        ];
      const storeId = new URL(path, "http://qa.invalid").searchParams.get("storeId");
      return payload("ADMIN", { filterStoreId: storeId ? Number(storeId) : null });
    });
    render(
      <TransactionHistory
        api={dashboardApi("ADMIN", requester)}
        scope="ADMIN"
        query={query}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xem lịch sử giao dịch" }));
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("Cửa hàng QA")).toHaveLength(2);
    await screen.findByRole("option", { name: "Cửa hàng khác" });
    fireEvent.change(screen.getByLabelText("Cửa hàng"), { target: { value: "7" } });
    await screen.findByRole("table");
    expect(requester.mock.calls.at(-1)![0]).toContain("storeId=7");
  });
  it("Admin sees a separate retry when only the Store list fails", async () => {
    let storesCalls = 0;
    const requester = vi.fn(async (path: string) => {
      if (path === "/admin/stores") {
        storesCalls++;
        if (storesCalls === 1) throw new Error("network");
        return [{ id: 7, name: "Cửa hàng QA", status: "ACTIVE" }];
      }
      return payload("ADMIN");
    });
    render(
      <TransactionHistory api={dashboardApi("ADMIN", requester)} scope="ADMIN" query={query} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xem lịch sử giao dịch" }));
    await screen.findByRole("table");
    fireEvent.click(
      await screen.findByRole("button", { name: "Tải lại danh sách cửa hàng" }),
    );
    expect(await screen.findByRole("option", { name: "Cửa hàng QA" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tải lại danh sách cửa hàng" }),
    ).not.toBeInTheDocument();
  });
  it("accepts an empty first page with zero totals", () => {
    const page = parseTransactions(
      payload(
        "SELLER",
        { totals: { paidCount: 0, paidAmount: "0.00", refundCount: 0, refundAmount: "0.00" } },
        [],
      ),
      "SELLER",
      query,
    );
    expect(page.items).toEqual([]);
  });
  it("shows a retryable error instead of an empty list", async () => {
    const requester = vi.fn(async () => ({ broken: true }));
    render(
      <TransactionHistory
        api={dashboardApi("SELLER", requester, 7)}
        scope="SELLER"
        query={query}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xem lịch sử giao dịch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("không hợp lệ");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
});
