import { cancellableUnpaidPayment } from '../vnpay/paymentPolicy';
import { useEffect, useId, useRef, useState } from "react";
import { getAuthSessionVersion } from "../../services/apiClient";
import { validOrderId, validOrderMoney } from "../../services/orderResponse";
import { orderMoney } from "../order-readiness/orderPolicy";
import type { OrderDetail } from "../../types/order";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import {
  normalizeBuyerCommand,
  type BuyerCommand,
  type BuyerCommandBody,
  type BuyerCancellationBody,
} from "./buyerCommandFingerprint";
import styles from "./BuyerCommandReview.module.css";

export type BuyerReviewPhase =
  | "confirm-new"
  | "sending"
  | "outcome-unknown"
  | "acknowledged-refreshing"
  | "acknowledged-refresh-error"
  | "blocked";

/** Binding captured by the future parent from its authenticated Buyer GET.
 * OrderDetail intentionally has no buyerId; this binding is NOT ownership proof.
 */
export type BuyerReviewBinding = Readonly<{
  actorId: number;
  sessionVersion: number;
  readKey: string;
}>;
export type BuyerReviewRequest = Readonly<BuyerReviewBinding & {
  orderId: number;
  command: BuyerCommand;
  expectedTotal: string;
  body: BuyerCommandBody;
}>;
export type BuyerCommandReviewProps = {
  session: VerifiedOrderSession | null;
  binding: BuyerReviewBinding;
  order: OrderDetail;
  command: BuyerCommand;
  phase: BuyerReviewPhase;
  fresh: boolean;
  pending: "clear" | "present" | "blocked";
  /** Off by default. No route sets this, no HTTP/storage access in this view. */
  connected?: boolean;
  /** Set only by the authenticated production workspace after integration. */
  integrated?: boolean;
  onConfirm?: (request: BuyerReviewRequest) => unknown | Promise<unknown>;
  onDismiss?: () => void;
  onReload?: () => unknown | Promise<unknown>;
};

export function BuyerCommandReview(props: BuyerCommandReviewProps) {
  const { session, binding, order, command } = props;
  if (
    !session?.isActive || session.actor.role !== "USER" ||
    session.actor.id !== binding.actorId ||
    !validOrderId(binding.actorId) || !validOrderId(order.id) ||
    !Number.isSafeInteger(session.version) || session.version < 0 ||
    session.version !== binding.sessionVersion ||
    session.version !== getAuthSessionVersion() ||
    typeof binding.readKey !== "string" || !binding.readKey.length ||
    typeof order.orderNumber !== "string" || !order.orderNumber.length ||
    !validOrderMoney(order.total) ||
    (command !== "cancel" && command !== "complete")
  ) return <p role="status">Phiên hoặc dữ liệu đơn không còn phù hợp. Chưa gửi thao tác.</p>;

  // Any change of authenticated read, policy or phase discards the old consent
  // and RAM-only reason. Parent must never reuse a readKey for another owner.
  const identity = JSON.stringify([
    binding.actorId, binding.sessionVersion, binding.readKey, order.id,
    order.orderNumber, order.total, order.updatedAt, order.status,
    order.payment, command, props.phase, props.fresh, props.pending,
  ]);
  return <ReviewContent key={identity} {...props} />;
}

