// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { API_URL, fetchApi, setAccessToken } from "../../services/apiClient";
import { validateVnpayStatus, vnpayClient } from "./paymentClient";
vi.mock("../../services/apiClient", async (original) => ({
  ...(await original<typeof import("../../services/apiClient")>()),
  fetchApi: vi.fn(),
}));
const ref = "a".repeat(32),
  api = vi.mocked(fetchApi),
  amount = "10000.00";
function fixture() {
  const p = new URLSearchParams({
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_Amount: "1000000",
    vnp_TxnRef: ref,
    vnp_TmnCode: "TEST0001",
    vnp_SecureHash: "b".repeat(128),
    vnp_ReturnUrl: new URL(API_URL).origin + "/payments/vnpay/return",
  });
  return {
    orderId: 7,
    provider: "VNPAY",
    mode: "SANDBOX",
    paymentStatus: "PENDING",
    canStart: false,
    transaction: {
      reference: ref,
      status: "PENDING",
      amount,
      currency: "VND",
      expiresAt: "2026-10-27T13:15:00.000Z",
      expired: false,
      needsReview: false,
      paymentUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?" + p,
    },
  };
}
beforeEach(() => {
  setAccessToken(null);
  api.mockReset();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());
describe("VNPay Web boundary — no payment secrets or auto writes", () => {
  it("accepts only bound sandbox amount/ref/return destination", () =>
    expect(
      validateVnpayStatus(fixture(), 7, amount).transaction?.reference,
    ).toBe(ref));
  it.each([
    "https://evil.invalid/pay",
    "https://sandbox.vnpayment.vn.evil.invalid/paymentv2/vpcpay.html",
    "http://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
  ])("blocks foreign or downgraded checkout URL %s", (url) => {
    const x = fixture();
    x.transaction.paymentUrl = url;
    expect(() => validateVnpayStatus(x, 7, amount)).toThrow();
  });
  it.each(["vnp_Amount", "vnp_TxnRef", "vnp_ReturnUrl", "vnp_SecureHash"])(
    "blocks tampered URL field %s",
    (key) => {
      const x = fixture(),
        u = new URL(x.transaction.paymentUrl);
      u.searchParams.set(key, "invalid");
      x.transaction.paymentUrl = u.toString();
      expect(() => validateVnpayStatus(x, 7, amount)).toThrow();
    },
  );
  it("never accepts a pending URL for expired, paid or review state", () => {
    for (const patch of [
      { expired: true },
      { status: "SUCCEEDED" },
      { needsReview: true },
    ]) {
      const x = fixture();
      Object.assign(x.transaction, patch);
      expect(() => validateVnpayStatus(x, 7, amount)).toThrow();
    }
  });
  it("retains no link, key, reference or token in browser storage", async () => {
    api.mockResolvedValue(fixture());
    await vnpayClient(7, amount).start(new AbortController().signal);
    expect(sessionStorage.length).toBe(0);
    expect(api.mock.calls[0][1]).toMatchObject({
      method: "POST",
      retryOnUnauthorized: false,
      body: JSON.stringify({ confirmed: true }),
    });
  });
  it("a read never POSTs and a failed start is not automatically retried", async () => {
    api
      .mockResolvedValueOnce({
        ...fixture(),
        paymentStatus: "UNPAID",
        canStart: true,
        transaction: null,
      })
      .mockRejectedValueOnce(new Error("timeout"));
    const c = vnpayClient(7, amount);
    await c.read(new AbortController().signal);
    await expect(c.start(new AbortController().signal)).rejects.toThrow();
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls.map(([, o]) => o?.method)).toEqual(["GET", "POST"]);
  });
  it("rejects a response from a different login epoch", async () => {
    let release!: (v: unknown) => void;
    api.mockReturnValue(
      new Promise((r) => {
        release = r;
      }) as never,
    );
    const pending = vnpayClient(7, amount).start(new AbortController().signal);
    setAccessToken("synthetic-other-session");
    release(fixture());
    await expect(pending).rejects.toThrow();
  });
  it("malformed start cannot be mistaken for a reusable empty state", async () => {
    api.mockResolvedValue({
      ...fixture(),
      paymentStatus: "UNPAID",
      canStart: true,
      transaction: null,
    });
    await expect(
      vnpayClient(7, amount).start(new AbortController().signal),
    ).rejects.toThrow();
  });
});
