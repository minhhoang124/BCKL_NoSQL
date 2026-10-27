// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { VnpayPayment } from "./VnpayPayment";
import { fetchApi, setAccessToken } from "../../services/apiClient";
const context = vi.hoisted(() => ({ user: { id: 7 }, loading: false }));
vi.mock("../../contexts/useAuth", () => ({ useAuth: () => context }));
vi.mock("../../services/apiClient", async (original) => ({
  ...(await original<typeof import("../../services/apiClient")>()),
  fetchApi: vi.fn(),
}));
const api = vi.mocked(fetchApi),
  empty = {
    orderId: 7,
    provider: "VNPAY",
    mode: "SANDBOX",
    paymentStatus: "UNPAID",
    canStart: true,
    transaction: null,
  };
beforeEach(() => {
  api.mockReset();
  setAccessToken(null);
  context.user = { id: 7 };
  context.loading = false;
  vi.stubEnv("VITE_VNPAY_SANDBOX_ENABLED", "true");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
describe("VNPay UI explicit start and uncertain responses", () => {
  it("default-off gate does not render or contact the API", () => {
    vi.stubEnv("VITE_VNPAY_SANDBOX_ENABLED", "false");
    render(<VnpayPayment orderId={7} amount="10000.00" />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });
  it("mount only reads and consent is required before POST", async () => {
    api.mockResolvedValue(empty);
    render(<VnpayPayment orderId={7} amount="10000.00" />);
    const b = await screen.findByRole("button", {
      name: "Tạo phiên VNPay sandbox",
    });
    expect(b).toBeDisabled();
    expect(api.mock.calls.every(([, o]) => o?.method === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(b).toBeEnabled();
  });
  it("double click performs one POST; timeout hides start until a deliberate read", async () => {
    let fail!: (v: unknown) => void;
    api.mockResolvedValueOnce(empty).mockReturnValueOnce(
      new Promise((_, r) => {
        fail = r;
      }) as never,
    );
    render(<VnpayPayment orderId={7} amount="10000.00" />);
    const b = await screen.findByRole("button", {
      name: "Tạo phiên VNPay sandbox",
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(b);
    fireEvent.click(b);
    expect(api.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(
      1,
    );
    fail(new Error("timeout"));
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: "Tạo phiên VNPay sandbox" }),
    ).toBeNull();
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("StrictMode cleanup/setup cannot leave the panel stuck or start a payment", async () => {
    api.mockImplementation(async (_p, o) => {
      if (o?.signal?.aborted) throw new Error("aborted");
      return empty;
    });
    render(
      <StrictMode>
        <VnpayPayment orderId={7} amount="10000.00" />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Tạo phiên VNPay sandbox" });
    expect(api.mock.calls.every(([, o]) => o?.method === "GET")).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not offer a new attempt for a paid Order", async () => {
    api.mockResolvedValue({ ...empty, paymentStatus: "PAID", canStart: false });
    render(<VnpayPayment orderId={7} amount="10000.00" />);
    await screen.findByText(/Đã thanh toán/);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("changing account during a start cannot install the old response", async () => {
    let release!: (x: unknown) => void;
    api.mockResolvedValueOnce(empty).mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }) as never,
    );
    const r = render(<VnpayPayment orderId={7} amount="10000.00" />);
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Tạo phiên VNPay sandbox" }),
    );
    setAccessToken("synthetic-next-session");
    context.user = { id: 8 };
    api.mockResolvedValue({ ...empty, canStart: false });
    r.rerender(<VnpayPayment orderId={7} amount="10000.00" />);
    release(empty);
    await waitFor(() => expect(api.mock.calls.length).toBe(3));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