function ReviewContent({
  session, binding, order, command, phase, fresh, pending, connected,
  onConfirm, onDismiss, onReload, integrated = false,
}: BuyerCommandReviewProps) {
  const heading = useId(), reasonId = useId(), codeId = useId();
  const mounted = useRef(true), latch = useRef(false), reloadLatch = useRef(false);
  const [reasonCode, setReasonCode] = useState<BuyerCancellationBody["reasonCode"]>("CHANGED_MIND");
  const [reasonText, setReasonText] = useState("");
  const [consent, setConsent] = useState(false), [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false), [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const isCurrent = () => mounted.current && session?.isActive === true &&
    session.actor.role === "USER" && session.actor.id === binding.actorId &&
    session.version === binding.sessionVersion &&
    session.version === getAuthSessionVersion();
  const payment = order.payment;
  const policy = payment !== null && payment.currency === "VND" &&
    payment.amount === order.total && (
      command === "cancel"
        ? order.status === "PENDING_CONFIRMATION" && cancellableUnpaidPayment(payment)
        : order.status === "DELIVERED" && payment.status === "PAID" &&
          typeof payment.paidAt === "string" &&
          Number.isFinite(Date.parse(payment.paidAt)) &&
          new Date(payment.paidAt).toISOString() === payment.paidAt
    );
  const eligible = phase === "confirm-new" && fresh && pending === "clear" && policy;
  const formLocked = !eligible || submitted;
  let body: BuyerCommandBody | null = null;
  try {
    body = normalizeBuyerCommand(command, command === "cancel" ? { reasonCode, reasonText } : {});
  } catch { /* Show an inline safe hint; no raw error or sensitive draft logging. */ }
  const canSend = eligible && !submitted && connected === true && !!onConfirm && !!body && consent;

  function confirm() {
    if (!isCurrent() || !canSend || latch.current || !onConfirm || !body) return;
    latch.current = true;
    setSubmitted(true);
    // Snapshot before handing off. This is consent, NOT a receipt/settlement proof.
    const request = Object.freeze({
      actorId: binding.actorId, sessionVersion: binding.sessionVersion,
      readKey: binding.readKey, orderId: order.id, command,
      expectedTotal: order.total, body: Object.freeze({ ...body }),
    });
    const failure = () => { if (isCurrent()) setFailed(true); };
    try { void Promise.resolve(onConfirm(request)).catch(failure); }
    catch { failure(); }
    // Never unlock or report success just because the callback resolved.
  }
  async function reload() {
    if (!isCurrent() || phase !== "acknowledged-refresh-error" ||
      !connected || !onReload || reloadLatch.current) return;
    reloadLatch.current = true;
    setReloading(true);
    setReloadFailed(false);
    try { await onReload(); }
    catch { if (isCurrent()) setReloadFailed(true); }
    finally {
      if (isCurrent()) { reloadLatch.current = false; setReloading(false); }
    }
  }
  const unknown = phase === "outcome-unknown" || failed;
  return (
    <section className={styles.panel} aria-labelledby={heading}
      aria-busy={phase === "sending" || phase === "acknowledged-refreshing" ||
        (submitted && !failed) || reloading}>
      <p className={styles.preparation}>{integrated ? 'Thao tác với đơn đã lưu. Server kiểm tra lại quyền và trạng thái trước khi ghi nhận.' : 'BẢN CHUẨN BỊ — chưa bật giao dịch Buyer trên Web.'}</p>
      <h2 id={heading}>{command === "cancel" ? "Xác nhận hủy đơn" : "Xác nhận đã nhận hàng"}</h2>
      <p>Đơn <strong>{order.orderNumber}</strong> · Tổng đã lưu: {orderMoney(order.total)}</p>
      {phase === "confirm-new" && <>
        <p>{command === "cancel"
          ? "Chỉ hủy đơn chưa thu tiền khi còn chờ xác nhận. Hủy thành công không tự thêm hàng lại vào giỏ; thanh toán đến muộn cần đối chiếu riêng."
          : "Chỉ xác nhận khi bạn đã thực sự nhận hàng. Đây là hoàn tất đơn, không phải yêu cầu giao hàng."}</p>
        {command === "cancel" && <>
          <label htmlFor={codeId}>Lý do hủy</label>
          <select id={codeId} value={reasonCode} disabled={formLocked} onChange={(e) => {
            const value = e.target.value;
            if (value === "CHANGED_MIND" || value === "OTHER") { setReasonCode(value); setConsent(false); }
          }}>
            <option value="CHANGED_MIND">Tôi đổi ý mua hàng</option>
            <option value="OTHER">Lý do khác</option>
          </select>
          <label htmlFor={reasonId}>Mô tả lý do hủy</label>
          <textarea id={reasonId} value={reasonText} disabled={formLocked}
            aria-describedby={`${reasonId}-hint`} onChange={(e) => {
              setReasonText(e.target.value); setConsent(false);
            }} />
          <p id={`${reasonId}-hint`} className={styles.hint}>
            Bắt buộc 1–500 ký tự sau khi bỏ khoảng trắng đầu/cuối. Lý do chỉ giữ trong màn hiện tại, không lưu vào bộ nhớ trình duyệt.
          </p>
          {reasonText.length > 0 && !body && <p role="alert">Lý do chưa hợp lệ; chưa gửi yêu cầu.</p>}
        </>}
        <label className={styles.confirmation}>
          <input type="checkbox" checked={consent} disabled={formLocked} onChange={(e) => setConsent(e.target.checked)} />
          {command === "cancel" ? "Tôi đồng ý hủy đơn này với lý do trên." : "Tôi đã nhận hàng và đồng ý hoàn tất đơn này."}
        </label>
        {!eligible && <p role="status">Cần dữ liệu mới, trạng thái thanh toán phù hợp và không có yêu cầu cũ đang chờ.</p>}
        <button type="button" disabled={!canSend} onClick={confirm}>
          {command === "cancel" ? "Xác nhận hủy đơn" : "Xác nhận hoàn tất đơn"}
        </button>
        {onDismiss && <button type="button" className={styles.secondary} disabled={submitted}
          onClick={() => { if (isCurrent() && !latch.current) onDismiss(); }}>Quay lại, chưa gửi</button>}
        {!connected && <p>Chưa nối bộ thực thi đã được duyệt; không có request giao dịch từ bản chuẩn bị này.</p>}
      </>}
      {phase === "sending" && <p role="status">Đang gửi yêu cầu. Mất kết nối không chứng minh server chưa xử lý.</p>}
      {submitted && !failed && <p role="status">Đã chuyển yêu cầu; đang chờ kết quả được kiểm chứng, chưa kết luận thành công.</p>}
      {unknown && <p role="alert">Chưa rõ kết quả. Giữ nguyên mã yêu cầu cũ; không gửi lệnh mới. Cần đồng ý đối chiếu riêng; nếu mã chưa thực hiện thì việc đóng mã không phải hủy hoặc hoàn tất đơn.</p>}
      {phase === "acknowledged-refreshing" && <p role="status">Đã xác minh biên nhận; đang tải lại đơn. Không gửi lại lệnh.</p>}
      {phase === "acknowledged-refresh-error" && <>
        <p role="alert">Đã xác minh biên nhận nhưng chưa tải lại được đơn. Chỉ tải lại dữ liệu, không gửi lại lệnh.</p>
        <button type="button" disabled={!connected || !onReload || reloading} onClick={() => void reload()}>Tải lại đơn</button>
      </>}
      {reloadFailed && <p role="status">Vẫn chưa tải được đơn. Kết quả lệnh cũ giữ nguyên; không tạo mã mới.</p>}
      {phase === "blocked" && <p role="alert">Chưa xác minh được yêu cầu hoặc bộ nhớ trình duyệt. Thao tác bị khóa; không tự xóa dữ liệu chờ.</p>}
    </section>
  );
}
