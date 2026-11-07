// @vitest-environment jsdom
// Route integration with mocked HTTP, not live DB evidence.
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextType } from "../../contexts/useAuth";
import { AppRouter } from "../../routes/AppRouter";
import {
  getAuthSessionVersion,
  setAccessToken,
} from "../../services/apiClient";
import {
  detailFixture,
  receiptFixture,
  seller,
  deferred,
} from "../order-readiness/testFixtures";
import { createOrderIntentJournal } from "./orderIntentJournal";

let auth: AuthContextType;
let transport: ReturnType<typeof vi.fn>;
let order = detailFixture();
const json = (x: unknown) => new Response(JSON.stringify(x));
const writes = () =>
  transport.mock.calls.filter(([, o]) => o.method === "POST");
function tree() {
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/seller/orders/19"]}>
        <AppRouter />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
function consent() {
  fireEvent.click(screen.getByRole("checkbox"));
}
beforeEach(() => {
  vi.stubEnv("VITE_SELLER_ORDER_COMMANDS_ENABLED", "true");
  sessionStorage.clear();
  setAccessToken("qa-fixture", seller.id);
  auth = {
    user: seller,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  order = detailFixture();
  transport = vi.fn(async (url: string, options: RequestInit) => {
    if (options.method === "POST") {
      order = { ...order, status: "CONFIRMED" };
      return json(receiptFixture());
    }
    return json(
      url.endsWith("/seller/store")
        ? { id: 4, sellerId: seller.id, status: "ACTIVE" }
        : order,
    );
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  cleanup();
  setAccessToken(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Seller QA route + confirmation/recovery", () => {
  it("route remounts by orderId when following another pending Order, using its correct receipt identity", async () => {
    const pending = createOrderIntentJournal(sessionStorage).prepare(
      { id: seller.id, role: "SELLER" },
      20,
      "confirm",
    );
    transport.mockImplementation(async (url: string, options: RequestInit) => {
      if (options.method === "POST")
        return json({
          outcome: "CLOSED_WITHOUT_EXECUTION",
          resolutionId: 2,
          orderId: 20,
          command: "confirm",
          resolvedAt: "2026-10-18T06:00:00.000Z",
        });
      return json(
        url.endsWith("/seller/store")
          ? { id: 4, sellerId: seller.id, status: "ACTIVE" }
          : detailFixture(url.endsWith("/20") ? 20 : 19),
      );
    });
    render(tree());
    fireEvent.click(
      await screen.findByRole("link", { name: "Đối chiếu đơn 20" }),
    );
    await screen.findByRole("heading", { name: "Đối chiếu yêu cầu đang chờ" });
    expect(screen.getAllByText("FIXTURE-20").length).toBeGreaterThan(0);
    expect(screen.queryByText("FIXTURE-19")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    consent();
    fireEvent.click(
      screen.getByRole("button", { name: "Đối chiếu / dừng yêu cầu cũ" }),
    );
    await screen.findByText(
      "Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn. Đóng mã không phải hủy đơn.",
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatch(/\/seller\/orders\/20\/resolve-command$/);
    expect((writes()[0][1].headers as Headers).get("Idempotency-Key")).toBe(
      pending.idempotencyKey,
    );
    expect(
      sessionStorage.getItem(`bckl-order-command-journal-v1:${seller.id}`),
    ).toBeNull();
  });
  it("Auth becomes inactive without a version bump: parent guard unmounts and fences a late response", async () => {
    const version = getAuthSessionVersion();
    const late = deferred<Response>();
    const view = render(tree());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Xác nhận đơn" }),
      ).toBeEnabled(),
    );
    transport.mockImplementationOnce(() => late.promise);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận thao tác" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    auth = { ...auth, user: { ...seller, isActive: false } };
    view.rerender(tree());
    expect(getAuthSessionVersion()).toBe(version);
    expect(
      screen.queryByRole("region", { name: "Xử lý đơn Seller" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      late.resolve(json(receiptFixture()));
    });
    expect(
      sessionStorage.getItem(`bckl-order-command-journal-v1:${seller.id}`),
    ).not.toBeNull();
    expect(screen.queryByText("Tên sản phẩm lúc mua")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  });
  it("default production flag mounts the real workspace, but GETs only until consent", async () => {
    vi.stubEnv("VITE_SELLER_ORDER_COMMANDS_ENABLED", undefined);
    render(tree());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Xác nhận đơn" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("region", { name: "Xử lý đơn Seller" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/KIỂM THỬ QA/)).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
  it("StrictMode setup-cleanup-setup stays readable and never sends automatically", async () => {
    render(<StrictMode>{tree()}</StrictMode>);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Xác nhận đơn" }),
      ).toBeEnabled(),
    );
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận thao tác" }));
    await screen.findByText(
      "Đã ghi nhận lệnh và tải lại đơn. Mỗi bước tiếp theo cần xác nhận riêng.",
    );
    expect(writes()).toHaveLength(1);
  });
  it("requires separate consent, permits cancel/reopen, sends once and shows fresh next step", async () => {
    render(tree());
    const button = await screen.findByRole("button", { name: "Xác nhận đơn" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(writes()).toHaveLength(0);
    fireEvent.click(button);
    expect(
      screen.getByRole("button", { name: "Xác nhận thao tác" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Hủy xác nhận" }));
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận thao tác" }));
    await screen.findByText(
      "Đã ghi nhận lệnh và tải lại đơn. Mỗi bước tiếp theo cần xác nhận riêng.",
    );
    expect(
      screen.getByRole("button", { name: "Bắt đầu đóng gói" }),
    ).toBeEnabled();
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Hủy đơn" })).toHaveAttribute('href','/seller/orders/19/close');
  });
  it("reload sees pending, never POSTs automatically, and resolver consent uses original key", async () => {
    const pending = createOrderIntentJournal(sessionStorage).prepare(
      { id: seller.id, role: "SELLER" },
      19,
      "confirm",
    );
    transport.mockImplementation(async (url: string, opts: RequestInit) =>
      opts.method === "POST"
        ? json({
            outcome: "CLOSED_WITHOUT_EXECUTION",
            resolutionId: 2,
            orderId: 19,
            command: "confirm",
            resolvedAt: "2026-10-18T06:00:00.000Z",
          })
        : json(
            url.endsWith("/seller/store")
              ? { id: 4, sellerId: seller.id, status: "ACTIVE" }
              : order,
          ),
    );
    render(tree());
    await screen.findByRole("heading", { name: "Đối chiếu yêu cầu đang chờ" });
    expect(writes()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
    const button = screen.getByRole("button", {
      name: "Đối chiếu / dừng yêu cầu cũ",
    });
    expect(button).toBeDisabled();
    consent();
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText(
      "Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn. Đóng mã không phải hủy đơn.",
    );
    expect(writes()).toHaveLength(1);
    expect((writes()[0][1].headers as Headers).get("Idempotency-Key")).toBe(
      pending.idempotencyKey,
    );
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeEnabled();
  });
  it("lost response keeps pending and offers resolution instead of a new execution", async () => {
    transport.mockImplementation(async (url: string, opts: RequestInit) => {
      if (opts.method === "POST") throw new TypeError("lost");
      return json(
        url.endsWith("/seller/store")
          ? { id: 4, sellerId: seller.id, status: "ACTIVE" }
          : order,
      );
    });
    render(tree());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Xác nhận đơn" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận thao tác" }));
    await screen.findByRole("heading", { name: "Đối chiếu yêu cầu đang chờ" });
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
    expect(writes()).toHaveLength(1);
  });
  it("old account response cannot settle or reveal order after session switch", async () => {
    const delayed = deferred<Response>();
    render(tree());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Xác nhận đơn" }),
      ).toBeEnabled(),
    );
    transport.mockImplementationOnce(() => delayed.promise);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận thao tác" }));
    setAccessToken("other-seller", 90);
    auth = { ...auth, user: { ...seller, id: 90 } };
    // React provider replacement would remount the view; check the event-time guard too.
    await act(async () => {
      delayed.resolve(json(receiptFixture()));
    });
    expect(
      sessionStorage.getItem(`bckl-order-command-journal-v1:${seller.id}`),
    ).not.toBeNull();
    expect(screen.queryByText("Tên sản phẩm lúc mua")).not.toBeInTheDocument();
  });
  it("explicit false kill-switch stays read-only and never requests Store or POST", async () => {
    vi.stubEnv("VITE_SELLER_ORDER_COMMANDS_ENABLED", "false");
    render(tree());
    await screen.findByText("Tên sản phẩm lúc mua");
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
    expect(
      transport.mock.calls.some(([url]) =>
        String(url).endsWith("/seller/store"),
      ),
    ).toBe(false);
    expect(writes()).toHaveLength(0);
  });
});
