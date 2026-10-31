import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { hasBuyerAccess } from "../../utils/buyerAccess";
import { cartApi } from "../../services/cartApi";
import { getAuthSessionVersion } from "../../services/apiClient";
import { formatPrice } from "../../services/marketplaceApi";
import type { Product } from "../../types/marketplace";
import styles from "../../pages/Marketplace.module.css";

export function ProductPurchase({ product }: { product: Product }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p role="status">Đang kiểm tra phiên…</p>;
  if (!user)
    return (
      <p className={styles.loginPromptBar}>
        <Link to="/login" state={{ from: location }}>Đăng nhập để chọn mua</Link>
      </p>
    );
  if (!hasBuyerAccess(user))
    return <p>Tài khoản này chưa có quyền mua hàng.</p>;
  return (
    <Purchase
      key={`${user.id}:${product.id}:${getAuthSessionVersion()}`}
      product={product}
    />
  );
}
function Purchase({ product }: { product: Product }) {
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const groups = product.optionGroups ?? [];
  const ids = groups.map((g) => Number(choices[g.id]));
  const complete = ids.every((id) => Number.isSafeInteger(id) && id > 0);
  const selected = groups.length
    ? complete
      ? product.variants.find(
          (v) =>
            v.optionValueIds?.length === ids.length &&
            ids.every((id) => v.optionValueIds?.includes(id)),
        )
      : undefined
    : product.variants[0];
  const count = Number(quantity);
  const canBuy =
    selected?.inStock === true && Number.isSafeInteger(count) && count > 0;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !selected || !canBuy) return;
    pending.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    const session = getAuthSessionVersion();
    try {
      await cartApi.put(selected.id, count);
      if (active.current && session === getAuthSessionVersion())
        setNotice(`Đã lưu số lượng ${count} vào giỏ.`);
    } catch {
      if (active.current && session === getAuthSessionVersion())
        setError(
          "Chưa xác nhận được thay đổi. Hãy kiểm tra giỏ hàng trước khi thử lại; giá hoặc tồn kho có thể đã thay đổi.",
        );
    } finally {
      if (active.current && session === getAuthSessionVersion()) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className={styles.panel} aria-label="Chọn mua sản phẩm">
      <h2>Chọn phân loại và số lượng</h2>
      <form className={styles.form} onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy}>
          {groups.map((g) => (
            <div key={g.id} className={styles.optionGroupBlock}>
              <label>
                {g.name} muốn mua
                <select
                  aria-label={`${g.name} muốn mua`}
                  required
                  value={choices[g.id] ?? ""}
                  onChange={(e) => {
                    setChoices((old) => ({ ...old, [g.id]: e.target.value }));
                    setNotice("");
                    setError("");
                  }}
                >
                  <option value="">Chọn {g.name}</option>
                  {g.values.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.value}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.swatchList} aria-hidden="true">
                {g.values.map((v) => {
                  const isSelected = choices[g.id] === String(v.id);
                  return (
                    <span
                      key={v.id}
                      onClick={() => {
                        if (busy) return;
                        setChoices((old) => ({
                          ...old,
                          [g.id]: String(v.id),
                        }));
                        setNotice("");
                        setError("");
                      }}
                      className={
                        isSelected
                          ? `${styles.swatchChip} ${styles.swatchChipActive}`
                          : styles.swatchChip
                      }
                    >
                      {v.value}
                      {isSelected && <i className={styles.cornerTick}>✓</i>}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          {selected ? (
            <p className={styles.skuStatusBox}>
              Giá SKU: <strong>{formatPrice(selected.price)}</strong> ·{" "}
              {selected.inStock ? "Còn hàng" : "Hết hàng"}
            </p>
          ) : (
            <p className={styles.skuHintBox}>
              Chọn đủ phân loại để xem giá và tình trạng hàng.
            </p>
          )}
          <label>
            Số lượng trong giỏ
            <input
              type="number"
              min="1"
              step="1"
              required
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setNotice("");
              }}
            />
          </label>
          <p className={styles.hint}>
            Số lượng này thay cho số lượng của cùng SKU nếu đã có trong giỏ. Giá
            và tồn kho được kiểm lại khi thanh toán.
          </p>
          <div className={styles.dualActionRow}>
            <button className={styles.addToCartBtn} disabled={busy || !canBuy}>
              {busy ? "Đang lưu…" : "Lưu vào giỏ"}
            </button>
            <Link to="/cart" className={styles.buyNowLink}>
              Xem giỏ và thanh toán
            </Link>
          </div>
        </fieldset>
      </form>
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
