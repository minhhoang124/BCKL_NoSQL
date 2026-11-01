import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { hasBuyerAccess } from "../../utils/buyerAccess";
import { getAuthSessionVersion } from "../../services/apiClient";
import { validOrderId } from "../../services/orderResponse";
import {
  ORDER_STATUSES,
  type OrderScope,
  type OrderStatus,
} from "../../types/order";
import { OrderDetailPanel, OrderListPanel } from "./OrderPanels";
import { orderStatusLabels } from "./orderPolicy";
import { useOrderDetail, useOrderList } from "./useOrderRead";
import styles from "./OrderReadPages.module.css";
import { SellerOrderWorkspace } from "../order-recovery/SellerOrderWorkspace";
import { BuyerOrderWorkspace } from "../order-recovery/BuyerOrderWorkspace";
import { VnpayPayment } from '../vnpay/VnpayPayment';

const base = (scope: OrderScope) =>
  scope === "buyer" ? "/account/orders" : "/seller/orders";
function pathId(value: string | undefined) {
  return value && /^[1-9]\d{0,9}$/.test(value) && validOrderId(Number(value))
    ? Number(value)
    : null;
}
/** Production Order routes; explicit false flags retain read-only fallbacks. */
export function OrderReadPage({
  scope,
  detail = false,
}: {
  scope: OrderScope;
  detail?: boolean;
}) {
  const { user, loading } = useAuth();
  const { orderId } = useParams();
  const [params] = useSearchParams();
  if (loading) return <p role="status">Đang xác minh phiên…</p>;
  if (
    !user?.isActive ||
    (scope === "buyer" ? !hasBuyerAccess(user) : user.role !== "SELLER")
  )
    return (
      <p role="alert">
        Cần tài khoản đang hoạt động và đúng vai trò để xem đơn.
      </p>
    );
  const key = `${getAuthSessionVersion()}:${user.id}:${scope}:${orderId ?? ""}:${params.toString()}`;
  if (detail && pathId(orderId) === null)
    return (
      <div className={styles.page}>
        <p role="alert">Mã đơn hàng không hợp lệ.</p>
        <Link to={base(scope)}>Về danh sách đơn</Link>
      </div>
    );
  return (
    <div className={styles.page}>
      <nav aria-label="Điều hướng đơn hàng">
        <Link to={scope === "buyer" ? "/account" : "/seller"}>
          {scope === "buyer" ? "Tài khoản" : "Kênh người bán"}
        </Link>
        {" · "}
        <Link to={base(scope)}>Danh sách đơn</Link>
      </nav>
      {detail &&
        import.meta.env.VITE_CHAT_ENABLED === "true" &&
        import.meta.env.VITE_CHAT_ORDER_CONTEXT_ENABLED === "true" && (
          <Link to={`/messages?orderId=${pathId(orderId)}&orderScope=${scope}`}>
            Trao đổi về đơn hàng
          </Link>
        )}
      <p className={styles.scopeIntro}>
        {scope === "seller" &&
        detail &&
        import.meta.env.VITE_SELLER_ORDER_COMMANDS_ENABLED !== "false"
          ? "Xử lý đơn đã nhận; mỗi bước cần xác nhận riêng, không tự gửi lại yêu cầu."
          : scope === "buyer" &&
              detail &&
              import.meta.env.VITE_BUYER_ORDER_COMMANDS_ENABLED !== "false"
            ? "Xem đơn đã lưu; hủy hoặc hoàn tất hợp lệ cần xác nhận riêng, không tự gửi lại yêu cầu."
            : "Chỉ xem đơn và lịch sử; các thao tác xử lý đơn chưa được bật trên màn này."}
      </p>
      <div
        className={
          !detail && scope === "buyer" ? styles.accountGrid : undefined
        }
      >
        {!detail && scope === "buyer" && (
          <aside
            className={styles.accountSidebar}
            aria-label="Tài khoản mua hàng"
          >
            <h2>Tài khoản</h2>
            <strong>{user.fullName ?? "Tài khoản của bạn"}</strong>
            <p>{user.email}</p>
            <nav aria-label="Điều hướng tài khoản">
              <Link to="/account">Hồ sơ của tôi</Link>
              <Link to="/account/addresses">Sổ địa chỉ</Link>
              <Link to="/account/orders" aria-current="page">
                Đơn mua
              </Link>
            </nav>
          </aside>
        )}
        <div className={styles.content}>
          {detail ? (
            scope === "seller" &&
            import.meta.env.VITE_SELLER_ORDER_COMMANDS_ENABLED !== "false" ? (
              <SellerOrderWorkspace key={key} orderId={pathId(orderId)!} />
            ) : scope === "buyer" &&
              import.meta.env.VITE_BUYER_ORDER_COMMANDS_ENABLED !== "false" ? (
              <BuyerOrderWorkspace key={key} orderId={pathId(orderId)!} />
            ) : (
              <Detail key={key} scope={scope} orderId={pathId(orderId)!} />
            )
          ) : (
            <List key={key} scope={scope} />
          )}
        </div>
      </div>
    </div>
  );
}

