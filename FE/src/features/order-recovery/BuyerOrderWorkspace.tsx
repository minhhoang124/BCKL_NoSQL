import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { hasBuyerAccess } from "../../utils/buyerAccess";
import { getAuthSessionVersion } from "../../services/apiClient";
import { OrderDetailPanel } from "../order-readiness/OrderPanels";
import { BuyerCommandReview } from "./BuyerCommandReview";
import { BuyerRecoveryConsent } from "./BuyerRecoveryConsent";
import { buyerCanChoose, createBuyerOrderWorkflow } from "./buyerOrderWorkflow";
import type { LegacyBuyerIntent } from "./buyerIntentJournal";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import styles from "./BuyerCommandReview.module.css";
import workspaceStyles from "./BuyerOrderWorkspace.module.css";

/** Authenticated production route integration. The Backend is authoritative. */
export function BuyerOrderWorkspace({ orderId }: { orderId: number }) {
  const { user, loading } = useAuth();
  const version = getAuthSessionVersion();
  if (loading) return <p role="status">Đang xác minh phiên…</p>;
  if (!user?.isActive || !hasBuyerAccess(user))
    return <p role="alert">Cần Buyer đang hoạt động để xem đơn.</p>;
  const session: VerifiedOrderSession = {
    // USER here is the existing BUYER journal context, not a rewritten Auth role.
    // Keep the real user/token and auth session generation unchanged.
    actor: { id: user.id, role: "USER" },
    version,
    isActive: true,
  };
  return (
    <Workspace
      key={`${version}:${user.id}:${orderId}`}
      orderId={orderId}
      session={session}
    />
  );
}
function Workspace({
  orderId,
  session,
}: {
  orderId: number;
  session: VerifiedOrderSession;
}) {
  const { user } = useAuth();
  const [flow] = useState(() =>
    createBuyerOrderWorkflow({
      orderId,
      getSession: () => session,
      getStorage: () => window.sessionStorage,
    }),
  );
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot);
  useEffect(() => {
    flow.mount();
    return () => flow.unmount();
  }, [flow]);
  const busy = ["loading", "sending", "resolving"].includes(state.phase);
  const confirming = state.phase === "confirm-new";
  const refreshFailed =
    state.phase === "committed-refresh-error" ||
    state.phase === "closed-refresh-error";
  const old = state.pending;
  return (
    <div className={workspaceStyles.workspace} role="region" aria-label="Xử lý đơn Buyer">
      <button
        type="button"
        disabled={busy || confirming || state.phase === "blocked"}
        onClick={() => void flow.reload()}
      >
        {refreshFailed ? "Tải lại đơn" : "Làm mới chi tiết đơn"}
      </button>
      {state.phase === "error" && (
        <p role="alert">
          Chưa tải được đơn hoặc bạn không có quyền truy cập. Thử tải lại; chưa
          gửi thao tác.
        </p>
      )}
      {state.phase === "blocked" && (
        <p role="alert">
          Không thể xác minh phiên hoặc bộ nhớ yêu cầu. Thao tác bị khóa; không
          tự xóa mã chờ.
        </p>
      )}
      {state.phase === "sending" && (
        <p role="status">
          Đang gửi yêu cầu. Mất phản hồi không chứng minh server chưa xử lý.
        </p>
      )}
      {state.phase === "ready" && state.outcome && (
        <p role="status">
          {state.outcome === "committed"
            ? "Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh."
            : "Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn. Đóng mã không phải hủy hoặc hoàn tất đơn."}
        </p>
      )}
      {refreshFailed && (
        <p role="alert">
          {state.outcome === "committed"
            ? "Đã xác minh biên nhận."
            : "Đã đóng mã chưa thực hiện."}{" "}
          Chưa tải lại được đơn. Chỉ tải lại dữ liệu, không gửi lại lệnh.
        </p>
      )}
      {state.order && !["ready", "confirm-new"].includes(state.phase) && (
        <p role="status" className={workspaceStyles.stale}>
          Chi tiết bên dưới là lần đọc trước, chưa phải trạng thái mới nhất.
          Không dùng trạng thái cũ để gửi lại lệnh.
        </p>
      )}
      {(state.order || state.phase === "loading") && (
        <OrderDetailPanel
          source="api"
          readKey={flow.readKey()}
          showActions={false}
          state={
            state.order
              ? { status: "ready", data: state.order }
              : state.phase === "loading"
                ? { status: "loading" }
                : { status: "idle" }
          }
          context={{
            scope: "buyer",
            user,
            fresh: state.phase === "ready",
            busy:
              busy || confirming || refreshFailed || state.phase === "blocked",
            outcomeUnknown: !!old,
          }}
        />
      )}
      {state.phase === "ready" && state.order && !old && (
        <section className={styles.panel} aria-label="Thao tác Buyer">
          {buyerCanChoose(state.order, "cancel") && (
            <button
              type="button"
              onClick={() => {
                try {
                  flow.choose("cancel");
                } catch {
                  /* Stale view never dispatches. */
                }
              }}
            >
              Hủy đơn
            </button>
          )}
          {buyerCanChoose(state.order, "complete") && (
            <button
              type="button"
              onClick={() => {
                try {
                  flow.choose("complete");
                } catch {
                  /* Stale view never dispatches. */
                }
              }}
            >
              Xác nhận đã nhận hàng
            </button>
          )}
          {!buyerCanChoose(state.order, "cancel") &&
            !buyerCanChoose(state.order, "complete") && (
              <p>
                Không có thao tác hủy/hoàn tất phù hợp với trạng thái hiện tại.
              </p>
            )}
        </section>
      )}
      {confirming && state.command && state.order && (
        <BuyerCommandReview
          connected
          integrated
          session={session}
          binding={{
            actorId: session.actor.id,
            sessionVersion: session.version,
            readKey: flow.readKey(),
          }}
          order={state.order}
          command={state.command}
          phase="confirm-new"
          fresh
          pending="clear"
          onConfirm={flow.execute}
          onDismiss={flow.cancelConfirmation}
        />
      )}
      {old && (
        <p role="alert">
          Chưa rõ kết quả trước. Giữ mã yêu cầu cũ; không gửi lệnh mới.
          {old.orderId !== orderId && (
            <>
              {" "}
              <Link to={`/account/orders/${old.orderId}`}>
                Đối chiếu đơn {old.orderId}
              </Link>{" "}
              trước thao tác mới.
            </>
          )}
        </p>
      )}
      {old &&
        old.orderId === orderId &&
        state.order &&
        ["unknown", "resolving"].includes(state.phase) &&
        (old.schemaVersion === 2 ? (
          <BuyerRecoveryConsent
            connected
            session={session}
            intent={old}
            phase={
              state.phase === "resolving" ? "resolving" : "confirm-resolution"
            }
            onResolve={flow.resolve}
          />
        ) : (
          <LegacyConsent
            key={old.idempotencyKey}
            intent={old}
            busy={state.phase === "resolving"}
            onResolve={flow.resolve}
          />
        ))}
    </div>
  );
}
/** V1 complete has an unambiguous empty body; upgrade only after consent inside
 * the merged runtime. Never invent a reason/hash for a legacy cancellation. */
