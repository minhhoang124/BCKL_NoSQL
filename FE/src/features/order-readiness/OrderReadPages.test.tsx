// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextType } from "../../contexts/useAuth";
import { ApiError, fetchApi, setAccessToken } from "../../services/apiClient";
import { AppRouter } from "../../routes/AppRouter";
import {
  buyer,
  seller,
  detailFixture,
  summaryFixture,
  deferred,
} from "./testFixtures";
vi.mock("../../services/apiClient", async (original) => ({
  ...(await original<typeof import("../../services/apiClient")>()),
  fetchApi: vi.fn(),
}));
vi.mock("../../pages/HomePage", () => ({
  HomePage: () => <h1>Trang chủ kiểm thử</h1>,
}));
vi.mock("../../pages/LoginPage", () => ({
  LoginPage: () => <h1>Đăng nhập kiểm thử</h1>,
}));
const api = vi.mocked(fetchApi);
let auth: AuthContextType;
function Controls() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/account/orders/20")}>
      Test navigate 20
    </button>
  );
}
function tree(path: string) {
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
        <Controls />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
beforeEach(() => {
  // Preserve explicit read-only fallback coverage; command workspace has its
  // own production-route tests with the feature enabled/default.
  vi.stubEnv('VITE_BUYER_ORDER_COMMANDS_ENABLED', 'false');
  vi.stubEnv('VITE_SELLER_ORDER_COMMANDS_ENABLED', 'false');
  api.mockReset();
  setAccessToken("fixture-only", buyer.id);
  auth = {
    user: buyer,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
});
afterEach(() => {
  // This read-only route layer must never issue a business write.
  expect(
    api.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
  cleanup();
  setAccessToken(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("Order routes + merged GET client/validators (mock HTTP boundary, not live DB)", () => {
  it("shows only implemented Buyer account links and current session identity", async () => {
    api.mockResolvedValue({ items: [], nextCursor: null });
    render(tree("/account/orders"));
    await screen.findByText("Chưa có đơn trong bộ lọc này.");
    const nav = screen.getByRole("navigation", {
      name: "Điều hướng tài khoản",
    });
    // Shared AccountLayout: only implemented account sections (profile, addresses, orders, ...).
    expect(nav.querySelectorAll("a").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("link", { name: "Hồ sơ của tôi" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "Đơn mua" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Sổ địa chỉ" })).toHaveAttribute(
      "href",
      "/account/addresses",
    );
    expect(
      screen.getByRole("complementary", { name: "Tài khoản mua hàng" }),
    ).toHaveTextContent(buyer.email);
  });
  it("opens Buyer list, next cursor, resets filter and opens snapshot detail", async () => {
    api.mockImplementation(async (path) => {
      if (path === "/orders/19") return detailFixture();
      if (path.includes("status=CONFIRMED"))
        return { items: [], nextCursor: null };
      return path.includes("afterId=20")
        ? { items: [summaryFixture(19)], nextCursor: null }
        : { items: [summaryFixture(20)], nextCursor: 20 };
    });
    render(tree("/account/orders"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Trang tiếp theo" }),
    );
    await screen.findByRole("button", { name: "Xem chi tiết FIXTURE-19" });
    expect(api).toHaveBeenLastCalledWith(
      "/orders?limit=20&afterId=20",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.queryByLabelText("Trạng thái đơn")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đã xác nhận" }));
    await screen.findByText("Chưa có đơn trong bộ lọc này.");
    expect(api.mock.calls.at(-1)?.[0]).toBe(
      "/orders?limit=20&status=CONFIRMED",
    );
    fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Trang tiếp theo" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem chi tiết FIXTURE-19" }),
    );
    expect(await screen.findByText("Tên sản phẩm lúc mua")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hủy đơn" })).toBeDisabled();
  });
  it("matches Seller route before dashboard wildcard and keeps commands disabled", async () => {
    auth.user = seller;
    setAccessToken("fixture-only", seller.id);
    api.mockResolvedValue(detailFixture());
    render(tree("/seller/orders/19"));
    await screen.findByText("Tên sản phẩm lúc mua");
    expect(api.mock.calls[0][0]).toBe("/seller/orders/19");
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
  });
  it("uses Seller list endpoint without a caller-supplied storeId", async () => {
    auth.user = seller;
    setAccessToken("fixture-only", seller.id);
    api.mockResolvedValue({ items: [summaryFixture()], nextCursor: null });
    render(tree("/seller/orders"));
    await screen.findByRole("heading", { name: "Đơn hàng của cửa hàng" });
    await screen.findByText("FIXTURE-19");
    expect(api.mock.calls[0][0]).toBe("/seller/orders?limit=20");
  });
  it.each([
    "/account/orders/01",
    "/account/orders/2147483648",
    "/account/orders/1e2",
    "/account/orders/0",
  ])("rejects invalid ID before HTTP: %s", (path) => {
    render(tree(path));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Mã đơn hàng không hợp lệ",
    );
    expect(api).not.toHaveBeenCalled();
  });
  it.each([
    "?status=ALL",
    "?status=CONFIRMED&status=PACKING",
    "?afterId=0",
    "?storeId=8",
  ])("rejects invalid query before HTTP: %s", (query) => {
    render(tree("/account/orders" + query));
    expect(screen.getByRole("alert")).toHaveTextContent("Bộ lọc");
    expect(api).not.toHaveBeenCalled();
  });
  it("does not show false empty on error and retries the same cursor", async () => {
    api
      .mockRejectedValueOnce(new ApiError("offline", 503))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    render(tree("/account/orders?afterId=20"));
    await screen.findByRole("alert");
    expect(
      screen.queryByText("Chưa có đơn trong bộ lọc này."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại đơn" }));
    await screen.findByText("Chưa có đơn trong bộ lọc này.");
    expect(api.mock.calls[0][0]).toBe(api.mock.calls[1][0]);
  });
  it("rejects malformed HTTP 200 before exposing private payload", async () => {
    api.mockResolvedValue({
      ...detailFixture(),
      internalSecret: "do-not-render",
    });
    render(tree("/account/orders/19"));
    expect(await screen.findByRole("alert")).toHaveTextContent("không hợp lệ");
    expect(screen.queryByText("Tên sản phẩm lúc mua")).not.toBeInTheDocument();
  });
  it("uses a shared safe 404 message", async () => {
    api.mockRejectedValue(new ApiError("hidden", 404));
    render(tree("/account/orders/19"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập",
    );
  });
  it("clears already rendered data when Buyer changes and ignores late old response", async () => {
    const old = deferred<unknown>(),
      next = deferred<unknown>();
    api
      .mockResolvedValueOnce(detailFixture())
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const view = render(tree("/account/orders/19"));
    await screen.findByText("Tên sản phẩm lúc mua");
    fireEvent.click(
      screen.getByRole("button", { name: "Làm mới chi tiết đơn" }),
    );
    auth = { ...auth, user: { ...buyer, id: 90 } };
    setAccessToken("buyer-b-fixture", 90);
    view.rerender(tree("/account/orders/19"));
    expect(screen.queryByText("Tên sản phẩm lúc mua")).not.toBeInTheDocument();
    await act(async () => old.resolve(detailFixture()));
    expect(screen.queryByText("Tên sản phẩm lúc mua")).not.toBeInTheDocument();
    await act(async () => next.reject(new ApiError("hidden", 404)));
    await screen.findByRole("alert");
  });
  it("clears personal data on a new login of the same Buyer ID", async () => {
    api
      .mockResolvedValueOnce(detailFixture())
      .mockImplementationOnce(() => new Promise(() => {}));
    const view = render(tree("/account/orders/19"));
    await screen.findByText("Tên sản phẩm lúc mua");
    setAccessToken("same-buyer-new-session-fixture", buyer.id);
    view.rerender(tree("/account/orders/19"));
    expect(screen.queryByText("Tên sản phẩm lúc mua")).not.toBeInTheDocument();
    expect(screen.getByText("Đang tải đơn hàng…")).toBeInTheDocument();
  });
  it("changes detail route while an old read is pending without rendering its response", async () => {
    const old = deferred<unknown>();
    api
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(detailFixture(20));
    render(tree("/account/orders/19"));
    fireEvent.click(screen.getByRole("button", { name: "Test navigate 20" }));
    await screen.findByRole("heading", { name: "FIXTURE-20" });
    await act(async () => old.resolve(detailFixture(19)));
    expect(
      screen.queryByRole("heading", { name: "FIXTURE-19" }),
    ).not.toBeInTheDocument();
  });
  it.each(["guest", "wrong-role", "inactive"] as const)(
    "blocks %s without reading Order API",
    async (actor) => {
      auth.user =
        actor === "guest"
          ? null
          : actor === "inactive"
            ? { ...buyer, isActive: false }
            : seller;
      render(tree("/account/orders"));
      if (actor === "guest") await screen.findByText("Đăng nhập kiểm thử");
      else if (actor === "wrong-role")
        await screen.findByText("Trang chủ kiểm thử");
      else
        expect(screen.getByRole("alert")).toHaveTextContent("đang hoạt động");
      expect(api).not.toHaveBeenCalled();
    },
  );
  it("shows Account entry point", () => {
    render(tree("/account"));
    expect(
      screen.getByRole("link", { name: "Đơn mua" }),
    ).toHaveAttribute("href", "/account/orders");
  });
  it('renders item preview with product details and hasMoreItems note in list panel', async () => {
    api.mockResolvedValueOnce({
      items: [
        {
          ...summaryFixture(19),
          itemPreview: [
            {
              orderItemId: 501,
              productId: 88,
              variantId: 301,
              productName: 'Tai nghe Bluetooth XYZ',
              options: ['Đen', 'Pro'],
              quantity: 2,
              unitPrice: '20000.00',
              lineTotal: '40000.00',
              imageUrl: '/uploads/products/88/main.webp',
            },
          ],
          itemCount: 3,
          totalQuantity: 4,
          hasMoreItems: true,
        },
      ],
      nextCursor: null,
    });
    render(tree('/account/orders'));
    expect(await screen.findByText('Tai nghe Bluetooth XYZ')).toBeInTheDocument();
    expect(screen.getByText('Phân loại: Đen / Pro')).toBeInTheDocument();
    expect(screen.getByText('x2')).toBeInTheDocument();
    expect(screen.getByText('40.000 đ')).toBeInTheDocument();
    expect(screen.getByText('và 2 sản phẩm khác...')).toBeInTheDocument();
  });

});
