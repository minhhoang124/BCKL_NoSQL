import { useRef, useState } from "react";
import { Link } from 'react-router-dom';
import type {
  OrderDetail,
  OrderList,
  OrderReadState,
  OrderScope,
  PreparationCommand,
} from "../../types/order";
import {
  orderActions,
  orderMoney,
  orderStatusLabels,
  type OrderActionContext,
} from "./orderPolicy";
import styles from "./OrderPanels.module.css";

type Source = "fixture" | "api";
type ActionHandler = (action: PreparationCommand) => void | Promise<void>;
function Evidence({ source }: { source: Source }) {
  return (
    <p className={styles.notice}>
      {source === "fixture"
        ? "DỮ LIỆU MẪU — chưa tích hợp giao dịch thật."
        : "Dữ liệu đọc từ API — chưa nghiệm thu toàn luồng Order Web."}
    </p>
  );
}
function ReadFeedback({
  state,
  onRetry,
}: {
  state: Exclude<OrderReadState<unknown>, { status: "ready" }>;
  onRetry?: () => void;
}) {
  return (
    <div role={state.status === "error" ? "alert" : "status"}>
      <p>
        {state.status === "idle"
          ? "Cần đăng nhập bằng đúng tài khoản để xem đơn."
          : state.status === "loading"
            ? "Đang tải đơn hàng…"
            : state.message}
      </p>
      {state.status === "error" && onRetry && (
        <button type="button" onClick={onRetry}>
          Tải lại đơn
        </button>
      )}
    </div>
  );
}
export function OrderListPanel({
  state,
  scope,
  source,
  onRetry,
  onSelect,
  onNextPage,
}: {
  state: OrderReadState<OrderList>;
  scope: OrderScope;
  source: Source;
  onRetry?: () => void;
  onSelect: (id: number) => void;
  onNextPage?: (afterId: number) => void;
}) {
  return (
    <section
      className={styles.panel}
      aria-label={scope === "buyer" ? "Đơn mua" : "Đơn của Store"}
      aria-busy={state.status === "loading"}
    >
      <h1>{scope === "buyer" ? "Đơn mua của tôi" : "Đơn hàng của cửa hàng"}</h1>
      <Evidence source={source} />
      {state.status !== "ready" ? (
        <ReadFeedback state={state} onRetry={onRetry} />
      ) : (
        <>
          {state.data.items.length === 0 && (
            <p role="status">Chưa có đơn trong bộ lọc này.</p>
          )}
          <ul className={styles.list}>
            {state.data.items.map((order) => (
              <li key={order.id} className={styles.card}>
                <h2>{order.orderNumber}</h2>
                <p className={styles.status}>
                  {order.store.name} · {orderStatusLabels[order.status]}
                </p>
                <p className={styles.total}>
                  {orderMoney(order.total)} ·{" "}
                  {order.payment
                    ? `${order.payment.provider} — ${order.payment.status}`
                    : "Chưa có dữ liệu thanh toán"}
                </p>
                <button type="button" onClick={() => onSelect(order.id)}>
                  Xem chi tiết {order.orderNumber}
                </button>
              </li>
            ))}
          </ul>
          {state.data.nextCursor !== null && onNextPage && (
            <button
              type="button"
              onClick={() => onNextPage(state.data.nextCursor!)}
            >
              Trang tiếp theo
            </button>
          )}
        </>
      )}
    </section>
  );
}
function Actions({
  order,
  context,
  readKey,
  onAction,
}: {
  order: OrderDetail;
  context: OrderActionContext;
  readKey: string;
  onAction?: ActionHandler;
}) {
  const latch = useRef<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const locked = submitted === readKey;
  const actions = orderActions(order, {
    ...context,
    busy: context.busy || locked,
  });
  return (
    <section aria-label="Thao tác đơn" aria-busy={context.busy || locked}>
      {context.store?.status === "SUSPENDED" && context.scope === "seller" && (
        <p>Store tạm khóa: chỉ xử lý đơn cũ, không mở bán mới.</p>
      )}
      {context.outcomeUnknown && (
        <p role="status">
          Chưa rõ kết quả trước. Giữ mã yêu cầu cũ để đối chiếu, không tạo lệnh
          mới.
        </p>
      )}
      {!context.fresh && (
        <p role="status">Cần tải lại trạng thái đơn trước khi thao tác.</p>
      )}
      {locked && (
        <p role="status">
          Đã chuyển yêu cầu. Cần đọc lại đơn để đối chiếu, chưa tự đổi trạng
          thái.
        </p>
      )}
      {dispatchError?.key === readKey && locked && (
        <p role="alert">{dispatchError.message}</p>
      )}
      {actions.map((action) => (
        <div key={action.id}>
          <button
            type="button"
            disabled={!action.enabled || !onAction}
            onClick={() => {
              if (!action.enabled || !onAction || latch.current === readKey)
                return;
              if (
                !["confirm", "start-packing", "ready-to-ship"].includes(
                  action.id,
                )
              )
                return;
              latch.current = readKey;
              setSubmitted(readKey);
              setDispatchError(null);
              const failed = () => {
                if (latch.current !== readKey) return;
                setDispatchError({
                  key: readKey,
                  message:
                    "Chưa xác định được kết quả. Giữ yêu cầu cũ, không bấm tạo lệnh mới.",
                });
              };
              try {
                void Promise.resolve(
                  onAction(action.id as PreparationCommand),
                ).catch(failed);
              } catch {
                failed();
              }
            }}
          >
            {action.label}
          </button>
          <p className={styles.hint}>
            {action.reason ??
              (!onAction ? "Panel chuẩn bị; chưa nối API thao tác." : "")}
          </p>
        </div>
      ))}
      {actions.length === 0 && (
        <p>
          Không có thao tác phù hợp ở trạng thái này. Seller không tự xác nhận
          giao thành công.
        </p>
      )}
    </section>
  );
}
export function OrderDetailPanel({
  state,
  source,
  context,
  readKey,
  onRetry,
  onAction,
  showActions = true,
}: {
  state: OrderReadState<OrderDetail>;
  source: Source;
  context: OrderActionContext;
  readKey: string;
  onRetry?: () => void;
  onAction?: ActionHandler;
  showActions?: boolean;
}) {
  if (state.status !== "ready")
    return (
      <section className={styles.panel} aria-busy={state.status === "loading"}>
        <Evidence source={source} />
        <ReadFeedback state={state} onRetry={onRetry} />
      </section>
    );
  const order = state.data,
    address = order.shippingAddress;
  return (
    <section className={styles.panel} aria-label="Chi tiết đơn hàng">
      <h1>{order.orderNumber}</h1>
      <Evidence source={source} />
      <p className={styles.status}>
        {orderStatusLabels[order.status]} · {order.store.name}
      </p>
      <section className={styles.card} aria-label="Lịch sử đơn">
        <h2>Lịch sử đơn</h2>
        <ol className={styles.timeline}>
          {order.timeline.map((event, index) => (
            <li key={`${event.createdAt}:${index}`}>
              <strong>{orderStatusLabels[event.toStatus]}</strong>
              <p>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString("vi-VN")}
                </time>
              </p>
              <p>{event.actorType ?? "Chưa rõ người thực hiện"}</p>
              {event.reasonText && <p>{event.reasonText}</p>}
              {event.deliveryAttempt !== null && (
                <p>
                  Lần giao {event.deliveryAttempt} ·{" "}
                  {event.trackingReference ?? "Chưa có vận đơn"}
                </p>
              )}
            </li>
          ))}
        </ol>
        {order.cancellation && (
          <p>
            Lý do hủy:{" "}
            {order.cancellation.reasonText ?? "Chưa có dữ liệu lịch sử"}
          </p>
        )}
      </section>
      <div className={styles.detailGrid}>
        <section className={styles.card} aria-label="Địa chỉ nhận hàng">
          <h2>Địa chỉ nhận hàng</h2>
          <p>
            {address.recipientName} · {address.phone}
          </p>
          <p>
            {[
              address.addressLine,
              address.ward,
              address.district,
              address.province,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
          {address.deliveryNote && <p>Ghi chú: {address.deliveryNote}</p>}
        </section>
        <section className={styles.card} aria-label="Thanh toán">
          <h2>Thanh toán</h2>
          <p>
            {order.payment
              ? `Thanh toán ${order.payment.provider}: ${order.payment.status}`
              : "Chưa có dữ liệu thanh toán — không tự suy đoán COD."}
          </p>
          <p>Số tiền đã lưu: {orderMoney(order.total)}</p>
        </section>
      </div>
      <section className={styles.card} aria-label="Sản phẩm trong đơn">
        <h2>Sản phẩm trong đơn</h2>
        <div className={styles.itemsGrid}>
          <ul className={styles.list}>
            {order.items.map((item) => (
              <li key={item.id}>
                <h3>{item.productName}</h3>
                <p>
                  SKU {item.sku} · {item.options.join(" / ")} · Số lượng{" "}
                  {item.quantity}
                </p>
                <p>
                  {orderMoney(item.unitPrice)} / món ·{" "}
                  {orderMoney(item.lineTotal)}
                </p>
                {context.scope === 'buyer' && context.fresh && !context.busy && !context.outcomeUnknown && source === 'api' && ['DELIVERED', 'COMPLETED'].includes(order.status) && order.payment?.status === 'PAID' && import.meta.env.VITE_AFTERSALES_ENABLED !== 'false' && <Link to={`/account/aftersales?orderId=${order.id}&itemId=${item.id}`}>Yêu cầu hỗ trợ cho mặt hàng này</Link>}
              </li>
            ))}
          </ul>
          <div className={styles.summary}>
            <p>Tiền hàng: {orderMoney(order.subtotal)}</p>
            <p>Phí giao mô phỏng: {orderMoney(order.shippingFee)}</p>
            <p>Giảm giá đã lưu: {orderMoney(order.discountTotal)}</p>
            <strong className={styles.total}>
              Tổng đã lưu: {orderMoney(order.total)}
            </strong>
          </div>
        </div>
      </section>
      {showActions && <Actions
        key={`${order.id}:${context.user?.id}:${context.scope}`}
        order={order}
        context={context}
        readKey={readKey}
        onAction={onAction}
      />}
    </section>
  );
}
