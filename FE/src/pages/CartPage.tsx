import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { ApiError } from '../services/apiClient';
import { cartApi } from '../services/cartApi';
import { mediaUrl } from '../services/marketplaceApi';
import type { User } from '../types/auth';
import type { CartItem, CartResponse, CartUnavailableReason } from '../types/cart';
import { formatCartMoney, parseCartMoney } from '../utils/cartMoney';
import styles from './CartPage.module.css';

const unavailableLabel: Record<CartUnavailableReason, string> = {
  PRODUCT_UNAVAILABLE: 'Sản phẩm không còn được bán',
  VARIANT_UNAVAILABLE: 'Phân loại này không còn được bán',
  OUT_OF_STOCK: 'Đã hết hàng',
  INSUFFICIENT_STOCK: 'Số lượng trong giỏ vượt tồn kho hiện tại',
};

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Tài khoản này không có quyền quản lý giỏ hàng.';
    if (error.status === 429) return 'Bạn thao tác quá nhanh. Vui lòng chờ rồi tải lại giỏ hàng.';
    return error.message;
  }
  return 'Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.';
}

function allItems(cart: CartResponse) {
  return [...cart.groups.flatMap((group) => group.items), ...cart.unavailableItems];
}

function canEditQuantity(item: CartItem) {
  return item.available || item.unavailableReason === 'INSUFFICIENT_STOCK';
}

function SelectionCheckbox({ checked, mixed, ...props }: {
  checked: boolean; mixed: boolean; disabled: boolean; label: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" checked={checked} aria-checked={mixed ? 'mixed' : checked}
    aria-label={props.label} disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} />;
}

type DeleteTarget = { variantId: number; quantity: number; label: string };

function DeleteCartDialog({ item, busy, returnFocus, onCancel, onConfirm }: {
  item: DeleteTarget; busy: boolean; returnFocus: RefObject<HTMLElement | null>; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = returnFocus.current;
    cancel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [returnFocus]);
  useEffect(() => { if (busy) dialog.current?.focus(); }, [busy]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); }
    if (event.key !== 'Tab') return;
    const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons?.length) { event.preventDefault(); return; }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className={styles.confirm}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cart-delete-title"
      aria-describedby="cart-delete-description" aria-busy={busy} onKeyDown={onKeyDown}>
      <h2 id="cart-delete-title">Xóa dòng khỏi giỏ hàng?</h2>
      <p id="cart-delete-description">{item.label} · Số lượng {item.quantity}</p>
      <div className={styles.actions}>
        <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>Giữ lại</button>
        <button type="button" className={styles.remove} disabled={busy} onClick={onConfirm}>{busy ? 'Đang xóa...' : 'Xác nhận xóa'}</button>
      </div>
    </div>
  </div>;
}

export function CartPage() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Đang kiểm tra phiên đăng nhập...</p>;
  if (!user) return <p role="alert">Vui lòng đăng nhập để xem giỏ hàng.</p>;
  if (user.role !== 'USER' || !user.isActive)
    return <p role="alert">Chỉ tài khoản người mua đang hoạt động được quản lý giỏ hàng.</p>;
  return <CartContent key={user.id} user={user} />;
}

