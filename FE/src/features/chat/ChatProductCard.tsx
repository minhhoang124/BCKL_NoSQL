import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchApi } from "../../services/apiClient";
import { parseChatProduct, type Card } from "./chatProductProjection";
import styles from "./ChatPage.module.css";

export function ChatProductCard({
  productId,
  storeId,
}: {
  productId: number;
  storeId: number;
}) {
  return (
    <BoundCard
      key={`${productId}:${storeId}`}
      productId={productId}
      storeId={storeId}
    />
  );
}
function BoundCard({
  productId,
  storeId,
}: {
  productId: number;
  storeId: number;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true,
      busy = false;
    const controller = new AbortController();
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const raw = await fetchApi<unknown>(`/products/${productId}`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        const result = parseChatProduct(raw, productId, storeId);
        if (current) setCard(result);
      } catch {
        if (current) setCard(null);
      } finally {
        busy = false;
        if (current) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      current = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [productId, storeId]);
  if (!card)
    return (
      <p>
        {loading
          ? "Đang tải sản phẩm…"
          : "Sản phẩm không còn khả dụng hoặc chưa tải được."}
      </p>
    );
  return (
    <article
      aria-label={`Sản phẩm ${productId}`}
      className={styles.productCard}
    >
      {card.image && (
        <img src={card.image} alt="" width={80} height={80} loading="lazy" />
      )}
      <div>
        <Link to={`/products/${productId}`}>{card.name}</Link>
        {card.price && (
          <p>{card.price} ₫ · Giá hiện tại, không phải giá đặt hàng</p>
        )}
      </div>
    </article>
  );
}
