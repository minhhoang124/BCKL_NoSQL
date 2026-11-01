import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { getAuthSessionVersion } from "../../services/apiClient";
import { OrderDetailPanel } from "../order-readiness/OrderPanels";
import { SellerCommandReview } from "./SellerCommandReview";
import { SellerResolutionReview } from "./SellerResolutionReview";
import { createSellerOrderWorkflow } from "./sellerOrderWorkflow";
import {
  pendingSellerClose,
  eligibleClose,
  type CloseIntent,
} from "./sellerCloseClient";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import styles from "./SellerOrderWorkspace.module.css";

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    const blocked = (): never => {
      throw new Error("Không truy cập được bộ nhớ phục hồi.");
    };
    return { getItem: blocked, setItem: blocked, removeItem: blocked };
  }
}
/** Production route. GET only on mount; every POST requires separate consent. */
export function SellerOrderWorkspace({ orderId }: { orderId: number }) {
  const { user, loading } = useAuth();
  const version = getAuthSessionVersion();
  const session: VerifiedOrderSession | null =
    !loading && user?.isActive && user.role === "SELLER"
      ? { actor: { id: user.id, role: "SELLER" }, version, isActive: true }
      : null;
  const [flow] = useState(() =>
    createSellerOrderWorkflow({
      orderId,
      storage: storage(),
      getSession: () => session,
    }),
  );
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot);
  useEffect(() => {
    flow.setMounted(true);
    void flow.reload();
    return () => {
      flow.setMounted(false);
    };
  }, [flow]);
  const busy = [
    "loading",
    "sending",
    "resolving",
    "committed-refreshing",
    "closed-refreshing",
  ].includes(state.phase);
  const refreshFailed =
    state.phase === "committed-refresh-error" ||
    state.phase === "closed-refresh-error";
  const confirming = state.phase === "confirm-new";
  const pending = state.pending;
  let closing: CloseIntent | null = null,
    closingBlocked = false;
  try {
    if (user) closing = pendingSellerClose(storage(), user.id);
  } catch {
    closingBlocked = true;
  }
  return (
    <section className={styles.workspace} aria-label="Xử lý đơn Seller">
      {closingBlocked && (
        <p role="alert">
          Không đọc được yêu cầu hủy/nhận hoàn. Chưa được gửi lệnh mới.
        </p>
      )}
      {closing && (
        <p role="alert">
          Còn yêu cầu hủy/nhận hoàn cần đối chiếu.{" "}
          <Link to={`/seller/orders/${closing.orderId}/close`}>
            Đối chiếu đơn {closing.orderId}
          </Link>{" "}
          trước thao tác khác.
        </p>
      )}
      {state.phase === "ready" &&
        !pending &&
        !closing &&
        !closingBlocked &&
        state.order &&
        state.store && (
          <>
            {eligibleClose(state.order, state.store.status, "cancel") && (
              <p>
                <Link className={styles.outline} to={`/seller/orders/${orderId}/close`}>Hủy đơn</Link>
              </p>
            )}
            {eligibleClose(
              state.order,
              state.store.status,
              "confirm-returned",
            ) && (
              <p>
                <Link className={styles.outline} to={`/seller/orders/${orderId}/close`}>
                  Xác nhận hàng quay về
                </Link>
              </p>
            )}
          </>
        )}
      {state.order &&
        state.phase !== "ready" &&
        state.phase !== "confirm-new" && (
          <p className={styles.stale}>
            Chi tiết bên dưới là lần tải trước; thao tác mới đang khóa cho đến
            khi xác minh xong.
          </p>
        )}
      <button
        className={styles.reload}
        type="button"
        disabled={busy || confirming || state.phase === "blocked"}
        onClick={() => {
          void flow.reload();
        }}
      >
        {refreshFailed ? "Tải lại đơn" : "Làm mới chi tiết đơn"}
      </button>
      {state.phase === "error" && (
        <p role="alert">
          Chưa tải được đơn hoặc cửa hàng. Thử tải lại; chưa được gửi lệnh.
        </p>
      )}
      {state.phase === "blocked" && (
        <p role="alert">
          Không thể xác minh phiên hoặc bộ nhớ yêu cầu. Thao tác đang khóa;
          không tự xóa mã chờ.
        </p>
      )}
      {refreshFailed && (
        <p role="alert">
          {state.phase === "committed-refresh-error"
            ? "Đã ghi nhận lệnh."
            : "Đã đóng yêu cầu chưa thực hiện."}{" "}
          Chưa tải lại được đơn. Chỉ tải lại dữ liệu, không gửi lại lệnh.
        </p>
      )}
      {state.phase === "sending" && (
        <p role="status">
          Đang gửi. Mất phản hồi không có nghĩa giao dịch đã hoàn tác.
        </p>
      )}
      {state.phase === "ready" && state.outcome && (
        <p role="status">
          {state.outcome === "committed"
            ? "Đã ghi nhận lệnh và tải lại đơn. Mỗi bước tiếp theo cần xác nhận riêng."
            : "Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn. Đóng mã không phải hủy đơn."}
        </p>
      )}
      {(state.order || state.phase === "loading") && (
        <OrderDetailPanel
          source="api"
          readKey={`${version}:${orderId}:${state.revision}`}
          state={
            state.order
              ? { status: "ready", data: state.order }
              : state.phase === "loading"
                ? { status: "loading" }
                : { status: "idle" }
          }
          context={{
            scope: "seller",
            user,
            store: state.store ?? undefined,
            fresh: state.phase === "ready",
            busy:
              busy ||
              confirming ||
              state.phase === "blocked" ||
              !!closing ||
              closingBlocked,
            closingConnected: true,
            outcomeUnknown: pending !== null,
          }}
          onAction={(command) => flow.choose(command)}
        />
      )}
      {confirming && state.command && state.order && session && (
        <SellerCommandReview
          connected
          integrated
          session={session}
          fresh
          target={{
            actorId: session.actor.id,
            sessionVersion: version,
            orderId,
            orderNumber: state.order.orderNumber,
            command: state.command,
          }}
          phase="confirm-new"
          onCancel={flow.cancelConfirmation}
          onConfirm={async () => {
            await flow.execute(true);
          }}
        />
      )}
      {pending && pending.orderId !== orderId && (
        <p role="alert">
          Còn yêu cầu chưa rõ kết quả ở đơn khác.{" "}
          <Link to={`/seller/orders/${pending.orderId}`}>
            Đối chiếu đơn {pending.orderId}
          </Link>{" "}
          trước thao tác mới.
        </p>
      )}
      {pending &&
        pending.orderId === orderId &&
        ["unknown", "resolving"].includes(state.phase) && (
          <SellerResolutionReview
            connected
            integrated
            session={session}
            intent={pending}
            orderNumber={state.order?.orderNumber ?? `Mã ${orderId}`}
            phase={
              state.phase === "resolving" ? "resolving" : "confirm-resolution"
            }
            onResolve={async (intent) => {
              await flow.resolve(intent, true);
              if (flow.snapshot().phase === "unknown")
                throw new Error("Chưa xác minh được kết quả.");
            }}
          />
        )}
    </section>
  );
}
