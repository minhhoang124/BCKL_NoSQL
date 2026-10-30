import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import { formatPrice } from "../../services/marketplaceApi";
import type { Product } from "../../types/marketplace";
import { inventoryMoney, variantInventoryApi, type VariantEdit } from "./variantInventoryApi";
import styles from "../../pages/Marketplace.module.css";

export function VariantInventoryEditor({ product, busy, onChanged }: { product: Product; busy: boolean; onChanged?: (product: Product) => void }) {
  const { user, loading } = useAuth();
  if (loading || !user?.isActive || user.role !== "SELLER") return null;
  return <InventoryWorkspace key={`${user.id}:${getAuthSessionVersion()}:${product.id}`} productId={product.id} parentBusy={busy} onChanged={onChanged} />;
}
function InventoryWorkspace({ productId, parentBusy, onChanged }: { productId: number; parentBusy: boolean; onChanged?: (product: Product) => void }) {
  const [snapshot, setSnapshot] = useState<Product | null>(null), [variantId, setVariantId] = useState(0);
  const [price, setPrice] = useState(""), [stock, setStock] = useState(""), [reason, setReason] = useState("");
  const [review, setReview] = useState<VariantEdit | null>(null), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const active = useRef(true), epoch = useRef(getAuthSessionVersion()), flight = useRef(false), generation = useRef(0);
  const live = () => active.current && epoch.current === getAuthSessionVersion();
  function choose(record: Product, id: number) {
    const v = record.variants.find(v => v.id === id);
    setVariantId(v?.id ?? 0); setPrice(v?.price ?? ""); setStock(v?.stock === undefined ? "" : String(v.stock));
    setReason(""); setReview(null); setConsent(false);
  }
  async function reload() {
    if (flight.current) return;
    const gen = ++generation.current;
    setBusy(true); setReview(null); setConsent(false); setError("");
    try {
      const record = await variantInventoryApi.read(productId);
      if (!live() || gen !== generation.current) return;
      if (record.id !== productId || !Number.isSafeInteger(record.version) || !record.version || record.version < 1 || !Array.isArray(record.variants)) throw Error("Dữ liệu giá/kho chưa hợp lệ.");
      setSnapshot(record); choose(record, record.variants.some(v => v.id === variantId) ? variantId : (record.variants[0]?.id ?? 0));
      setUncertain(false); setMessage("Đã tải giá/kho hiện tại. Kiểm tra lại trước khi thay đổi.");
    } catch {
      if (live() && gen === generation.current) { setSnapshot(null); setError("Chưa tải được giá/kho. Chưa được gửi thay đổi."); }
    } finally { if (live() && gen === generation.current) setBusy(false); }
  }
  useEffect(() => { active.current = true; void reload(); return () => { active.current = false; ++generation.current; }; }, []);
  const variant = snapshot?.variants.find(v => v.id === variantId);
  const blocked = parentBusy || busy || uncertain || !snapshot || !variant || variant.stock === undefined || ["PENDING", "FROZEN"].includes(snapshot.moderationStatus ?? "");
  function reviewChange() {
    if (blocked || !snapshot || !variant || variant.stock === undefined) return;
    try {
      const next = inventoryMoney(price), old = inventoryMoney(variant.price), text = reason.trim();
      if (!/^(0|[1-9][0-9]*)$/.test(stock) || !Number.isInteger(Number(stock)) || Number(stock) > 2147483647) throw Error("Tồn kho phải là số nguyên từ 0 đến 2.147.483.647.");
      if (!text || text.length > 500) throw Error("Nhập lý do điều chỉnh từ 1 đến 500 ký tự.");
      if (next === old && Number(stock) === variant.stock) throw Error("Giá và tồn kho chưa thay đổi.");
      setReview({ expectedProductVersion: snapshot.version!, expectedPrice: old, expectedStock: variant.stock, price: next, stock: Number(stock), reason: text });
      setConsent(false); setError(""); setMessage("");
    } catch (e) { setError(e instanceof Error ? e.message : "Kiểm tra lại dữ liệu."); }
  }
  async function save() {
    if (flight.current || !live() || blocked || !review || !consent || !variant) return;
    flight.current = true; ++generation.current; setBusy(true); setError(""); setMessage("");
    try {
      await variantInventoryApi.edit(productId, variant.id, review, epoch.current);
      if (!live()) return;
      setReview(null); setConsent(false); setUncertain(true);
      try {
        const record = await variantInventoryApi.read(productId);
        if (!live()) return;
        if (record.id !== productId || !record.version || !Array.isArray(record.variants)) throw Error();
        setSnapshot(record); choose(record, variant.id); setUncertain(false); onChanged?.(record);
        setMessage("Đã lưu điều chỉnh giá/kho. Các đơn đã đặt giữ nguyên giá lúc mua.");
      } catch { if (live()) setMessage("Đã lưu nhưng chưa tải lại được giá/kho. Bấm tải lại để kiểm tra."); }
    } catch (e) {
      if (live()) { setUncertain(true); setReview(null); setConsent(false); setError(e instanceof ApiError && e.status === 409 ? "Giá hoặc kho đã thay đổi. Tải lại rồi kiểm tra trước khi sửa tiếp." : "Chưa xác minh được kết quả. Tải lại giá/kho trước thao tác mới; không tự gửi lại."); }
    } finally { flight.current = false; if (live()) setBusy(false); }
  }
  return <section className={styles.form} aria-label="Điều chỉnh giá và tồn kho SKU">
    <h2>Điều chỉnh giá và tồn kho</h2>
    <p>Giá/kho mới áp dụng ngay. Thay đổi nội dung sản phẩm vẫn theo quy trình duyệt.</p>
    <button type="button" disabled={busy || parentBusy} onClick={() => void reload()}>Tải lại giá/kho</button>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {snapshot && variant && <>
      <label>SKU cần điều chỉnh<select disabled={busy || parentBusy || uncertain} value={variantId} onChange={e => { choose(snapshot, Number(e.target.value)); setError(""); setMessage(""); }}>
        {snapshot.variants.map(v => <option key={v.id} value={v.id}>{v.sellerSku || v.skuCode || `SKU #${v.id}`}</option>)}
      </select></label>
      <p>{snapshot.name}: {formatPrice(variant.price)} · Tồn hiện tại: {variant.stock ?? "Chưa có dữ liệu"}</p>
      <form onSubmit={e => { e.preventDefault(); reviewChange(); }}>
        <fieldset disabled={blocked || !!review}>
          <label>Giá mới của SKU (đồng)<input type="text" inputMode="numeric" maxLength={15} required value={price} onChange={e => setPrice(e.target.value)} /></label>
          <label>Tồn kho mới của SKU<input type="number" min={0} max={2147483647} step={1} required value={stock} onChange={e => setStock(e.target.value)} /></label>
          <label>Lý do điều chỉnh SKU<textarea maxLength={500} required value={reason} onChange={e => setReason(e.target.value)} /></label>
          <button type="submit">Kiểm tra thay đổi SKU</button>
        </fieldset>
      </form>
      {review && <div>
        <p>Giá: {formatPrice(review.expectedPrice)} → {formatPrice(review.price)}. Tồn kho: {review.expectedStock} → {review.stock}.</p>
        <label><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Tôi xác nhận điều chỉnh đúng SKU, giá và tồn kho đã kiểm tra.</label>
        <button type="button" disabled={!consent || blocked} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu giá/kho SKU"}</button>
        <button type="button" disabled={busy} onClick={() => { setReview(null); setConsent(false); }}>Sửa lại thay đổi</button>
      </div>}
    </>}
  </section>;
}
