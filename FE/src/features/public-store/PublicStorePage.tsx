import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ProductCard } from "../../components/ProductCard/ProductCard";
import { readStorePage, type PublicStorePageData } from "./publicStoreApi";
import styles from "../../pages/Marketplace.module.css";
import storeStyles from "./PublicStorePage.module.css";
export function PublicStorePage() {
  const raw = useParams().storeId;
  if (!raw || !/^[1-9][0-9]{0,9}$/.test(raw) || Number(raw) > 2147483647)
    return <p role="alert">Mã cửa hàng không hợp lệ.</p>;
  return <Storefront key={raw} storeId={Number(raw)} />;
}
function Storefront({ storeId }: { storeId: number }) {
  const [data, setData] = useState<PublicStorePageData | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const ticket = useRef(0),
    mounted = useRef(false),
    latch = useRef(false),
    flight = useRef<AbortController | null>(null);
  const load = useCallback(
    async (afterId?: number) => {
      if (latch.current) return;
      latch.current = true;
      setBusy(true);
      setError("");
      const n = ++ticket.current,
        c = new AbortController();
      flight.current?.abort();
      flight.current = c;
      try {
        const next = await readStorePage(storeId, afterId, c.signal);
        if (mounted.current && n === ticket.current)
          setData((prev) => ({
            ...next,
            items:
              afterId && prev ? [...prev.items, ...next.items] : next.items,
          }));
      } catch (e) {
        if (mounted.current && n === ticket.current) {
          setData(null);
          setError(e instanceof Error ? e.message : "Chưa tải được cửa hàng.");
        }
      } finally {
        if (mounted.current && n === ticket.current) {
          latch.current = false;
          setBusy(false);
        }
      }
    },
    [storeId],
  );
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      ticket.current++;
      latch.current = false;
      flight.current?.abort();
    };
  }, [load]);
  return (
    <section className={styles.page} aria-label="Cửa hàng công khai">
      <nav aria-label="Đường dẫn" className={storeStyles.crumbs}>
        <Link to="/">Trang chủ</Link> <span aria-hidden="true">›</span> Cửa hàng
      </nav>
      {busy && <p role="status">Đang tải cửa hàng…</p>}
      {error && (
        <div role="alert" className={styles.error}>
          {error}{" "}
          <button onClick={() => void load()} disabled={busy}>
            Thử tải lại cửa hàng
          </button>
        </div>
      )}
      {data && (
        <>
          <header className={`${styles.panel} ${storeStyles.profile}`}>
            <span className={storeStyles.avatar} aria-hidden="true">
              {data.store.name.trim().slice(0, 1).toUpperCase()}
            </span>
            <div className={storeStyles.info}>
              <h1>{data.store.name}</h1>
              <p>{data.store.description || "Cửa hàng chưa thêm giới thiệu."}</p>
            </div>
            {import.meta.env.VITE_CHAT_ENABLED === "true" && (
              <Link className={storeStyles.chat} to={`/messages?storeId=${storeId}`}>
                Chat với cửa hàng
              </Link>
            )}
          </header>
          <h2>Sản phẩm của cửa hàng</h2>
          {!data.items.length && !busy && (
            <p className={styles.empty}>
              {data.nextCursor
                ? "Chưa có sản phẩm phù hợp trong trang này."
                : "Cửa hàng chưa có sản phẩm đang bán công khai."}
            </p>
          )}
          <div className={`${styles.grid} ${storeStyles.catalog}`}>
            {data.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          {data.nextCursor !== null && (
            <button disabled={busy} onClick={() => void load(data.nextCursor!)}>
              Tải thêm sản phẩm
            </button>
          )}
        </>
      )}
    </section>
  );
}