function LegacyConsent({
  intent,
  busy,
  onResolve,
}: {
  intent: LegacyBuyerIntent;
  busy: boolean;
  onResolve: (intent: LegacyBuyerIntent) => Promise<void>;
}) {
  const [consent, setConsent] = useState(false),
    [submitted, setSubmitted] = useState(false),
    latch = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <section className={styles.panel} aria-label="Đối chiếu yêu cầu Buyer cũ">
      <h2>Yêu cầu hoàn tất cũ đang chờ</h2>
      <p>
        Chỉ đối chiếu mã cũ; không tự xác nhận đã nhận hàng. Nếu chưa thực hiện,
        server có thể đóng mã.
      </p>
      <label>
        <input
          type="checkbox"
          checked={consent}
          disabled={busy || submitted}
          onChange={(e) => setConsent(e.target.checked)}
        />{" "}
        Tôi đồng ý đối chiếu và đóng mã chưa thực hiện, không gửi lệnh hoàn tất
        mới.
      </label>
      <button
        type="button"
        disabled={!consent || busy || submitted}
        onClick={() => {
          if (latch.current || !consent || busy) return;
          latch.current = true;
          setSubmitted(true);
          void onResolve(intent)
            .catch(() => {})
            .finally(() => {
              if (mounted.current) {
                latch.current = false;
                setConsent(false);
                setSubmitted(false);
              }
            });
        }}
      >
        Đối chiếu / dừng yêu cầu cũ
      </button>
    </section>
  );
}
