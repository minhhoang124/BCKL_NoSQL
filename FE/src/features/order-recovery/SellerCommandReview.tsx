import { useId, useRef, useState } from "react";
import { getAuthSessionVersion } from "../../services/apiClient";
import type { PreparationCommand } from "../../types/order";
import { PREPARATION_COMMANDS } from "../../types/order";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import styles from "./SellerCommandReview.module.css";

export type SellerReviewTarget = Readonly<{
  actorId: number;
  sessionVersion: number;
  orderId: number;
  orderNumber: string;
  command: PreparationCommand;
}>;
export type SellerReviewPhase =
  | "confirm-new"
  | "outcome-unknown"
  | "sending"
  | "acknowledged-refreshing"
  | "acknowledged-refresh-error"
  | "blocked";
type Props = {
  connected?: boolean;
  integrated?: boolean;
  session: VerifiedOrderSession | null;
  target: SellerReviewTarget;
  phase: SellerReviewPhase;
  fresh: boolean;
  // Absent by default: no route or dispatcher is connected in this preparation.
  onConfirm?: (
    target: SellerReviewTarget,
    replay: boolean,
  ) => void | Promise<void>;
  onCancel?: () => void;
  onReload?: () => void;
};
const labels: Record<PreparationCommand, string> = {
  confirm: "Xác nhận đơn",
  "start-packing": "Bắt đầu đóng gói",
  "ready-to-ship": "Sẵn sàng bàn giao",
};

/** Pure preparation UI, not an Auth/ownership boundary or an HTTP controller.
 * Parent must own a stable coordinator and recheck verified session/fresh policy.
 * Never clear an unknown intent from this view, or acknowledge through GET detail.
 */
export function SellerCommandReview(props: Props) {
  const { session, target, phase } = props;
  const validId = (n: number) =>
    Number.isInteger(n) && n > 0 && n <= 2147483647;
  if (
    !session?.isActive ||
    session.actor.role !== "SELLER" ||
    session.actor.id !== target.actorId ||
    session.version !== target.sessionVersion ||
    !validId(target.orderId) ||
    !validId(target.actorId) ||
    !Number.isSafeInteger(session.version) ||
    session.version < 0 ||
    !PREPARATION_COMMANDS.includes(target.command)
  ) {
    // Do not expose a previous account's order identifier or action text.
    return (
      <p role="status">
        Phiên hoặc yêu cầu không còn phù hợp. Chưa được gửi thao tác.
      </p>
    );
  }
  const identity = `${session.version}:${target.actorId}:${target.orderId}:${target.orderNumber}:${target.command}:${phase}`;
  return <ReviewContent key={identity} {...props} />;
}

function ReviewContent({
  target,
  phase,
  fresh,
  onConfirm,
  onCancel,
  onReload,
  connected,
  integrated,
}: Props) {
  const headingId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dispatchError, setDispatchError] = useState(false);
  const latch = useRef(false);
  const replay = phase === "outcome-unknown";
  const canConfirm = phase === "confirm-new" || replay;
  const locked =
    submitted || phase === "sending" || phase === "acknowledged-refreshing";
  // Replay is about the ORIGINAL intent, not the current Order transition. The
  // Backend must recheck ownership and return its receipt; GET state is no proof.
  const eligible = canConfirm && (fresh || replay) && !locked && !!onConfirm;
  return (
    <section
      className={styles.panel}
      aria-labelledby={headingId}
      aria-busy={
        phase === "sending" ||
        phase === "acknowledged-refreshing" ||
        (submitted && !dispatchError)
      }
    >
      <p className={styles.preparation}>
        {integrated
          ? "Thao tác trên đơn đã lưu; kiểm tra thông tin và xác nhận trước khi gửi."
          : connected
            ? "KIỂM THỬ QA — thao tác gọi API thật."
            : "BẢN CHUẨN BỊ — chưa nối thao tác Order trên Web."}
      </p>
      <h2 id={headingId}>{labels[target.command]}</h2>
      <p>
        Đơn <strong>{target.orderNumber}</strong> · mã {target.orderId}
      </p>
      {phase === "confirm-new" && (
        <p>Mỗi bước cần xác nhận riêng. Không tự chuyển sang bước tiếp theo.</p>
      )}
      {replay && (
        <p role="status">
          Chưa rõ kết quả lần trước. Chỉ gửi lại đúng lệnh và mã yêu cầu cũ;
          không tạo yêu cầu mới hoặc xóa mã chờ.
        </p>
      )}
      {phase === "sending" && (
        <p role="status">
          Đang gửi yêu cầu. Mất kết nối không có nghĩa thao tác đã được hoàn
          tác.
        </p>
      )}
      {phase === "acknowledged-refreshing" && (
        <p role="status">Đã ghi nhận thao tác. Đang tải lại trạng thái đơn.</p>
      )}
      {phase === "acknowledged-refresh-error" && (
        <p role="alert">
          Đã ghi nhận thao tác nhưng chưa tải lại được đơn. Chỉ tải lại dữ liệu;
          không gửi lệnh mới.
        </p>
      )}
      {phase === "blocked" && (
        <p role="alert">
          Chưa xác minh được yêu cầu đang chờ. Không bỏ qua khóa hoặc tự xóa dữ
          liệu để gửi lại.
        </p>
      )}
      {phase === "confirm-new" && !fresh && (
        <p role="status">
          Cần tải lại dữ liệu đơn trước khi xác nhận thao tác mới.
        </p>
      )}
      {canConfirm && (
        <>
          <label className={styles.confirmation}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!eligible}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Tôi xác nhận{" "}
            {replay
              ? "gửi lại cùng yêu cầu"
              : labels[target.command].toLowerCase()}{" "}
            cho đơn {target.orderNumber}.
          </label>
          <button
            type="button"
            disabled={!eligible || !confirmed}
            onClick={() => {
              if (
                !eligible ||
                !confirmed ||
                latch.current ||
                !onConfirm ||
                (connected && target.sessionVersion !== getAuthSessionVersion())
              )
                return;
              latch.current = true;
              setSubmitted(true);
              // A local dispatch failure is still not proof of server rollback. Keep
              // this attempt locked; the parent owns transition to unknown/recovery.
              const failed = () => setDispatchError(true);
              try {
                void Promise.resolve(
                  onConfirm(Object.freeze({ ...target }), replay),
                ).catch(failed);
              } catch {
                failed();
              }
            }}
          >
            {replay ? "Gửi lại cùng yêu cầu" : "Xác nhận thao tác"}
          </button>
        </>
      )}
      {submitted && (
        <p role="status">
          Đã chuyển yêu cầu để đối chiếu; không bấm tạo lệnh khác.
        </p>
      )}
      {dispatchError && (
        <p role="alert">
          Chưa xác định được kết quả. Giữ nguyên yêu cầu cũ và chờ đối chiếu.
        </p>
      )}
      {phase === "confirm-new" && onCancel && (
        <button
          type="button"
          className={styles.secondary}
          disabled={locked}
          onClick={onCancel}
        >
          Hủy xác nhận
        </button>
      )}
      {phase === "acknowledged-refresh-error" && onReload && (
        <button type="button" onClick={onReload}>
          Tải lại đơn
        </button>
      )}
      {!onConfirm && canConfirm && (
        <p>Chưa bật gửi lệnh; đang chờ chốt cơ chế xử lý yêu cầu còn chờ.</p>
      )}
    </section>
  );
}
