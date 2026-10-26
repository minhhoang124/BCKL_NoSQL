// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import {
  dashboardApi,
  parseQuality,
  parseSummary,
  type Quality,
  type Query,
  type Summary,
} from "./dashboardApi";
import { qualityFixture, summaryFixture } from "./dashboard.fixtures";
import { ApiError, setAccessToken } from "../../services/apiClient";
import type { User } from "../../types/auth";
const auth = vi.hoisted(() => ({
  user: {
    id: 1,
    email: "qa@example.invalid",
    fullName: "QA",
    role: "ADMIN",
    isActive: true,
  } as User | null,
  loading: false,
}));
vi.mock("../../contexts/useAuth", () => ({ useAuth: () => auth }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function api() {
  const requester = vi.fn(async (path: string) => {
    const url = new URL(path, "http://qa.invalid"),
      q = {
        from: url.searchParams.get("from")!,
        to: url.searchParams.get("to")!,
        bucket: (url.searchParams.get("bucket") ?? "day") as Query["bucket"],
      };
    return path.includes("data-quality")
      ? qualityFixture(q, "ADMIN", url.searchParams.has("beforeId") ? 2 : 1)
      : summaryFixture(q);
  });
  return { source: dashboardApi("ADMIN", requester), requester };
}
beforeEach(() => {
  auth.user = {
    id: 1,
    email: "qa@example.invalid",
    fullName: "QA",
    role: "ADMIN",
    isActive: true,
  };
  auth.loading = false;
  setAccessToken("synthetic-test-token", 1);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("Dashboard actual adapter and React lifecycle", () => {
  it("shows negative net, pending lifetime, all statuses and exact server data", async () => {
    const { source } = api();
    render(<Dashboard scope="ADMIN" api={source} />);
    expect(
      await screen.findByText("Hoàn tiền hiện ở chế độ mô phỏng.", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("−100.000 ₫")).toHaveLength(2);
    expect(screen.getByText("30.000 ₫")).toBeInTheDocument();
    expect(screen.getByText("Đã đóng")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("preserves the applied range label when only draft filters change", async () => {
    const { source, requester } = api();
    render(<Dashboard scope="ADMIN" api={source} />);
    await screen.findByRole("table");
    const label = screen.getByText("Đang xem từ", { exact: false }).textContent;
    fireEvent.change(screen.getByLabelText("Từ ngày"), {
      target: { value: "2026-01-01" },
    });
    expect(screen.getByText("Đang xem từ", { exact: false }).textContent).toBe(
      label,
    );
    expect(requester).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid dates before sending another request", async () => {
    const { source, requester } = api();
    render(<Dashboard scope="ADMIN" api={source} />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Từ ngày"), {
      target: { value: "2026-04-01" },
    });
    fireEvent.change(screen.getByLabelText("Đến trước ngày"), {
      target: { value: "2026-03-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Xem thống kê" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "tối đa 366 ngày",
    );
    expect(requester).toHaveBeenCalledTimes(1);
  });
  it("clears previous money on network failure instead of showing fabricated zero", async () => {
    const { source } = api();
    const read = vi.spyOn(source, "summary");
    render(<Dashboard scope="ADMIN" api={source} />);
    await screen.findByRole("table");
    read.mockRejectedValueOnce(new ApiError("Unavailable", 503));
    fireEvent.click(screen.getByRole("button", { name: "Xem thống kê" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không tải được",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("fails closed for malformed HTTP 200 money", async () => {
    const requester = vi.fn(async (_path: string) => ({
      totals: { netMerchandise: "NaN" },
    }));
    render(<Dashboard scope="ADMIN" api={dashboardApi("ADMIN", requester)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Dữ liệu thống kê không hợp lệ",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("discards a delayed response after logout and account switch", async () => {
    const delayed = deferred<Summary>(),
      { source } = api();
    let query!: Query;
    vi.spyOn(source, "summary").mockImplementationOnce((q) => {
      query = q;
      return delayed.promise;
    });
    const view = render(<Dashboard scope="ADMIN" api={source} />);
    auth.user = null;
    setAccessToken(null);
    view.rerender(<Dashboard scope="ADMIN" api={source} />);
    await act(async () =>
      delayed.resolve(parseSummary(summaryFixture(query), "ADMIN", query)),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("không có quyền");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    auth.user = {
      id: 2,
      email: "other@example.invalid",
      fullName: "Other",
      role: "ADMIN",
      isActive: true,
    };
    setAccessToken("synthetic-other-token", 2);
    view.rerender(<Dashboard scope="ADMIN" api={source} />);
    await screen.findByRole("table");
  });
  it("ignores an old response when a newer filter request wins", async () => {
    const delayed = deferred<Summary>(),
      { source } = api();
    let oldQuery!: Query;
    const read = vi.spyOn(source, "summary").mockImplementationOnce((q) => {
      oldQuery = q;
      return delayed.promise;
    });
    render(<Dashboard scope="ADMIN" api={source} />);
    fireEvent.change(screen.getByLabelText("Từ ngày"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Đến trước ngày"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Đang tải…" }).closest("form")!,
    );
    await screen.findByRole("table");
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () =>
      delayed.resolve(
        parseSummary(summaryFixture(oldQuery), "ADMIN", oldQuery),
      ),
    );
    expect(screen.getByText("Đang xem từ", { exact: false })).toHaveTextContent(
      "2026-01-01 đến trước 2026-02-01",
    );
  });
  it("paginates quality using the applied range and cursor, one flight per click burst", async () => {
    const { source, requester } = api();
    render(<Dashboard scope="ADMIN" api={source} />);
    await screen.findByRole("table");
    const button = screen.getByRole("button", {
      name: "Xem đơn cần đối chiếu",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    const more = await screen.findByRole("button", { name: "Xem thêm đơn" });
    expect(
      requester.mock.calls.filter((c) => c[0].includes("data-quality")),
    ).toHaveLength(1);
    fireEvent.click(more);
    await screen.findByText("Đơn #80", { exact: false });
    const qualitySection = screen
      .getByRole("heading", { name: "Đối chiếu dữ liệu" })
      .closest("section")!;
    expect(within(qualitySection).getAllByRole("listitem")).toHaveLength(21);
    expect(
      screen.queryByRole("button", { name: "Xem thêm đơn" }),
    ).not.toBeInTheDocument();
    expect(requester.mock.calls.at(-1)![0]).toContain("beforeId=81");
  });
  it("removes displayed money when quality reports revoked permission", async () => {
    const { source } = api();
    vi.spyOn(source, "quality").mockRejectedValueOnce(
      new ApiError("Denied", 403),
    );
    render(<Dashboard scope="ADMIN" api={source} />);
    await screen.findByRole("table");
    fireEvent.click(
      screen.getByRole("button", { name: "Xem đơn cần đối chiếu" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("table")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "quyền truy cập đã thay đổi",
    );
    expect(screen.getByRole("button", { name: "Xem thống kê" })).toBeDisabled();
  });
  it("ignores quality arriving after the main range is reloaded", async () => {
    const delayed = deferred<Quality>(),
      { source } = api();
    let old!: Query;
    vi.spyOn(source, "quality").mockImplementationOnce((q) => {
      old = q;
      return delayed.promise;
    });
    render(<Dashboard scope="ADMIN" api={source} />);
    await screen.findByRole("table");
    fireEvent.click(
      screen.getByRole("button", { name: "Xem đơn cần đối chiếu" }),
    );
    fireEvent.change(screen.getByLabelText("Từ ngày"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Đến trước ngày"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Xem thống kê" }));
    await screen.findByRole("table");
    await act(async () =>
      delayed.resolve(parseQuality(qualityFixture(old), "ADMIN", old)),
    );
    expect(
      screen.queryByText("Đơn #100", { exact: false }),
    ).not.toBeInTheDocument();
  });
  it("remounts Seller reads when the canonical Store finishes loading", async () => {
    auth.user!.role = "SELLER";
    const delayed = deferred<Summary>();
    let old!: Query;
    const source = dashboardApi("SELLER", async (path) => {
      const u = new URL(path, "http://qa.invalid");
      return summaryFixture(
        {
          from: u.searchParams.get("from")!,
          to: u.searchParams.get("to")!,
          bucket: u.searchParams.get("bucket") as Query["bucket"],
        },
        "SELLER",
      );
    });
    const read = vi.spyOn(source, "summary").mockImplementationOnce((q) => {
      old = q;
      return delayed.promise;
    });
    const view = render(<Dashboard scope="SELLER" api={source} />);
    view.rerender(<Dashboard scope="SELLER" storeId={7} api={source} />);
    await screen.findByRole("table");
    await act(async () =>
      delayed.resolve(
        parseSummary(summaryFixture(old, "SELLER"), "SELLER", old),
      ),
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("explains the no-Store case without presenting zero revenue", async () => {
    auth.user!.role = "SELLER";
    const { source } = api();
    vi.spyOn(source, "summary").mockRejectedValueOnce(
      new ApiError("No store", 404),
    );
    render(<Dashboard scope="SELLER" api={source} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "chưa có cửa hàng",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
