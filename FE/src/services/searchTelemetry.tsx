import { useEffect, useRef } from "react";
import type { Product } from "../types/marketplace";
import { ProductCard } from "../components/ProductCard/ProductCard";
import { sendSearchEvent } from "./searchAnalyticsClient";

export function SearchResultCard({
  product,
  token,
}: {
  product: Product;
  token?: string;
}) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!token || !node.current || typeof IntersectionObserver === "undefined")
      return;
    let sent = false,
      visible = false;
    const acknowledge = () => {
      if (!sent && visible && document.visibilityState === "visible") {
        sent = true;
        sendSearchEvent(token, product.id, "IMPRESSION");
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        acknowledge();
      },
      { threshold: 0 },
    );
    observer.observe(node.current);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [token, product.id]);
  return (
    <div
      ref={node}
      onClick={(e) => {
        if (token && (e.target as Element).closest("a"))
          sendSearchEvent(token, product.id, "CLICK");
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && token && (e.target as Element).closest("a"))
          sendSearchEvent(token, product.id, "CLICK");
      }}
    >
      <ProductCard product={product} />
    </div>
  );
}
