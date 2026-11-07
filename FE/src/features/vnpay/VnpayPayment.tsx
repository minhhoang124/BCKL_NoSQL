import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { getAuthSessionVersion } from "../../services/apiClient";
import { vnpayClient, type VnpayStatus } from "./paymentClient";
import styles from "../phone-otp/PhoneOtp.module.css";
type VnpayProps = {
  orderId: number;
  amount: string;
  /** Payment status the parent order view currently shows. */
  knownPaymentStatus?: string;
  /** Called once when the gateway reports PAID but the parent still shows another status. */
  onPaymentChanged?: () => void;
};
function Inner({ orderId, amount, knownPaymentStatus, onPaymentChanged }: VnpayProps) {
  const epoch = getAuthSessionVersion(),
    api = useMemo(() => vnpayClient(orderId, amount), [orderId, amount]);
  const [data, setData] = useState<VnpayStatus | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  const mounted = useRef(true),
    latch = useRef(false),
    flight = useRef<AbortController | null>(null),
    generation = useRef(0);
  const current = (n: number) =>
    mounted.current &&
    epoch === getAuthSessionVersion() &&
    generation.current === n;
  async function run(start = false) {
    if (latch.current || (start && !consent)) return;
    latch.current = true;
    setBusy(true);
    setError("");
    setConsent(false);
    setData(null);
    const c = new AbortController(),
      n = ++generation.current;
    flight.current?.abort();
    flight.current = c;
    try {
      const fresh = await (start ? api.start(c.signal) : api.read(c.signal));
      if (current(n)) {
        setData(fresh);
        // Keep the order card (payment status, cancel button) in sync with a confirmed IPN.
        if (fresh.paymentStatus === "PAID" && knownPaymentStatus !== undefined && knownPaymentStatus !== "PAID")
          onPaymentChanged?.();
      }
    } catch {
      if (current(n))
        setError(
          "Chưa xác định kết quả thanh toán. Tải lại trạng thái; không tự tạo phiên hay chuyển hướng lại.",
        );
    } finally {
      if (current(n)) {
        latch.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    void run();
    return () => {
      mounted.current = false;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the owned async ticket across StrictMode cleanup/setup.
      generation.current++;
      latch.current = false;
      flight.current?.abort();
    };
    // Each actor/session has a distinct parent key. Cleanup cancels the owned async request.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const t = data?.transaction;
  return (
    <section className={styles.panel} aria-label="Thanh toán VNPay sandbox">
      <h2>Thanh toán VNPay — sandbox</h2>
      <p role="note">
        Môi trường thử nghiệm, không dùng thẻ hoặc tiền thật. Mỗi đơn của một
        Shop được thanh toán riêng.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Đang đối chiếu thanh toán…</p>}
      <button disabled={busy} onClick={() => void run()}>
        Tải lại trạng thái thanh toán
      </button>
      {data && (
        <p>
          Trạng thái ghi nhận tại hệ thống:{" "}
          {data.paymentStatus === "PAID"
            ? "Đã thanh toán"
            : data.paymentStatus === "REVIEW_REQUIRED"
              ? "Cần đối chiếu"
              : data.paymentStatus === "CANCELLED"
                ? "Đã hủy thanh toán"
                : data.paymentStatus === "FAILED"
                  ? "Thanh toán thất bại"
                  : "Chưa xác nhận đã thanh toán"}
          . Hãy tải lại đơn để cập nhật các thao tác xử lý.
        </p>
      )}
      {t?.needsReview && (
        <p role="alert">
          Giao dịch cần đối chiếu với VNPay. Không thanh toán thêm hoặc tự coi
          đã hoàn tiền; liên hệ quản trị viên.
        </p>
      )}
      {t?.expired && t.status === "PENDING" && (
        <p>
          Phiên thanh toán đã hết hạn. Hệ thống chưa tự hủy đơn; nếu chưa thanh
          toán, bạn có thể chủ động hủy đơn rồi đặt lại.
        </p>
      )}
      {data && !t && data.canStart && (
        <>
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Tôi đồng ý tạo phiên thanh toán VNPay sandbox cho đơn này.
          </label>
          <button disabled={busy || !consent} onClick={() => void run(true)}>
            Tạo phiên VNPay sandbox
          </button>
        </>
      )}
      {t?.paymentUrl && (
        <>
          <p>
            Phiên đã được lưu. Trở về từ VNPay không đồng nghĩa đã thanh toán;
            hệ thống chờ IPN hợp lệ.
          </p>
          <a
            href={t.paymentUrl}
            rel="noreferrer"
            onClick={(e) => {
              if (epoch !== getAuthSessionVersion()) {
                e.preventDefault();
                setData(null);
                setError(
                  "Phiên đã đổi. Tải lại thanh toán của tài khoản hiện tại.",
                );
              }
            }}
          >
            Mở cổng VNPay sandbox
          </a>
        </>
      )}
    </section>
  );
}
export function VnpayPayment(props: VnpayProps) {
  const { user, loading } = useAuth();
  return !loading &&
    user &&
    import.meta.env.VITE_VNPAY_SANDBOX_ENABLED === "true" ? (
    <Inner
      key={`${user.id}:${getAuthSessionVersion()}:${props.orderId}`}
      {...props}
    />
  ) : null;
}
