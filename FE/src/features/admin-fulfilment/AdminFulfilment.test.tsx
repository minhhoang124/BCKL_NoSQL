// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
// @ts-expect-error Vitest-only Node WebCrypto; browser config excludes Node ambient types.
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextType } from "../../contexts/useAuth";
import { ApiError, setAccessToken } from "../../services/apiClient";
import { AdminFulfilment } from "./AdminFulfilment";
import {
  adminFulfilmentApi,
  allowed,
  definiteRejection,
  intentHash,
  readPending,
  snapshot,
  storageKey,
  validateReceipt,
  type Snapshot,
} from "./fulfilmentClient";
vi.mock("./fulfilmentClient", async (original) => ({
  ...(await original<typeof import("./fulfilmentClient")>()),
  adminFulfilmentApi: { list: vi.fn(), detail: vi.fn(), send: vi.fn() },
}));
const api = vi.mocked(adminFulfilmentApi),
  actorId = 701;
const ready: Snapshot = {
  id: 11,
  orderNumber: "ORD-QA",
  status: "READY_TO_SHIP",
  total: "20000.00",
  currentDeliveryAttempt: null,
  retryCount: null,
  currentAttempt: null,
  payment: {
    provider: "COD",
    status: "UNPAID",
    amount: "20000.00",
    currency: "VND",
  },
};
const context = (id = actorId): AuthContextType => ({
  user: {
    id,
    email: "admin@example.test",
    role: "ADMIN",
    fullName: "QA",
    isActive: true,
  },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
});
const tree = (id = actorId) => (
  <AuthContext.Provider value={context(id)}>
    <AdminFulfilment />
  </AuthContext.Provider>
);
async function open() {
  render(tree());
  fireEvent.change(screen.getByLabelText("Mã đơn hàng", { exact: true }), {
    target: { value: "11" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Tải đơn" }));
  await screen.findByRole("heading", { name: "Đơn ORD-QA" });
}
function fill(tracking = "TRACK") {
  fireEvent.change(screen.getByLabelText("Mã vận đơn", { exact: true }), {
    target: { value: tracking },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  vi.resetAllMocks();
  setAccessToken("qa", actorId);
  api.list.mockResolvedValue([]);
  api.detail.mockResolvedValue(ready);
  api.send.mockResolvedValue({} as Awaited<ReturnType<typeof api.send>>);
});
afterEach(() => {
  cleanup();
  setAccessToken(null);
  vi.unstubAllGlobals();
});
describe("Admin simulation safety boundary", () => {
  it("a late rejected response cannot clear the journal of a newer session for the same actor", async () => {
    let reject!: (e: unknown) => void;
    api.send.mockImplementation(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    );
    const view = render(tree());
    fireEvent.change(screen.getByLabelText("Mã đơn hàng", { exact: true }), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tải đơn" }));
    await screen.findByRole("heading", { name: "Đơn ORD-QA" });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận mô phỏng" }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    const pending = readPending(actorId);
    setAccessToken("new-session", actorId);
    view.rerender(tree());
    await act(async () => reject(new ApiError("old401", 401, "UNAUTHORIZED")));
    expect(readPending(actorId)).toEqual(pending);
    expect(screen.queryByText("old401")).not.toBeInTheDocument();
  });
  it("clears reason and return receipt when loading a different order", async () => {
    api.detail.mockResolvedValue({
      ...ready,
      status: "SHIPPING",
      currentDeliveryAttempt: 1,
      retryCount: 0,
      currentAttempt: { trackingReference: "TRACK" },
    });
    await open();
    fireEvent.change(screen.getByLabelText("Thao tác", { exact: true }), {
      target: { value: "delivery-failed" },
    });
    fireEvent.change(screen.getByLabelText("Chi tiết lý do", { exact: true }), {
      target: { value: "Previous order private reason" },
    });
    api.detail.mockResolvedValue({
      ...ready,
      id: 12,
      orderNumber: "ORD-NEXT",
      status: "SHIPPING",
      currentDeliveryAttempt: 1,
      retryCount: 0,
      currentAttempt: { trackingReference: "NEXT" },
    });
    fireEvent.change(screen.getByLabelText("Mã đơn hàng", { exact: true }), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tải đơn" }));
    await screen.findByRole("heading", { name: "Đơn ORD-NEXT" });
    expect(
      screen.getByLabelText("Chi tiết lý do", { exact: true }),
    ).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("late detail response cannot replace a more recently selected order", async () => {
    let finish!: (v: Snapshot) => void;
    api.detail.mockImplementation((id) =>
      id === 11
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ ...ready, id: 12, orderNumber: "ORD-NEXT" }),
    );
    render(tree());
    fireEvent.change(screen.getByLabelText("Mã đơn hàng", { exact: true }), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tải đơn" }));
    fireEvent.change(screen.getByLabelText("Mã đơn hàng", { exact: true }), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tải đơn" }));
    await screen.findByRole("heading", { name: "Đơn ORD-NEXT" });
    await act(async () => finish(ready));
    expect(
      screen.queryByRole("heading", { name: "Đơn ORD-QA" }),
    ).not.toBeInTheDocument();
  });
  it("one same-tick flight; journal contains metadata only and no automatic next command", async () => {
    let finish!: () => void;
    api.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({} as Awaited<ReturnType<typeof api.send>>);
        }),
    );
    await open();
    fill();
    const button = screen.getByRole("button", {
      name: "Xác nhận mô phỏng",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    const raw = sessionStorage.getItem(storageKey(actorId))!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
      "actorId",
      "command",
      "hash",
      "key",
      "orderId",
    ]);
    expect(raw).not.toContain("TRACK");
    await act(async () => finish());
    await screen.findByText("Đã xác minh biên nhận.", { exact: false });
    expect(readPending(actorId)).toBeNull();
    expect(api.send).toHaveBeenCalledTimes(1);
  });
  it("uncertain failure keeps original key; changed body is blocked; explicit replay reuses identity", async () => {
    api.send.mockRejectedValueOnce(new TypeError("network lost"));
    await open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận mô phỏng" }));
    await screen.findByRole("alert");
    const original = readPending(actorId)!;
    expect(original).not.toBeNull();
    fill("OTHER");
    fireEvent.click(
      screen.getByRole("button", { name: "Gửi lại cùng yêu cầu" }),
    );
    await screen.findByText("Nội dung khác yêu cầu đang chờ.", {
      exact: false,
    });
    expect(api.send).toHaveBeenCalledTimes(1);
    fill("TRACK");
    fireEvent.click(
      screen.getByRole("button", { name: "Gửi lại cùng yêu cầu" }),
    );
    await screen.findByText("Đã xác minh biên nhận.", { exact: false });
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(api.send.mock.calls[1][0].key).toBe(original.key);
    expect(api.send.mock.calls[1][1]).toEqual({ trackingReference: "TRACK" });
  });
  it("reload recovers metadata and requires original body/consent; a replay 429 cannot clear uncertainty", async () => {
    const pending = {
      actorId,
      orderId: 11,
      command: "ship" as const,
      key: "original_key_0123456789",
      hash: await intentHash(actorId, 11, "ship", {
        trackingReference: "TRACK",
      }),
    };
    sessionStorage.setItem(storageKey(actorId), JSON.stringify(pending));
    api.detail.mockResolvedValue({ ...ready, status: "SHIPPING" });
    api.send.mockRejectedValue(new ApiError("wait", 429, "RATE_LIMITED"));
    render(tree());
    await screen.findByLabelText("Mã vận đơn", { exact: true });
    expect(api.send).not.toHaveBeenCalled();
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Gửi lại cùng yêu cầu" }),
    );
    await screen.findByRole("alert");
    expect(readPending(actorId)).toEqual(pending);
  });
  it("old account response does not clear its journal or appear in a new account", async () => {
    let finish!: () => void;
    api.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({} as Awaited<ReturnType<typeof api.send>>);
        }),
    );
    const view = render(tree());
    fireEvent.change(screen.getByLabelText("Mã đơn hàng", { exact: true }), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tải đơn" }));
    await screen.findByRole("heading", { name: "Đơn ORD-QA" });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận mô phỏng" }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    setAccessToken("new", 702);
    view.rerender(tree(702));
    await act(async () => finish());
    expect(
      screen.queryByText("Đã xác minh biên nhận.", { exact: false }),
    ).not.toBeInTheDocument();
    expect(readPending(actorId)).not.toBeNull();
    expect(readPending(702)).toBeNull();
  });
  it("corrupt journal fails closed", async () => {
    sessionStorage.setItem(storageKey(actorId), "{}");
    render(tree());
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Tải đơn" })).toBeDisabled();
    expect(api.send).not.toHaveBeenCalled();
  });
  it("accepts canonical PACKING state and never offers fifth attempt or non-COD returned", () => {
    expect(snapshot({ ...ready, status: "PACKING" }).status).toBe("PACKING");
    expect(
      allowed({
        ...ready,
        status: "DELIVERY_FAILED",
        currentDeliveryAttempt: 4,
      }),
    ).toEqual(["confirm-returned"]);
    expect(
      allowed({
        ...ready,
        status: "DELIVERY_FAILED",
        currentDeliveryAttempt: 4,
        payment: { ...ready.payment!, provider: "VNPAY" },
      }),
    ).toEqual([]);
  });
  it("rejects wrong order/actor/command receipts without treating them as an acknowledgement", () => {
    const pending = {
      actorId,
      orderId: 11,
      command: "ship" as const,
      key: "original_key_0123456789",
      hash: "a".repeat(64),
    };
    expect(() =>
      validateReceipt({ orderId: 12 }, pending, { trackingReference: "TRACK" }),
    ).toThrow();
    expect(
      definiteRejection(new ApiError("wait", 409, "ORDER_COMMAND_IN_PROGRESS")),
    ).toBe(false);
    expect(
      definiteRejection(new ApiError("stale", 409, "STALE_DELIVERY_ATTEMPT")),
    ).toBe(true);
  });
});
