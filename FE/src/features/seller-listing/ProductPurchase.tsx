import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
      <>
        {/* Guests can see the available options (read-only); buying still needs login. */}
        {(product.optionGroups ?? []).filter((g) => g.values.length > 0).map((g) => (
          <div className={styles.guestOptions} key={g.id}>
            <span>{g.name}</span>
            <ul aria-label={`${g.name} có sẵn`}>
              {g.values.map((v) => <li key={v.id}>{v.value}</li>)}
            </ul>
          </div>
        ))}
        <p className={styles.loginPromptBar}>
          <Link to="/login" state={{ from: location }}>Đăng nhập để chọn mua</Link>
        </p>
      </>
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
  const navigate = useNavigate();

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
  const maxStock = typeof selected?.stock === 'number' && selected.stock > 0 ? selected.stock : 99;
  const canBuy =
    selected?.inStock === true && Number.isSafeInteger(count) && count > 0;

  async function handleAddToCart(event?: FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
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

  async function handleBuyNow() {
    if (pending.current || !selected || !canBuy) return;
    pending.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    const session = getAuthSessionVersion();
    try {
      await cartApi.put(selected.id, count);
      if (active.current && session === getAuthSessionVersion()) {
        navigate(`/cart?selectVariant=${selected.id}`);
      }
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
      <form className={styles.form} onSubmit={(e) => void handleAddToCart(e)}>
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

          <div className={styles.quantitySection}>
            <label htmlFor="pdp-quantity-input" className={styles.quantityLabel}>
              Số lượng
            </label>
            <div
              className={styles.quantityStepper}
              role="group"
              
            >
              <button
                type="button"
                className={styles.stepperBtn}
                aria-label="Giảm số lượng"
                disabled={busy || count <= 1 || !selected}
                onClick={() => {
                  setQuantity(String(Math.max(1, count - 1)));
                  setNotice("");
                  setError("");
                }}
              >
                −
              </button>
              <input
                id="pdp-quantity-input"
                type="number"
                min="1"
                max={maxStock}
                step="1"
                required
                value={quantity}
                disabled={busy || !selected}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setNotice("");
                  setError("");
                }}
                onBlur={() => {
                  if (!/^[1-9]\d*$/.test(quantity) || Number(quantity) < 1) {
                    setQuantity("1");
                  } else if (Number(quantity) > maxStock) {
                    setQuantity(String(maxStock));
                  }
                }}
                className={styles.stepperInput}
              />
              <button
                type="button"
                className={styles.stepperBtn}
                aria-label="Tăng số lượng"
                disabled={busy || count >= maxStock || !selected}
                onClick={() => {
                  setQuantity(String(Math.min(maxStock, count + 1)));
                  setNotice("");
                  setError("");
                }}
              >
                +
              </button>
              {selected?.stock !== undefined && (
                <span className={styles.stockNotice}>
                  {selected.stock > 0 ? `${selected.stock} sản phẩm có sẵn` : 'Hết hàng'}
                </span>
              )}
            </div>
          </div>

          <p className={styles.hint}>
            Số lượng này thay cho số lượng của cùng SKU nếu đã có trong giỏ. Giá
            và tồn kho được kiểm lại khi thanh toán.
          </p>

          <div className={styles.dualActionRow}>
            <button
              type="submit"
              className={styles.addToCartBtn}
              disabled={busy || !canBuy}
              aria-label="Thêm vào giỏ hàng"
            >
              <span aria-hidden="true">🛒 </span>
              {busy ? "Đang lưu…" : "Thêm vào giỏ hàng"}
            </button>
            <button
              type="button"
              className={styles.buyNowBtn}
              disabled={busy || !canBuy}
              onClick={() => void handleBuyNow()}
              aria-label="Mua ngay"
            >
              {busy ? "Đang xử lý…" : "Mua ngay"}
            </button>
          </div>
        </fieldset>
      </form>
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
