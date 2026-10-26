import { useEffect, useRef, useState } from "react";
import { readPublic, type PublicPage } from "./reviewClient";
import styles from "./ReviewPage.module.css";
export function PublicProductReviews({ productId }: { productId: number }) {
  return <Reviews key={productId} productId={productId} />;
}
function Reviews({ productId }: { productId: number }) {
  const [data, setData] = useState<PublicPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    latch = useRef(false),
    active = useRef(false),
    ctl = useRef<AbortController | null>(null),
    generation = useRef(0);
  async function load(before?: number) {
    if (latch.current || !active.current) return;
    latch.current = true;
    setBusy(true);
    setError("");
    const turn = ++generation.current,
      controller = new AbortController();
    ctl.current = controller;
    try {
      const page = await readPublic(
        productId,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        before,
      );
      if (!active.current || turn !== generation.current) return;
      setData((old) =>
        before && old
          ? {
              ...page,
              items: [
                ...old.items,
                ...page.items.filter(
                  (x) => !old.items.some((r) => r.id === x.id),
                ),
              ],
            }
          : page,
      );
    } catch (e) {
      if (active.current && turn === generation.current) {
        setData(null);
        setError(e instanceof Error ? e.message : "Không tải được đánh giá.");
      }
    } finally {
      if (active.current && turn === generation.current) {
        latch.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    active.current = true;
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      active.current = false;
      window.clearTimeout(timer);
      ctl.current?.abort();
      generation.current++;
      latch.current = false;
    };
    // Component is keyed by productId; late requests cannot cross products.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  return (
    <section
      className={styles.panel}
      aria-label="Đánh giá sản phẩm"
      aria-busy={busy}
    >
      <h2>Đánh giá từ người mua</h2>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => void load()}>
        Tải lại đánh giá sản phẩm
      </button>
      {!data && !error && <p>Đang tải đánh giá…</p>}
      {data && (
        <>
          <p className={styles.score}>
            {data.average === null
              ? "Chưa có đánh giá"
              : `${data.average}/5 từ ${data.count} đánh giá`}
          </p>
          <ul className={styles.histogram}>
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n}>
                {n} sao · {data.counts[n]}
              </li>
            ))}
          </ul>
          {data.items.map((r) => (
            <article className={styles.review} key={r.id}>
              <strong>
                {r.author} · {r.rating}/5
              </strong>
              <p className={styles.body}>{r.body}</p>
              <time>{new Date(r.createdAt).toLocaleDateString("vi-VN")}</time>
              {r.isRefunded && <p>Giao dịch đã có hoàn tiền</p>}
              {r.reply && (
                <blockquote>
                  <strong>Phản hồi từ cửa hàng</strong>
                  <p className={styles.body}>{r.reply.body}</p>
                </blockquote>
              )}
            </article>
          ))}
          {data.nextBeforeId && (
            <button
              disabled={busy}
              onClick={() => void load(data.nextBeforeId!)}
            >
              Xem thêm đánh giá
            </button>
          )}
        </>
      )}
    </section>
  );
}
