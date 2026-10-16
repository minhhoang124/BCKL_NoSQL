import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { ApiError } from '../../services/apiClient';
import { clearMatchingIntent, errorMessage, initialIntent, intentSlot, lookupReceipt, money, read, rejectedWithoutCommit, saveIntent, validateReceipt, write } from './api';
import type { Address, Cart, CheckoutBody, Intent, Preview, Receipt } from './api';
import styles from './OrderFlow.module.css';
import { parseCartSelection } from './cartSelection';

export function CheckoutPage() {
  const { user } = useAuth();
  const { search } = useLocation();
  return <CheckoutView key={`${user!.id}:${search}`} userId={user!.id} search={search} />;
}
function CheckoutView({ userId, search }: { userId: number; search: string }) {
  const slot = intentSlot(userId, 'checkout');
  const [initial] = useState(() => initialIntent(slot, path => path === '/checkouts'));
  const [cart, setCart] = useState<Cart | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState(0);
  const [selection] = useState(() => parseCartSelection(search));
  const [selected, setSelected] = useState<number[]>(selection.ids);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [intent, setIntent] = useState<Intent | null>(initial.pending);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState(initial.error);
  const [storageBlocked, setStorageBlocked] = useState(initial.blocked);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const gate = useRef(false);
  const activeKey = useRef(initial.pending?.key ?? '');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([read<Cart>('/cart', controller.signal), read<{ items: Address[] }>('/me/addresses', controller.signal)])
      .then(([basket, list]) => {
        if (controller.signal.aborted) return;
        setCart(basket); setAddresses(list.items); setDataReady(true);
        setAddressId(list.items.find(a => a.isDefault)?.id ?? list.items[0]?.id ?? 0);
      }).catch(e => {
        if (controller.signal.aborted) return;
        setDataReady(false);
        setError(e instanceof ApiError ? e.message : 'Không tải được địa chỉ và giỏ hàng. Kiểm tra kết nối rồi thử lại.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slot, reload]);
  const items = cart?.groups.flatMap(g => g.items) ?? [];
  const invalidIds = cart ? selected.filter(id => !items.some(i => i.variantId === id && i.available && i.currentUnitPrice)) : [];
  const selectionError = intent ? '' : selection.error || (invalidIds.length ? `Món đã chọn không còn mua được hoặc không còn trong giỏ: Variant ${invalidIds.join(', ')}. Quay lại giỏ để chọn lại; chưa gửi yêu cầu mua.` : '');
  function reloadCart() {
    if (gate.current || intent) return;
    setLoading(true); setDataReady(false); setRefreshRequired(false); setPreview(null); setError(''); setReload(n => n + 1);
  }
  const selectedAddress = addresses.find(a => a.id === addressId);
  const body: CheckoutBody = { addressId, paymentProvider: 'COD', items: items.filter(i => selected.includes(i.variantId) && i.available && i.currentUnitPrice).map(i => ({ variantId: i.variantId, quantity: i.quantity, expectedUnitPrice: i.currentUnitPrice! })) };
  async function run(action: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) {
      if (rejectedWithoutCommit(e)) {
        try { clearMatchingIntent(slot, activeKey.current); setIntent(null); setPreview(null); setRefreshRequired(true); }
        catch { setStorageBlocked(true); }
      }
      setError(errorMessage(e));
    }
    finally { gate.current = false; setBusy(false); }
  }
  async function accept(value: Receipt, key: string) {
    validateReceipt(value);
    setReceipt(value); setIntent(null);
    try { clearMatchingIntent(slot, key); } catch { setStorageBlocked(true); setError('Đơn đã được tạo, nhưng chưa xóa được mã chờ trong trình duyệt. Không đặt lại; xem đơn bên dưới.'); }
  }
  function submit() {
    void run(async () => {
      if (!preview?.canCheckout || !preview.totals || intent || storageBlocked || selectionError || !cart || !dataReady || loading || refreshRequired) return;
      const pending = saveIntent(slot, '/checkouts', body);
      activeKey.current = pending.key;
      setIntent(pending);
      await accept(await write<Receipt>(pending.path, pending.body, pending.key), pending.key);
    });
  }
  if (receipt) return <div className={styles.page}>
    <h1>Đã ghi nhận đặt hàng COD</h1><p>{receipt.replayed ? 'Đã khôi phục biên nhận gốc; không đặt thêm đơn.' : 'Đơn đã được tạo thành công.'}</p>
    <p>Đây là biên nhận lúc đặt, không phải trạng thái giao hàng hiện tại.</p>
    {receipt.orders.map(o => <article className={styles.card} key={o.id}><h2>{o.orderNumber}</h2><p>{money(o.total)}</p><p>Mã đơn: {o.id}. <Link to={`/account/orders/${o.id}`}>Theo dõi đơn {o.orderNumber}</Link></p></article>)}
    {error && <p role="alert">{error}</p>}<Link to="/cart">Quay lại giỏ hàng</Link>
  </div>;
  return <div className={styles.page}>
    <h1>Xác nhận mua hàng</h1><p>COD mô phỏng · Phí vận chuyển demo 0 ₫. Giỏ hàng không giữ kho.</p>
    <Link to="/cart">Quay lại giỏ hàng</Link> · <Link to="/account/addresses">Quản lý địa chỉ</Link>
    <p>Checkout đọc lại địa chỉ, giá và số lượng từ Backend. Thêm địa chỉ hoặc đổi lượng hàng ở màn tương ứng trước khi xác nhận.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {refreshRequired && !intent && <button disabled={busy || loading} onClick={reloadCart}>Tải lại giỏ và giá</button>}
    {selectionError && <p role="alert">{selectionError}</p>}
    {!selection.ids.length && !selection.error && !intent && <p>Chưa chọn món. Đánh dấu các món muốn mua bên dưới; không tự mua toàn bộ giỏ.</p>}
    {intent && <section className={styles.card} aria-label="Yêu cầu chưa rõ kết quả">
      <h2>Yêu cầu đang chờ đối chiếu</h2><p>Không tạo mã đặt hàng mới. Tra biên nhận hoặc gửi lại đúng yêu cầu cũ; 404 khi tra chưa chứng minh yêu cầu trước chưa được ghi nhận.</p>
      <button disabled={busy} onClick={() => void run(async () => accept(await lookupReceipt(intent.key), intent.key))}>Tra biên nhận</button>
      <button disabled={busy} onClick={() => void run(async () => accept(await write<Receipt>(intent.path, intent.body, intent.key), intent.key))}>Gửi lại cùng yêu cầu</button>
    </section>}
    {loading ? <p role="status">Đang tải địa chỉ và giỏ hàng…</p> : <>
      {!dataReady ? <button disabled={busy || !!intent} onClick={reloadCart}>Tải lại</button> : <>
      {!addresses.length && <p>Chưa có địa chỉ nhận hàng. Thêm địa chỉ ở màn Address trước khi đặt.</p>}
      <label>Địa chỉ nhận hàng<select disabled={busy || !!intent} value={addressId} onChange={e => { setAddressId(Number(e.target.value)); setPreview(null); }}><option value={0}>Chọn địa chỉ</option>{addresses.map(a => <option key={a.id} value={a.id}>{a.recipientName} — {a.addressLine}, {a.ward}, {a.province}</option>)}</select></label>
      {selectedAddress && <p aria-label="Địa chỉ giao hàng đã chọn">{selectedAddress.recipientName} — {selectedAddress.addressLine}, {selectedAddress.ward}, {selectedAddress.province}</p>}
      {cart?.groups.map(group => <section className={styles.card} key={group.store.id}><h2>{group.store.name}</h2>{group.items.map(i => <label className={styles.line} key={i.variantId}><input type="checkbox" disabled={busy || !!intent || !i.available} checked={selected.includes(i.variantId)} onChange={e => { setSelected(ids => e.target.checked ? [...ids, i.variantId] : ids.filter(id => id !== i.variantId)); setPreview(null); }} />{i.productName ?? `Mặt hàng #${i.variantId}`} × {i.quantity} — {i.currentUnitPrice ? money(i.currentUnitPrice) : 'Không thể mua'}{!i.available && <span> · Không thể mua: {i.unavailableReason}</span>}</label>)}</section>)}
      {!!cart?.unavailableItems.length && <p role="alert">Có {cart.unavailableItems.length} dòng không còn bán công khai; quay lại giỏ để xóa. Không hiển thị nội dung nháp.</p>}
      {!items.length && cart && <p>Giỏ chưa có mặt hàng mua được.</p>}
      <button disabled={busy || !!intent || storageBlocked || refreshRequired || !!selectionError || !cart || !addressId || body.items.length < 1 || body.items.length > 50} onClick={() => void run(async () => { if (!selectionError && cart && dataReady && !loading && !refreshRequired) setPreview(await write<Preview>('/checkout/preview', body)); })}>Kiểm tra giá và kho</button>
      {preview && <section className={styles.card}>
        {preview.groups.flatMap(g => g.items).filter(i => i.errors.length).map(i => <p role="alert" key={i.variantId}>Mặt hàng #{i.variantId}: {i.errors.join(', ')}. Giá hiện tại {money(i.unitPrice)}.</p>)}
        {preview.canCheckout && preview.totals ? <h2>Tổng thanh toán: {money(preview.totals.total)}</h2> : <p role="alert">Chưa thể đặt hàng. Giá/kho hoặc mặt hàng đã thay đổi; tải lại giỏ để xác nhận.</p>}
        <button disabled={busy || !!intent || storageBlocked || !preview.canCheckout || !preview.totals} onClick={submit}>Đặt hàng COD</button>
        {!preview.canCheckout && <button disabled={busy || !!intent} onClick={reloadCart}>Tải lại giỏ và giá</button>}
      </section>}
      </>}
    </>}
    {busy && <p role="status">Đang xử lý… Không đóng trang hoặc gửi yêu cầu mới.</p>}
  </div>;
}