function List({ scope }: { scope: OrderScope }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get("status");
  const after = params.get("afterId");
  // Validate URL before mounting the component which can issue HTTP.
  const invalid =
    Array.from(params.keys()).some((k) => !["status", "afterId"].includes(k)) ||
    params.getAll("status").length > 1 ||
    params.getAll("afterId").length > 1 ||
    (status !== null && !ORDER_STATUSES.includes(status as OrderStatus)) ||
    (after !== null && pathId(after) === null);
  if (invalid)
    return (
      <>
        <p role="alert">Bộ lọc hoặc mốc trang không hợp lệ.</p>
        <button onClick={() => setParams({})}>Về trang đầu</button>
      </>
    );
  return (
    <>
      <nav className={styles.statusTabStrip} aria-label="Lọc nhanh theo trạng thái">
        <button
          type="button"
          aria-pressed={!status}
          onClick={() => setParams({})}
          className={!status ? `${styles.statusTab} ${styles.statusTabActive}` : styles.statusTab}
        >
          Tất cả
        </button>
        {ORDER_STATUSES.map((s) => (
          <button
            type="button"
            key={s}
            aria-pressed={status === s}
            onClick={() => setParams({ status: s })}
            className={
              status === s
                ? `${styles.statusTab} ${styles.statusTabActive}`
                : styles.statusTab
            }
          >
            {orderStatusLabels[s]}
          </button>
        ))}
      </nav>
      <div className={styles.filterToolbar}>
        <label>
          Trạng thái đơn
          <select
            value={status ?? ""}
            onChange={(event) =>
              setParams(event.target.value ? { status: event.target.value } : {})
            }
          >
            <option value="">Tất cả trạng thái</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {orderStatusLabels[s]}
              </option>
            ))}
          </select>
        </label>
        {after !== null && (
          <button onClick={() => setParams(status ? { status } : {})}>
            Về trang đầu
          </button>
        )}
      </div>
      <ListData
        scope={scope}
        status={status as OrderStatus | null}
        afterId={after === null ? undefined : Number(after)}
        onSelect={(id) => navigate(`${base(scope)}/${id}`)}
        onNext={(id) =>
          setParams(
            status ? { status, afterId: String(id) } : { afterId: String(id) },
          )
        }
      />
    </>
  );
}

function ListData({
  scope,
  status,
  afterId,
  onSelect,
  onNext,
}: {
  scope: OrderScope;
  status: OrderStatus | null;
  afterId?: number;
  onSelect: (id: number) => void;
  onNext: (id: number) => void;
}) {
  const { state, reload } = useOrderList(scope, {
    limit: 20,
    status: status ?? undefined,
    afterId,
  });
  return (
    <>
      <button disabled={state.status === "loading"} onClick={reload}>
        Làm mới trang đơn
      </button>
      <OrderListPanel
        scope={scope}
        source="api"
        state={state}
        onRetry={reload}
        onSelect={onSelect}
        onNextPage={onNext}
      />
    </>
  );
}

function Detail({ scope, orderId }: { scope: OrderScope; orderId: number }) {
  const { user } = useAuth();
  const { state, reload, readKey } = useOrderDetail(scope, orderId);
  return (
    <>
      {scope==='buyer'&&state.status==='ready'&&state.data.payment?.provider==='VNPAY'&&<VnpayPayment orderId={orderId} amount={state.data.total}/>}
      <button disabled={state.status === "loading"} onClick={reload}>
        Làm mới chi tiết đơn
      </button>
      <OrderDetailPanel
        state={state}
        source="api"
        readKey={readKey}
        onRetry={reload}
        context={{
          scope,
          user,
          fresh: state.status === "ready",
          busy: false,
          outcomeUnknown: false,
        }}
      />
    </>
  );
}
