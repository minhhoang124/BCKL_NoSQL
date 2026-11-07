import { useId, useRef, useState } from "react";
import { getAuthSessionVersion } from "../../services/apiClient";
import { PREPARATION_COMMANDS } from "../../types/order";
import { validOrderId } from "../../services/orderResponse";
import type { PendingOrderIntent } from "./orderIntentJournal";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import type { SellerResolutionPhase } from "./sellerResolutionFlow";
import styles from "./SellerCommandReview.module.css";

type Props = {
  connected?: boolean;
  integrated?: boolean;
  session: VerifiedOrderSession | null;
  intent: PendingOrderIntent;
  orderNumber: string;
  phase: SellerResolutionPhase;
  onResolve?: (intent: PendingOrderIntent) => void | Promise<unknown>;
  onReload?: () => void | Promise<unknown>;
};
/** Separate confirmation: resolving may permanently stop the unexecuted old intent.
 * No route mounts this view, no callback means disabled, no automatic request.
 */
export function SellerResolutionReview(props: Props) {
  const { session: s, intent: i } = props;
  if (
    !s?.isActive ||
    s.actor.role !== "SELLER" ||
    s.actor.id !== i.actorId ||
    i.role !== "SELLER" ||
    s.version !== getAuthSessionVersion() ||
    !Number.isSafeInteger(s.version) ||
    s.version < 0 ||
    !validOrderId(i.orderId) ||
    !validOrderId(i.actorId) ||
    !PREPARATION_COMMANDS.some((c) => c === i.command) ||
    typeof i.idempotencyKey !== "string" ||
    i.idempotencyKey.length < 16 ||
    i.idempotencyKey.length > 128 ||
    /[^A-Za-z0-9_-]/.test(i.idempotencyKey)
  )
    return (
      <p role="status">
        Phiên hoặc yêu cầu không còn phù hợp. Chưa được đối chiếu.
      </p>
    );
  return (
    <Content
      key={`${s.version}:${i.actorId}:${i.orderId}:${i.command}:${i.idempotencyKey}:${i.createdAt}:${props.phase}`}
      {...props}
    />
  );
}
function Content({
  session,
  intent,
  orderNumber,
  phase,
  onResolve,
  onReload,
  connected,
  integrated,
}: Props) {
  const id = useId(),
    latch = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  const canResolve =
    phase === "confirm-resolution" && !!onResolve && !submitted;
  const refreshError =
    phase === "committed-refresh-error" || phase === "closed-refresh-error";
  const resolveFailed = () => {
    setFailed(true);
    setConfirmed(false);
    setSubmitted(false);
    latch.current = false;
  };
  const reloadFinished = () => {
    setSubmitted(false);
    latch.current = false;
  };
  return (
    <section
      className={styles.panel}
      aria-labelledby={id}
      aria-busy={
        (submitted && !failed) ||
        phase === "resolving" ||
        phase.endsWith("-refreshing")
      }
    >
      <p className={styles.preparation}>
        {integrated
          ? "Đối chiếu kết quả đã lưu trên hệ thống, không tự thực hiện lại lệnh cũ."
          : connected
            ? "Kiểm tra kết quả của yêu cầu đang chờ trước khi tiếp tục."
            : "Tạm thời chưa thể kiểm tra yêu cầu. Vui lòng thử lại sau."}
      </p>
      <h2 id={id}>Đối chiếu yêu cầu đang chờ</h2>
      <p>
        Đơn <strong>{orderNumber}</strong> · mã {intent.orderId}
      </p>
      <p>
        Nếu lệnh cũ đã thực hiện, hệ thống trả kết quả đã lưu. Nếu chưa thực
        hiện, mã yêu cầu cũ sẽ bị đóng và không chạy về sau. Đây không phải hủy
        đơn hàng.
      </p>
      {phase === "confirm-resolution" && (
        <>
          <label className={styles.confirmation}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!canResolve}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Tôi đồng ý đối chiếu và dừng yêu cầu cũ nếu chưa thực hiện.
          </label>
          <button
            type="button"
            disabled={!canResolve || !confirmed}
            onClick={() => {
              if (
                !canResolve ||
                !confirmed ||
                latch.current ||
                !onResolve ||
                !session ||
                session.version !== getAuthSessionVersion()
              )
                return;
              latch.current = true;
              setSubmitted(true);
              setFailed(false);
              try {
                void Promise.resolve(
                  onResolve(Object.freeze({ ...intent })),
                ).catch(resolveFailed);
              } catch {
                resolveFailed();
              }
            }}
          >
            Đối chiếu / dừng yêu cầu cũ
          </button>
        </>
      )}
      {phase.startsWith("committed-") && (
        <p role="status">
          Đã ghi nhận lệnh cũ. Không gửi lại lệnh chỉ vì chưa tải được đơn.
        </p>
      )}
      {phase.startsWith("closed-") && (
        <p role="status">
          Đã đóng yêu cầu chưa thực hiện. Cần tải lại đơn trước một thao tác
          mới.
        </p>
      )}
      {phase === "resolving" && (
        <p role="status">
          Đang đối chiếu. Mất kết nối không chứng minh yêu cầu chưa xử lý.
        </p>
      )}
      {failed && (
        <p role="alert">
          Chưa xác minh được kết quả. Giữ nguyên mã yêu cầu cũ, không tự gửi
          lại.
        </p>
      )}
      {refreshError && (
        <p role="alert">
          Chưa tải lại được đơn. Chỉ tải lại dữ liệu; chưa được tạo lệnh mới.
        </p>
      )}
      {refreshError && onReload && (
        <button
          type="button"
          disabled={submitted}
          onClick={() => {
            if (
              latch.current ||
              !session ||
              session.version !== getAuthSessionVersion()
            )
              return;
            latch.current = true;
            setSubmitted(true);
            // A failed GET does not make a verified settlement unknown again. Permit only another GET.
            try {
              void Promise.resolve(onReload()).then(
                reloadFinished,
                reloadFinished,
              );
            } catch {
              reloadFinished();
            }
          }}
        >
          Tải lại đơn
        </button>
      )}
      {phase === "blocked" && (
        <p role="alert">
          Không thể xác minh phiên hoặc yêu cầu. Thao tác đang khóa.
        </p>
      )}
    </section>
  );
}
