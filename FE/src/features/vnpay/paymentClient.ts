import {
  API_URL,
  ApiError,
  fetchApi,
  getAuthSessionVersion,
} from "../../services/apiClient";
export interface VnpayStatus {
  orderId: number;
  provider: "VNPAY";
  mode: "SANDBOX";
  paymentStatus: string;
  canStart: boolean;
  transaction: null | {
    reference: string;
    status: string;
    amount: string;
    currency: "VND";
    expiresAt: string;
    expired: boolean;
    needsReview: boolean;
    paymentUrl: string | null;
  };
}
const states = [
  "UNPAID",
  "PENDING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUND_PENDING",
  "REFUNDED",
  "REVIEW_REQUIRED",
];
const invalid = (): never => {
  throw new ApiError(
    "Chưa xác minh được phản hồi thanh toán; chỉ tải lại trạng thái, không tự gửi yêu cầu mới.",
    502,
    "VNPAY_INVALID_RESPONSE",
  );
};
function exact(x: unknown, keys: string[]): Record<string, unknown> {
  if (
    !x ||
    typeof x !== "object" ||
    Array.isArray(x) ||
    Object.keys(x).length !== keys.length ||
    Object.keys(x).some((k) => !keys.includes(k))
  )
    return invalid();
  return x as Record<string, unknown>;
}
export function validateVnpayStatus(
  raw: unknown,
  orderId: number,
  amount: string,
): VnpayStatus {
  const x = exact(raw, [
    "orderId",
    "provider",
    "mode",
    "paymentStatus",
    "canStart",
    "transaction",
  ]);
  if (
    x.orderId !== orderId ||
    x.provider !== "VNPAY" ||
    x.mode !== "SANDBOX" ||
    typeof x.canStart !== "boolean" ||
    typeof x.paymentStatus !== "string" ||
    !states.includes(x.paymentStatus)
  )
    return invalid();
  if (x.transaction === null) {
    if (x.canStart && x.paymentStatus !== "UNPAID") return invalid();
    return x as unknown as VnpayStatus;
  }
  if (x.canStart) return invalid();
  const t = exact(x.transaction, [
    "reference",
    "status",
    "amount",
    "currency",
    "expiresAt",
    "expired",
    "needsReview",
    "paymentUrl",
  ]);
  if (
    typeof t.reference !== "string" ||
    !/^[a-f0-9]{32}$/.test(t.reference) ||
    typeof t.status !== "string" ||
    ![
      "PENDING",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
      "REVIEW_REQUIRED",
    ].includes(t.status) ||
    t.amount !== amount ||
    !/^[1-9][0-9]{0,9}\.00$/.test(amount) ||
    t.currency !== "VND" ||
    typeof t.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(t.expiresAt)) ||
    new Date(t.expiresAt).toISOString() !== t.expiresAt ||
    typeof t.expired !== "boolean" ||
    t.needsReview !== (t.status === "REVIEW_REQUIRED")
  )
    return invalid();
  if (t.paymentUrl !== null) {
    if (
      typeof t.paymentUrl !== "string" ||
      t.paymentUrl.length > 4096 ||
      t.status !== "PENDING" ||
      x.paymentStatus !== "PENDING" ||
      t.expired
    )
      return invalid();
    let u: URL;
    try {
      u = new URL(t.paymentUrl);
    } catch {
      return invalid();
    }
    if (
      u.origin !== "https://sandbox.vnpayment.vn" ||
      u.pathname !== "/paymentv2/vpcpay.html" ||
      u.username ||
      u.password ||
      u.hash ||
      [...u.searchParams.keys()].some(
        (k) => u.searchParams.getAll(k).length !== 1,
      ) ||
      u.searchParams.get("vnp_TxnRef") !== t.reference ||
      u.searchParams.get("vnp_Amount") !==
        (BigInt(amount.slice(0, -3)) * 100n).toString() ||
      u.searchParams.get("vnp_Version") !== "2.1.0" ||
      u.searchParams.get("vnp_Command") !== "pay" ||
      !/^[A-Z0-9]{8}$/.test(u.searchParams.get("vnp_TmnCode") ?? "") ||
      !/^[a-f0-9]{128}$/i.test(u.searchParams.get("vnp_SecureHash") ?? "")
    )
      return invalid();
    let r: URL;
    try {
      r = new URL(u.searchParams.get("vnp_ReturnUrl") ?? "");
    } catch {
      return invalid();
    }
    if (
      r.origin !== new URL(API_URL).origin ||
      r.pathname !== "/payments/vnpay/return" ||
      r.username ||
      r.password ||
      r.search ||
      r.hash
    )
      return invalid();
  }
  return x as unknown as VnpayStatus;
}
export function vnpayClient(orderId: number, amount: string) {
  const epoch = getAuthSessionVersion();
  const current = () => {
    if (epoch !== getAuthSessionVersion())
      throw new ApiError(
        "Phiên đã đổi; không dùng kết quả tài khoản trước.",
        0,
        "AUTH_SESSION_CHANGED",
      );
  };
  async function call(start: boolean, signal: AbortSignal) {
    current();
    const raw = await fetchApi(
      `/payments/vnpay/orders/${orderId}${start ? "/start" : ""}`,
      {
        method: start ? "POST" : "GET",
        ...(start ? { body: JSON.stringify({ confirmed: true }) } : {}),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        cache: "no-store",
        retryOnUnauthorized: false,
      },
    );
    current();
    const value = validateVnpayStatus(raw, orderId, amount);
    if (start && !value.transaction) return invalid();
    return value;
  }
  return {
    read: (s: AbortSignal) => call(false, s),
    start: (s: AbortSignal) => call(true, s),
  };
}
