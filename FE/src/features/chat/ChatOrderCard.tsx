import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { chatApi, type OrderCard } from "./chatApi";
import { getAuthSessionVersion } from "../../services/apiClient";
import { orderStatusLabels } from "../order-readiness/orderPolicy";
import styles from "./ChatPage.module.css";

export function ChatOrderCard(props: {
  conversationId: number;
  messageId: number;
  orderId: number;
  storeId: number;
}) {
  return (
    <BoundCard
      key={`${getAuthSessionVersion()}:${props.conversationId}:${props.messageId}:${props.orderId}:${props.storeId}`}
      {...props}
    />
  );
}
function BoundCard({
  conversationId,
  messageId,
  orderId,
  storeId,
}: {
  conversationId: number;
  messageId: number;
  orderId: number;
  storeId: number;
}) {
  const [card, setCard] = useState<OrderCard | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true,
      busy = false,
      revoked = false;
    const session = getAuthSessionVersion(),
      controller = new AbortController();
    const current = () => live && session === getAuthSessionVersion();
    const load = async () => {
      if (!live) return;
      if (session !== getAuthSessionVersion()) {
        revoked = true;
        setCard(null);
        setLoading(false);
        return;
      }
      if (busy || revoked) return;
      busy = true;
      try {
        const result = await chatApi.orderCard(
          conversationId,
          messageId,
          orderId,
          storeId,
          controller.signal,
        );
        if (current()) setCard(result);
        else if (live) setCard(null);
      } catch (error) {
        if (live) setCard(null);
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          [401, 403, 404].includes(Number(error.status))
        )
          revoked = true;
      } finally {
        busy = false;
        if (live) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [conversationId, messageId, orderId, storeId]);
  if (!card)
    return (
      <p>
        {loading
          ? "Đang tải đơn hàng…"
          : "Đơn hàng không còn khả dụng hoặc chưa tải được."}
      </p>
    );
  return (
    <article aria-label={`Đơn hàng ${orderId}`} className={styles.orderCard}>
      <div>
        <Link
          to={`${card.viewer === "BUYER" ? "/account" : "/seller"}/orders/${orderId}`}
        >
          Đơn {card.orderNumber}
        </Link>
        <p>
          {orderStatusLabels[card.status]} · {card.total} ₫
        </p>
        <ul>
          {card.items.map((item, index) => (
            <li key={index}>
              {item.name} × {item.quantity}
            </li>
          ))}
        </ul>
        {card.lineCount > card.items.length && (
          <p>Còn {card.lineCount - card.items.length} dòng hàng khác</p>
        )}
        <small>
          Tên hàng và tổng tiền lúc đặt; trạng thái hiện tại. Không kèm thông
          tin giao nhận.
        </small>
      </div>
    </article>
  );
}
