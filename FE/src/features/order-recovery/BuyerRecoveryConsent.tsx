import { useEffect, useId, useRef, useState } from "react";
import { getAuthSessionVersion } from "../../services/apiClient";
import { validOrderId } from "../../services/orderResponse";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import type { BuyerIntentV2 } from "./buyerIntentJournal";
import styles from "./SellerCommandReview.module.css";

export type BuyerRecoveryPhase =
  | "confirm-resolution"
  | "resolving"
  | "committed"
  | "closed"
  | "committed-refresh-error"
  | "closed-refresh-error"
  | "blocked";
type Props = {
  session: VerifiedOrderSession | null;
  intent: BuyerIntentV2;
  phase: BuyerRecoveryPhase;
  connected?: boolean;
  onResolve?: (intent: BuyerIntentV2) => unknown | Promise<unknown>;
  onReload?: () => unknown | Promise<unknown>;
};
/** Not mounted by any route. Consent alone is NOT settlement proof/permission. */
export function BuyerRecoveryConsent(props: Props) {
  const { session: s, intent: i } = props;
  if (
    !s?.isActive ||
    s.actor.role !== "USER" ||
    s.actor.id !== i.actorId ||
    s.version !== getAuthSessionVersion() ||
    !Number.isSafeInteger(s.version) ||
    s.version < 0 ||
    i.schemaVersion !== 2 ||
    i.role !== "USER" ||
    !validOrderId(i.actorId) ||
    !validOrderId(i.orderId) ||
    (i.command !== "cancel" && i.command !== "complete") ||
    i.hashVersion !== 1 ||
    typeof i.requestHash !== "string" ||
    i.requestHash.length !== 64 ||
    /[^0-9a-f]/.test(i.requestHash) ||
    typeof i.idempotencyKey !== "string" ||
    i.idempotencyKey.length < 16 ||
    i.idempotencyKey.length > 128 ||
    /[^A-Za-z0-9_-]/.test(i.idempotencyKey) ||
    typeof i.createdAt !== "string" ||
    !Number.isFinite(Date.parse(i.createdAt)) ||
    new Date(i.createdAt).toISOString() !== i.createdAt
  )
    return (
      <p role="status">Phiên hoặc yêu cầu không hợp lệ. Chưa được đối chiếu.</p>
    );
  return (
    <Content
      key={`${s.version}:${i.actorId}:${i.orderId}:${i.command}:${i.idempotencyKey}:${i.createdAt}:${i.requestHash}:${props.phase}`}
      {...props}
    />
  );
}
function Content({
  session,
  intent,
  phase,
  connected,
  onResolve,
  onReload,
}: Props) {
  const id = useId(),
    latch = useRef(false),
    mounted = useRef(true);
  const [consent, setConsent] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = () =>
    mounted.current && !!session && session.version === getAuthSessionVersion();
  const reloadOnly =
    phase === "committed-refresh-error" || phase === "closed-refresh-error";
  async function run() {
    if (!isCurrent() || latch.current || !connected) return;
    if (reloadOnly) {
      if (!onReload) return;
    } else if (phase !== "confirm-resolution" || !consent || !onResolve) return;
    latch.current = true;
    setSubmitted(true);
    setFailed(false);
    try {
      if (reloadOnly) await onReload!();
      else await onResolve!(Object.freeze({ ...intent }));
    } catch {
      if (isCurrent()) {
        setFailed(true);
        setConsent(false);
        latch.current = false;
        setSubmitted(false);
      }
    } finally {
      // A successful resolution waits for the parent's verified phase update;
      // never reset to an executable state on our own.
      if (isCurrent() && reloadOnly) {
        latch.current = false;
        setSubmitted(false);
      }
    }
  }
  return (
    <section className={styles.panel} aria-label="Đối chiếu yêu cầu người mua">
      <h3>
        Yêu cầu {intent.command === "cancel" ? "hủy đơn" : "xác nhận hoàn tất"}{" "}
        đang chờ
      </h3>
      <p>
        Mất kết nối không chứng minh lệnh cũ chưa chạy. Không tạo mã mới hoặc
        gửi lại với nội dung khác.
      </p>
      {phase === "confirm-resolution" && (
        <>
          <label htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={consent}
              disabled={submitted || !connected || !onResolve}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            Nếu chưa thực hiện, tôi đồng ý đóng mã yêu cầu cũ. Đóng mã không
            phải hủy đơn hoặc hoàn tất đơn.
          </label>
          <button
            type="button"
            disabled={!connected || !onResolve || !consent || submitted}
            onClick={() => void run()}
          >
            Đối chiếu / dừng yêu cầu cũ
          </button>
        </>
      )}
      {phase === "resolving" && (
        <p role="status">
          Đang đối chiếu. Giữ nguyên yêu cầu khi chưa nhận được kết quả hợp lệ.
        </p>
      )}
      {phase.startsWith("committed") && (
        <p role="status">
          Đã ghi nhận lệnh cũ. Lỗi tải đơn không có nghĩa cần thực hiện lại
          lệnh.
        </p>
      )}
      {phase.startsWith("closed") && (
        <p role="status">
          Đã đóng mã chưa thực hiện. Cần tải lại đơn trước một thao tác mới.
        </p>
      )}
      {reloadOnly && (
        <button
          type="button"
          disabled={!connected || !onReload || submitted}
          onClick={() => void run()}
        >
          Tải lại đơn
        </button>
      )}
      {failed && (
        <p role="alert">
          {reloadOnly
            ? "Đã biết kết quả lệnh cũ nhưng chưa tải lại được đơn. Chỉ tải lại dữ liệu, không gửi lại lệnh."
            : "Chưa xác minh được kết quả. Giữ nguyên yêu cầu cũ; không tự gửi lại."}
        </p>
      )}
      {phase === "blocked" && (
        <p role="alert">
          Chưa xác minh được phiên hoặc yêu cầu. Thao tác đang khóa.
        </p>
      )}
    </section>
  );
}