function CartContent({ user }: { user: User }) {
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [priceNotice, setPriceNotice] = useState('');
  const [authError, setAuthError] = useState(false);
  const snapshot = useRef<CartResponse | null>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const selectionInitialized = useRef(false);

  const cancelReads = useCallback(() => {
    ++request.current;
    controller.current?.abort();
  }, []);

  const acceptCart = useCallback((next: CartResponse, committedId?: number) => {
    const items = allItems(next);
    const oldItems = new Map(snapshot.current ? allItems(snapshot.current).map((item) => [item.variantId, item]) : []);
    const changedPrices = items.filter((item) => item.currentUnitPrice && oldItems.get(item.variantId)?.currentUnitPrice
      && item.currentUnitPrice !== oldItems.get(item.variantId)?.currentUnitPrice);
    setPriceNotice(changedPrices.length ? `Giá của ${changedPrices.length} dòng đã thay đổi. Tạm tính đã cập nhật theo giá mới; hãy kiểm tra lại trước khi mua.` : '');
    snapshot.current = next;
    setCart(next);
    setDrafts((previous) => Object.fromEntries(items.map((item) => {
      const old = oldItems.get(item.variantId);
      const keepDraft = item.variantId !== committedId && canEditQuantity(item) && old
        && previous[item.variantId] !== undefined && previous[item.variantId] !== String(old.quantity);
      return [item.variantId, keepDraft ? previous[item.variantId] : String(item.quantity)];
    })));
    const availableIds = new Set(items.filter((item) => item.available).map((item) => item.variantId));
    const initializeSelection = !selectionInitialized.current;
    selectionInitialized.current = true;
    setSelected((previous) => {
      if (initializeSelection) return availableIds;
      return new Set([...previous].filter((id) => availableIds.has(id)));
    });
    setReady(true);
    setAuthError(false);
  }, []);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const next = await cartApi.list(current.signal);
      if (mounted.current && sequence === request.current) acceptCart(next);
    } catch (failure) {
      if (mounted.current && sequence === request.current && !current.signal.aborted) {
        setError(errorMessage(failure));
        setAuthError(failure instanceof ApiError && failure.status === 401);
      }
    } finally {
      if (mounted.current && sequence === request.current) setLoading(false);
    }
  }, [acceptCart]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { mounted.current = false; window.clearTimeout(timer); cancelReads(); };
  }, [load, cancelReads]);

  const run = async (work: () => Promise<CartResponse | void>, success: string, committedId?: number) => {
    if (pending.current || !ready) return;
    pending.current = true;
    cancelReads();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (!mounted.current) return;
      setDeleting(null);
      setNotice(success);
      if (result) acceptCart(result, committedId);
      else await load();
    } catch (failure) {
      if (!mounted.current) return;
      setDeleting(null);
      setError(errorMessage(failure));
      setAuthError(failure instanceof ApiError && failure.status === 401);
      if (!(failure instanceof ApiError) || failure.status !== 400) {
        setReady(false);
        setNotice('Tải lại giỏ hàng để kiểm tra trạng thái mới nhất trước khi thao tác tiếp.');
      }
    } finally {
      if (mounted.current) { pending.current = false; setBusy(false); }
    }
  };

  const updateQuantity = (item: CartItem) => {
    if (pending.current || deleting || !canEditQuantity(item)) return;
    const draft = drafts[item.variantId] ?? '';
    if (!/^[1-9]\d*$/.test(draft) || Number(draft) > 99) {
      setError('Số lượng phải là số nguyên từ 1 đến 99.');
      return;
    }
    void run(() => cartApi.put(item.variantId, Number(draft)), 'Đã cập nhật giỏ hàng.', item.variantId);
  };

  const toggle = (id: number, checked: boolean) => setSelected((previous) => {
    const next = new Set(previous);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const toggleGroup = (ids: number[], checked: boolean) => setSelected((previous) => {
    const next = new Set(previous);
    for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
    return next;
  });

  const available = cart?.groups.flatMap((group) => group.items).filter((item) => item.available) ?? [];
  const selectedItems = available.filter((item) => selected.has(item.variantId));
  let selectedCents: bigint | null = 0n;
  for (const item of selectedItems) {
    const unit = item.currentUnitPrice ? parseCartMoney(item.currentUnitPrice) : null;
    if (unit === null) { selectedCents = null; break; }
    selectedCents += unit * BigInt(item.quantity);
  }
  const disabled = loading || busy || !ready || !!deleting;
  const visibleSummary = ready && !loading;
  const dirtyCount = cart ? allItems(cart).filter((item) => canEditQuantity(item)
    && drafts[item.variantId] !== String(item.quantity)).length : 0;
  const checkoutQuery = new URLSearchParams();
  for (const item of selectedItems) checkoutQuery.append('variantId', String(item.variantId));
  const canCheckout = !disabled && selectedItems.length > 0 && selectedItems.length <= 50
    && dirtyCount === 0 && selectedCents !== null;
  const openDelete = (item: CartItem, privateItem = false) => {
    // Capture before the background becomes inert (real browsers otherwise blur it).
    deleteTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeleting({ variantId: item.variantId, quantity: item.quantity,
      label: privateItem ? `Mã phân loại #${item.variantId}` : item.productName ?? `Mã phân loại #${item.variantId}` });
  };

  return <main className={styles.page}>
    <div inert={deleting ? true : undefined}>
    <header className={styles.heading}>
      <div><span className={styles.eyebrow}>Tài khoản của {user.fullName || user.email}</span><h1>Giỏ hàng</h1>
        <p>Giá và tồn kho được cập nhật từ hệ thống; thêm giỏ không giữ hàng.</p></div>
      <button type="button" disabled={loading || busy} onClick={() => { setNotice(''); void load(); }}>Tải lại giỏ hàng</button>
    </header>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {authError && <p><Link to="/login">Đăng nhập lại</Link></p>}
    {visibleSummary && priceNotice && <p className={styles.warning} role="status">{priceNotice}</p>}
    {visibleSummary && dirtyCount > 0 && <p className={styles.warning} role="status">Có {dirtyCount} dòng sửa số lượng chưa lưu. Tạm tính vẫn dùng số lượng đã lưu.</p>}
    <div className={styles.layout}>
      <div className={styles.groups} aria-busy={loading}>
        {loading ? <p className={styles.empty} role="status">Đang tải giỏ hàng...</p> : !ready ?
          <p className={styles.empty}>Tải lại giỏ hàng để kiểm tra trạng thái và tiếp tục.</p> : !cart?.lineCount ?
            <div className={styles.empty}><h2>Giỏ hàng đang trống</h2><p>Hãy chọn sản phẩm để bắt đầu mua sắm.</p><Link to="/">Xem sản phẩm</Link></div> : <>
              <div className={styles.selectionBar}>
                <label><SelectionCheckbox label="Chọn tất cả hàng mua được" disabled={disabled || !available.length}
                  checked={available.length > 0 && selectedItems.length === available.length}
                  mixed={selectedItems.length > 0 && selectedItems.length < available.length}
                  onChange={(checked) => toggleGroup(available.map((item) => item.variantId), checked)} /> Chọn tất cả hàng mua được</label>
                <small>{available.length} dòng có thể mua</small>
              </div>
              {cart.groups.map((group) => {
                const ids = group.items.filter((item) => item.available).map((item) => item.variantId);
                return <section className={styles.group} key={group.store.id} aria-label={`Cửa hàng ${group.store.name}`}>
                  <div className={styles.groupHead}>
                    <label><SelectionCheckbox label={`Chọn cửa hàng ${group.store.name}`} disabled={disabled || ids.length === 0}
                      checked={ids.length > 0 && ids.every((id) => selected.has(id))}
                      mixed={ids.some((id) => selected.has(id)) && !ids.every((id) => selected.has(id))}
                      onChange={(checked) => toggleGroup(ids, checked)} /> Chọn cửa hàng {group.store.name}</label>
                    <small>Tạm tính hàng còn mua được: {moneyLabel(group.purchasableSubtotal)}</small>
                  </div>
                  {group.items.map((item) => <div className={styles.item} key={item.variantId}>
                    <input type="checkbox" aria-label={`Chọn biến thể ${item.variantId}`} disabled={disabled || !item.available}
                      checked={item.available && selected.has(item.variantId)} onChange={(event) => toggle(item.variantId, event.target.checked)} />
                    {item.imageUrl && <img className={styles.image} src={mediaUrl(item.imageUrl)} alt="" />}
                    <div className={styles.itemBody}>
                      {item.productId && item.productName ? <Link to={`/products/${item.productId}`}>{item.productName}</Link> : <strong>Sản phẩm không còn khả dụng</strong>}
                      {item.unavailableReason !== 'VARIANT_UNAVAILABLE' && <>
                        {!!item.optionValues?.length && <small>Phân loại: {item.optionValues.join(' / ')}</small>}
                        {item.currentUnitPrice && <strong>{moneyLabel(item.currentUnitPrice)}</strong>}
                        {item.stock !== undefined && <small>Tồn kho hiện tại: {item.stock}</small>}
                      </>}
                      {!item.available && <p className={styles.unavailable}>{unavailableLabel[item.unavailableReason ?? 'VARIANT_UNAVAILABLE']}</p>}
                      <div className={styles.actions}>
                        <label>Số lượng <input type="number" aria-label={`Số lượng biến thể ${item.variantId}`} min={1} max={99} step={1} inputMode="numeric"
                          value={drafts[item.variantId] ?? ''} disabled={disabled || !canEditQuantity(item)}
                          onChange={(event) => setDrafts((previous) => ({ ...previous, [item.variantId]: event.target.value }))} /></label>
                        <button type="button" disabled={disabled || !canEditQuantity(item) || drafts[item.variantId] === String(item.quantity)} onClick={() => updateQuantity(item)}>Cập nhật</button>
                        {drafts[item.variantId] !== String(item.quantity) && <button type="button" disabled={disabled}
                          onClick={() => setDrafts((previous) => ({ ...previous, [item.variantId]: String(item.quantity) }))}>Hủy sửa</button>}
                        <button type="button" className={styles.remove} disabled={disabled} onClick={() => openDelete(item)}>Xóa</button>
                      </div>
                    </div>
                  </div>)}
                </section>;
              })}
              {cart.unavailableItems.length > 0 && <section className={styles.group} aria-label="Sản phẩm không còn công khai">
                <h2>Sản phẩm không còn khả dụng</h2>
                {cart.unavailableItems.map((item) => <div className={styles.privateItem} key={item.variantId}>
                  <div><strong>Sản phẩm không còn được bán</strong><small>Mã phân loại #{item.variantId} · Số lượng {item.quantity}</small></div>
                  <button type="button" className={styles.remove} disabled={disabled} onClick={() => openDelete(item, true)}>Xóa</button>
                </div>)}
              </section>}
            </>}
      </div>
      <aside className={styles.summary} aria-label="Tóm tắt giỏ hàng">
        <h2>Tóm tắt</h2>
        <p>Dòng trong giỏ <strong>{visibleSummary ? cart?.lineCount : '—'}</strong></p>
        <p>Tổng số lượng <strong>{visibleSummary ? cart?.totalQuantity : '—'}</strong></p>
        <p>Hàng còn mua được <strong>{visibleSummary && cart ? moneyLabel(cart.purchasableSubtotal) : '—'}</strong></p>
        <hr />
        <p>Đã chọn <strong>{visibleSummary ? `${selectedItems.length} dòng` : '—'}</strong></p>
        <p>Số lượng đã chọn <strong>{visibleSummary ? selectedItems.reduce((sum, item) => sum + item.quantity, 0) : '—'}</strong></p>
        <p className={styles.total}>Tạm tính đã chọn <strong>{!visibleSummary ? '—' : selectedCents === null ? 'Không xác định' : formatCartMoney(selectedCents)}</strong></p>
        <small>Tổng thanh toán sẽ được Backend kiểm tra lại giá và tồn kho ở bước đặt hàng.</small>
        {canCheckout ? <Link className={styles.checkout} to={`/checkout?${checkoutQuery.toString()}`}>Tiếp tục thanh toán</Link>
          : <button className={styles.checkout} type="button" disabled>Tiếp tục thanh toán</button>}
        {visibleSummary && selectedItems.length > 50 && <p role="alert">Chỉ chọn tối đa 50 dòng để thanh toán.</p>}
        {visibleSummary && dirtyCount > 0 && <small>Lưu hoặc hủy sửa số lượng trước khi tiếp tục thanh toán.</small>}
      </aside>
    </div>
    </div>
    {deleting && <DeleteCartDialog item={deleting} busy={busy} returnFocus={deleteTrigger} onCancel={() => setDeleting(null)}
      onConfirm={() => void run(() => cartApi.remove(deleting.variantId), 'Đã xóa dòng khỏi giỏ hàng.')} />}
  </main>;
}

function moneyLabel(value: string) {
  const cents = parseCartMoney(value);
  return cents === null ? 'Không xác định' : formatCartMoney(cents);
}
