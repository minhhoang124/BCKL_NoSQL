import { mediaUrl } from '../../services/marketplaceApi';
import { addressApi } from '../../services/addressApi';
import { AddressForm } from '../../components/Address/AddressForm';
import type { AddressInput } from '../../types/address';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapPinIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../contexts/useAuth';
import { ApiError } from '../../services/apiClient';
import { clearMatchingIntent, errorMessage, initialIntent, intentSlot, lookupReceipt, loadIntent, money, read, rejectedWithoutCommit, saveIntent, validateReceipt, write } from './api';
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
  const [provider,setProvider]=useState<'COD'|'VNPAY'>('COD');
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
  const [showAddressForm, setShowAddressForm] = useState<'create' | 'edit' | null>(null);
  const [addressSaving, setAddressSaving] = useState(false);

  const handleSaveAddress = async (input: AddressInput) => {
    setAddressSaving(true);
    try {
      if (showAddressForm === 'create') {
        const created = await addressApi.create(input);
        setAddresses((prev) => [...prev, created as any]);
        setAddressId(created.id);
      } else if (selectedAddress) {
        const updated = await addressApi.update(selectedAddress.id, input);
        setAddresses((prev) =>
          prev.map((a) => (a.id === updated.id ? (updated as any) : a)),
        );
      }
      setShowAddressForm(null);
      setPreview(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không lưu được địa chỉ.');
    } finally {
      setAddressSaving(false);
    }
  };
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
  const body: CheckoutBody = { addressId, paymentProvider: provider, items: items.filter(i => selected.includes(i.variantId) && i.available && i.currentUnitPrice).map(i => ({ variantId: i.variantId, quantity: i.quantity, expectedUnitPrice: i.currentUnitPrice! })) };
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
    const saved=loadIntent(slot),expected=(saved?.body as {paymentProvider?:string}|undefined)?.paymentProvider;
    if(!saved||saved.key!==key||!['COD','VNPAY'].includes(expected??''))throw new ApiError('Yêu cầu chờ không khớp; giữ nguyên để đối chiếu.',502,'INVALID_RECEIPT');
    validateReceipt(value,expected as 'COD'|'VNPAY');
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
    <h1>Đã ghi nhận đặt hàng {receipt.orders[0]?.payment.provider==='VNPAY'?'VNPay sandbox':'COD'}</h1><p>{receipt.replayed ? 'Đã khôi phục biên nhận gốc; không đặt thêm đơn.' : 'Đơn đã được tạo thành công.'}</p>
    {receipt.orders[0]?.payment.provider==='VNPAY'&&<p>Đơn chưa được thanh toán. Mở chi tiết từng đơn để chủ động tạo phiên VNPay sandbox.</p>}
    <p>Đây là biên nhận lúc đặt, không phải trạng thái giao hàng hiện tại.</p>
    {receipt.orders.map(o => <article className={styles.card} key={o.id}><h2>{o.orderNumber}</h2><p>{money(o.total)}</p><p>Mã đơn: {o.id}. <Link to={`/account/orders/${o.id}`}>Theo dõi đơn {o.orderNumber}</Link></p></article>)}
    {error && <p role="alert">{error}</p>}<Link to="/cart">Quay lại giỏ hàng</Link>
  </div>;
  const unavailableText: Record<string, string> = {
    PRODUCT_UNAVAILABLE: 'Sản phẩm không còn được bán',
    VARIANT_UNAVAILABLE: 'Phân loại không còn được bán',
    OUT_OF_STOCK: 'Đã hết hàng',
    INSUFFICIENT_STOCK: 'Vượt tồn kho hiện tại',
  };
  const lineAmount = (i: (typeof items)[number]) => i.currentUnitPrice
    ? (i.lineTotal ? money(i.lineTotal) : money((BigInt(i.currentUnitPrice.split('.')[0]!) * BigInt(i.quantity)).toString() + '.00'))
    : '—';
  return <div className={styles.page}>
    <h1 className={styles.checkoutTitle}>Xác nhận mua hàng</h1>
    <nav className={styles.crumbs} aria-label="Điều hướng thanh toán">
      <Link to="/cart">Quay lại giỏ hàng</Link>
      <Link to="/account/addresses">Quản lý địa chỉ</Link>
    </nav>
    {error && <p className={styles.error} role="alert">{error} {error.startsWith('Cần xác minh email trong Tài khoản') && <Link to="/account">Mở Tài khoản</Link>}</p>}
    {refreshRequired && !intent && <button className={styles.btnSecondary} disabled={busy || loading} onClick={reloadCart}>Tải lại giỏ và giá</button>}
    {selectionError && <p className={styles.error} role="alert">{selectionError}</p>}
    {!selection.ids.length && !selection.error && !intent && <p className={styles.hint}>Chưa chọn món. Đánh dấu các món muốn mua bên dưới; không tự mua toàn bộ giỏ.</p>}
    {intent && <section className={styles.card} aria-label="Yêu cầu chưa rõ kết quả">
      <h2>Yêu cầu đang chờ đối chiếu</h2><p>Không tạo mã đặt hàng mới. Tra biên nhận hoặc gửi lại đúng yêu cầu cũ; 404 khi tra chưa chứng minh yêu cầu trước chưa được ghi nhận.</p>
      <button disabled={busy} onClick={() => void run(async () => accept(await lookupReceipt(intent.key), intent.key))}>Tra biên nhận</button>
      <button className={styles.btnSecondary} disabled={busy} onClick={() => void run(async () => accept(await write<Receipt>(intent.path, intent.body, intent.key), intent.key))}>Gửi lại cùng yêu cầu</button>
    </section>}
    {loading ? <p className={styles.hint} role="status">Đang tải địa chỉ và giỏ hàng…</p> : <>
      {!dataReady ? <button disabled={busy || !!intent} onClick={reloadCart}>Tải lại</button> : <>
      <section className={styles.addressSection} aria-labelledby="checkout-address-title">
        <div className={styles.addressHeaderRow}>
          <h2 id="checkout-address-title" className={styles.addressTitle}><MapPinIcon aria-hidden="true" />Địa chỉ nhận hàng</h2>
          <div className={styles.addressActionBtns}>
            <button type="button" className={styles.linkButton} disabled={busy || !!intent || addressSaving}
              onClick={() => setShowAddressForm(prev => prev === 'create' ? null : 'create')}>
              {showAddressForm === 'create' ? 'Đóng' : '+ Thêm địa chỉ mới'}
            </button>
            {selectedAddress && <button type="button" className={styles.linkButton} disabled={busy || !!intent || addressSaving}
              onClick={() => setShowAddressForm(prev => prev === 'edit' ? null : 'edit')}>
              {showAddressForm === 'edit' ? 'Đóng' : 'Sửa địa chỉ này'}
            </button>}
          </div>
        </div>
        {selectedAddress && <p className={styles.addressLine} aria-label="Địa chỉ giao hàng đã chọn">
          <strong>{selectedAddress.recipientName}{selectedAddress.phone ? ` · ${selectedAddress.phone}` : ''}</strong>
          <span>{selectedAddress.addressLine}, {selectedAddress.ward}, {selectedAddress.province}</span>
          {selectedAddress.isDefault && <span className={styles.defaultTag}>Mặc định</span>}
        </p>}
        {!addresses.length && <p className={styles.hint}>Chưa có địa chỉ nhận hàng. Bấm “+ Thêm địa chỉ mới” để thêm ngay tại đây.</p>}
        {addresses.length > 0 && <label className={styles.addressPicker}>
          <span>Địa chỉ nhận hàng đã lưu</span>
          <select disabled={busy || !!intent} value={addressId} onChange={(e) => { setAddressId(Number(e.target.value)); setPreview(null); }}>
            <option value={0}>Chọn địa chỉ</option>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.recipientName} — {a.addressLine}, {a.ward}, {a.province}</option>)}
          </select>
        </label>}
        {showAddressForm && <div className={styles.addressInlineForm}>
          <AddressForm address={showAddressForm === 'edit' ? (selectedAddress as any) : null} disabled={busy || !!intent}
            saving={addressSaving} onSave={handleSaveAddress} onCancel={() => setShowAddressForm(null)} />
        </div>}
      </section>

      <div className={styles.itemsHead} aria-hidden="true">
        <span>Sản phẩm</span><span>Đơn giá</span><span>Số lượng</span><span>Thành tiền</span>
      </div>
      {cart?.groups.map((group) => (
        <section className={styles.checkoutGroupCard} key={group.store.id} aria-label={`Cửa hàng ${group.store.name}`}>
          <div className={styles.storeBanner}><h2>{group.store.name}</h2></div>
          {group.items.map((i) => (
            <div className={styles.checkoutItemRow} key={i.variantId}>
              <input type="checkbox" aria-label={`Chọn ${i.productName ?? `mặt hàng #${i.variantId}`}`}
                disabled={busy || !!intent || !i.available} checked={selected.includes(i.variantId)}
                onChange={(e) => {
                  setSelected((ids) => e.target.checked ? [...ids, i.variantId] : ids.filter((id) => id !== i.variantId));
                  setPreview(null);
                }} />
              {i.imageUrl
                ? <img src={mediaUrl(i.imageUrl)} alt="" className={styles.checkoutItemImg}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                : <span className={styles.checkoutItemImg} aria-hidden="true" />}
              <div className={styles.checkoutItemContent}>
                <h3 className={styles.checkoutItemTitle}>{i.productName ?? `Mặt hàng #${i.variantId}`}</h3>
                {i.optionValues && i.optionValues.length > 0 && <p className={styles.checkoutItemVariant}>Phân loại: {i.optionValues.join(' / ')}</p>}
                {!i.available && <p className={styles.unavailable}>Không thể mua: {unavailableText[i.unavailableReason ?? ''] ?? 'Không còn bán'}</p>}
              </div>
              <div className={styles.cellPrice}>{i.currentUnitPrice ? money(i.currentUnitPrice) : '—'}</div>
              <div className={styles.cellQty}><span className={styles.mobileLabel}>Số lượng: </span>{i.quantity}</div>
              <div className={styles.checkoutItemTotal}>{lineAmount(i)}</div>
            </div>
          ))}
        </section>
      ))}
      {!!cart?.unavailableItems.length && <p className={styles.error} role="alert">Có {cart.unavailableItems.length} dòng không còn bán công khai; quay lại giỏ để xóa. Không hiển thị nội dung nháp.</p>}
      {!items.length && cart && <p className={styles.hint}>Giỏ chưa có mặt hàng mua được.</p>}

      <section className={`${styles.card} ${styles.checkoutSummary}`} aria-label="Xác nhận thanh toán">
        <div className={styles.paymentRow}>
          <h2>Phương thức thanh toán</h2>
          {import.meta.env.VITE_VNPAY_SANDBOX_ENABLED === 'true'
            ? <label className={styles.paymentSelect}><span className={styles.srOnly}>Phương thức thanh toán</span>
                <select value={provider} disabled={busy || !!intent || storageBlocked} onChange={e => { setProvider(e.target.value as 'COD' | 'VNPAY'); setPreview(null); }}>
                  <option value="COD">Thanh toán khi nhận hàng (COD)</option>
                  <option value="VNPAY">VNPay sandbox — không tiền thật</option>
                </select></label>
            : <span className={styles.paymentChosen}>Thanh toán khi nhận hàng</span>}
        </div>
        <div className={styles.summaryBody}>
          {preview && preview.groups.flatMap(g => g.items).filter(i => i.errors.length).map(i => <p className={styles.error} role="alert" key={i.variantId}>Mặt hàng #{i.variantId}: {i.errors.join(', ')}. Giá hiện tại {money(i.unitPrice)}.</p>)}
          {preview && !preview.canCheckout && <p className={styles.error} role="alert">Chưa thể đặt hàng. Giá/kho hoặc mặt hàng đã thay đổi; tải lại giỏ để xác nhận.</p>}
          <dl className={styles.totals}>
            <div><dt>Phí vận chuyển</dt><dd>0 ₫</dd></div>
            <div className={styles.grandTotal}><dt>Tổng thanh toán</dt><dd>{preview?.canCheckout && preview.totals ? money(preview.totals.total) : '—'}</dd></div>
          </dl>
        </div>
        <div className={styles.placeOrderRow}>
          <p className={styles.hint}>{preview?.canCheckout ? 'Giá và tồn kho đã được kiểm tra. Bấm đặt hàng để tạo đơn.' : 'Bấm kiểm tra để xác nhận giá và tồn kho mới nhất trước khi đặt hàng.'}</p>
          {!preview ? <button disabled={busy || !!intent || storageBlocked || refreshRequired || !!selectionError || !cart || !addressId || body.items.length < 1 || body.items.length > 50}
              onClick={() => void run(async () => { if (!selectionError && cart && dataReady && !loading && !refreshRequired) setPreview(await write<Preview>('/checkout/preview', body)); })}>Kiểm tra giá và kho</button>
            : <>
              {!preview.canCheckout && <button className={styles.btnSecondary} disabled={busy || !!intent} onClick={reloadCart}>Tải lại giỏ và giá</button>}
              <button className={styles.placeOrder} disabled={busy || !!intent || storageBlocked || !preview.canCheckout || !preview.totals} onClick={submit}>Đặt hàng {provider === 'COD' ? 'COD' : 'VNPay sandbox'}</button>
            </>}
        </div>
      </section>
      </>}
    </>}
    {busy && <p className={styles.hint} role="status">Đang xử lý… Không đóng trang hoặc gửi yêu cầu mới.</p>}
  </div>;
}
