// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchAnalytics } from "./SearchAnalytics";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  auth: { user: { id: 1, role: "SELLER", isActive: true }, loading: false },
  session: 1,
}));
vi.mock("../contexts/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("../services/apiClient", () => ({
  fetchApi: (...a: unknown[]) => mocks.fetch(...a),
  getAuthSessionVersion: () => mocks.session,
}));
const report = {
  status: "PARTIAL",
  coverage: "RECORDED_ONLY",
  complete: false,
  asOf: "2026-10-28T08:00:00.000Z",
  availableFrom: "2026-10-28T00:00:00.000Z",
  totals: { impressions: 3, clicks: 1 },
  strategies: [{ strategy: "HYBRID_TEXT", impressions: 3, clicks: 1 }],
};
describe("Store Search analytics reader", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.auth.user = { id: 1, role: "SELLER", isActive: true };
    mocks.session = 1;
  });
  afterEach(cleanup);
  it("only requests own Seller scope, explains partial counts and does not auto-retry writes", async () => {
    mocks.fetch.mockResolvedValue(report);
    render(<SearchAnalytics scope="SELLER" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("Văn bản kết hợp")).toBeInTheDocument();
    expect(mocks.fetch.mock.calls[0]![0]).toMatch(
      /^\/seller\/search-analytics\?from=/,
    );
    expect(mocks.fetch.mock.calls[0]![0]).not.toContain("storeId");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Chỉ gồm lượt đã ghi nhận",
    );
  });
  it("disabled shows missing data instead of 0", async () => {
    mocks.fetch.mockResolvedValue({
      ...report,
      status: "DISABLED",
      totals: null,
      strategies: [],
    });
    render(<SearchAnalytics scope="SELLER" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "chưa được bật",
    );
    expect(screen.queryByText("Hiển thị:")).not.toBeInTheDocument();
  });
  it("network failure does not fabricate totals", async () => {
    mocks.fetch.mockRejectedValue(Error("offline"));
    render(<SearchAnalytics scope="SELLER" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không thể suy ra số lượt bằng 0",
    );
  });
  it("blocks Buyer and discards an in-flight previous session", async () => {
    mocks.auth.user.role = "USER";
    const view = render(<SearchAnalytics scope="SELLER" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
    view.unmount();
    mocks.auth.user.role = "SELLER";
    let resolve!: (v: unknown) => void;
    mocks.fetch.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<SearchAnalytics scope="SELLER" />);
    fireEvent.click(screen.getByRole("button"));
    mocks.session++;
    await act(async () => {
      resolve(report);
    });
    expect(screen.queryByText("Văn bản kết hợp")).not.toBeInTheDocument();
  });
  it("rejects impossible click count instead of rendering upstream data as true", async () => {
    mocks.fetch.mockResolvedValue({
      ...report,
      totals: { impressions: 0, clicks: 1 },
    });
    render(<SearchAnalytics scope="SELLER" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
