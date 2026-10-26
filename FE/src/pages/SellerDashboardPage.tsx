import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../services/apiClient';
import { marketplaceApi } from '../services/marketplaceApi';
import type { Brand, Category, Product, Store } from '../types/marketplace';
import styles from './Marketplace.module.css';
import { Dashboard } from '../features/dashboard/Dashboard';

const flat = (nodes: Category[]): Category[] => nodes.flatMap((node) => [node, ...flat(node.children)]);
const emptyDraft = { name: '', description: '', categoryId: '', brandId: '' };

export function SellerDashboardPage() {
  const [store, setStore] = useState<Store | null>(null); const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]); const [brands, setBrands] = useState<Brand[]>([]);
  const [selected, setSelected] = useState<Product | null>(null); const [tab, setTab] = useState<'store'|'products'|'dashboard'>('store');
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const pending = useRef(false);
  const selectProduct = (product: Product | null) => {
    if (pending.current) return;
    setSelected(product);
    setDraft(product ? { name: product.name, description: product.description ?? '', categoryId: String(product.category.id), brandId: product.brand ? String(product.brand.id) : '' } : emptyDraft);
  };
  const leafCategories = useMemo(() => flat(categories).filter((item) => item.isLeaf), [categories]);
  const load = async () => {
    const [storeResult, productRows, categoryRows, brandRows] = await Promise.all([
      marketplaceApi.myStore().catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
      marketplaceApi.myProducts().catch((e) => { if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return []; throw e; }),
      marketplaceApi.categories(), marketplaceApi.brands(),
    ]);
    setStore(storeResult); setProducts(productRows); setCategories(categoryRows); setBrands(brandRows);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((e) => setError(e instanceof ApiError ? e.message : 'Không thể tải kênh người bán.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const run = async (work: () => Promise<unknown>, success: string, onSaved?: () => void) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await work();
      onSaved?.();
      setMessage(success);
      try { await load(); } catch { setError('Đã lưu nhưng chưa tải lại được danh sách. Vui lòng tải lại trang.'); }
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Thao tác thất bại.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const saveStore = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const body = { name: String(data.get('name')), description: String(data.get('description') || '') }; void run(() => store ? marketplaceApi.updateStore(body) : marketplaceApi.createStore(body), store ? 'Đã cập nhật Store.' : 'Đã gửi yêu cầu mở Store.'); };
  const saveProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = { name: draft.name, description: draft.description, categoryId: Number(draft.categoryId), brandId: draft.brandId ? Number(draft.brandId) : null };
    void run(() => selected ? marketplaceApi.updateProduct(selected.id, body) : marketplaceApi.createProduct(body), selected ? 'Đã cập nhật sản phẩm.' : 'Đã tạo sản phẩm nháp.', () => { setSelected(null); setDraft(emptyDraft); });
  };
  const addVariant = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!selected) return; const data = new FormData(event.currentTarget); void run(() => marketplaceApi.addVariant(selected.id, { price: String(data.get('price')), stock: Number(data.get('stock')), sellerSku: String(data.get('sellerSku') || '') || null, optionValueIds: [] }), 'Đã thêm phiên bản bán.'); };
  const saveShipping = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!selected) return; const data = new FormData(event.currentTarget); void run(() => marketplaceApi.shipping(selected.id, { packageWeightGrams: Number(data.get('weight')) }), 'Đã lưu kiện hàng.'); };
  const upload = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!selected) return; const body = new FormData(event.currentTarget); body.set('isPrimary', 'true'); body.set('sortOrder', '0'); void run(() => marketplaceApi.addImage(selected.id, body), 'Đã tải ảnh chính.'); };
  return <div className={styles.page}>
    <div><h1>Kênh người bán</h1><p>Hoàn thiện Store và sản phẩm trước khi gửi Admin duyệt.</p><Link to="/seller/orders">Đơn hàng của cửa hàng</Link><p><Link to="/seller/aftersales">Xử lý hậu mãi</Link></p></div>
    <div className={styles.tabs}><button className={tab === 'store' ? styles.active : ''} onClick={() => setTab('store')}>Store</button><button className={tab === 'products' ? styles.active : ''} onClick={() => setTab('products')}>Sản phẩm ({products.length})</button><button className={tab === 'dashboard' ? styles.active : ''} onClick={() => setTab('dashboard')}>Thống kê</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success}>{message}</p>}
    {tab === 'dashboard' ? <Dashboard scope="SELLER" storeId={store?.id} /> : tab === 'store' ? <section className={styles.columns}>
      {store?.application || (!store && import.meta.env.VITE_SELLER_ONBOARDING_ENABLED==='true') ? <div className={styles.panel}><h2>Hồ sơ mở Store</h2><p>Thông tin liên hệ, địa chỉ lấy/trả hàng và lịch sử được quản lý cùng hồ sơ đã nộp.</p><Link to="/account/store-application">Mở hồ sơ Store</Link></div> : <form className={`${styles.panel} ${styles.form}`} onSubmit={saveStore}><h2>{store ? 'Thông tin Store' : 'Mở Store'}</h2><label>Tên Store<input name="name" required minLength={3} defaultValue={store?.name} /></label><label>Mô tả<textarea name="description" rows={5} defaultValue={store?.description ?? ''} /></label><button disabled={busy}>{store ? 'Lưu thay đổi' : 'Gửi yêu cầu'}</button>{store?.status === 'REJECTED' && <button type="button" className={styles.secondary} onClick={() => run(marketplaceApi.resubmitStore, 'Đã nộp lại Store.')}>Nộp lại sau chỉnh sửa</button>}</form>}
      <aside className={styles.panel}><h2>Trạng thái</h2><span className={styles.badge}>{store?.status ?? 'CHƯA TẠO'}</span><p>{store?.status === 'ACTIVE' ? 'Store đã hoạt động; bạn có thể tạo và gửi sản phẩm.' : 'Admin cần duyệt Store trước khi thao tác sản phẩm.'}</p></aside>
    </section> : <section className={styles.columns}>
      <div className={styles.panel}><h2>Sản phẩm của tôi</h2><div className={styles.list}>{products.map((item) => <div className={styles.row} key={item.id}><div><strong>{item.name}</strong><p>{item.moderationStatus} · {item.sellerStatus} · v{item.version}</p></div><div className={styles.actions}><button disabled={busy} onClick={() => selectProduct(item)}>Chỉnh sửa</button>{item.moderationStatus === 'NOT_SUBMITTED' || item.moderationStatus === 'REJECTED' ? <button disabled={busy} onClick={() => run(() => marketplaceApi.submitProduct(item.id), 'Đã gửi duyệt.')}>Gửi duyệt</button> : null}{item.moderationStatus === 'APPROVED' && item.version && <button disabled={busy} className={styles.secondary} onClick={() => run(() => marketplaceApi.visibility(item.id, item.version!, item.sellerStatus === 'HIDDEN' ? 'ACTIVE' : 'HIDDEN'), 'Đã đổi hiển thị.')}>{item.sellerStatus === 'HIDDEN' ? 'Hiện' : 'Ẩn'}</button>}</div></div>)}</div></div>
      <div className={styles.panel}><form className={styles.form} onSubmit={saveProduct} aria-label="Sản phẩm"><h2>{selected ? `Sửa #${selected.id}` : 'Tạo sản phẩm'}</h2>
        <label>Tên<input name="name" required minLength={3} disabled={busy} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>Danh mục<select name="categoryId" required disabled={busy} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}><option value="">Chọn danh mục lá</option>{leafCategories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>Thương hiệu<select name="brandId" disabled={busy} value={draft.brandId} onChange={(e) => setDraft({ ...draft, brandId: e.target.value })}><option value="">Không thương hiệu</option>{brands.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>Mô tả<textarea name="description" rows={4} disabled={busy} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        <button disabled={busy}>Lưu sản phẩm</button><button type="button" disabled={busy} onClick={() => selectProduct(null)}>Tạo mới / bỏ chỉnh sửa</button></form>
      {selected && <><form className={styles.form} onSubmit={upload}><h2>Ảnh chính</h2><input name="file" type="file" accept="image/jpeg,image/png,image/webp" required /><button disabled={busy}>Tải ảnh</button></form><form className={styles.form} onSubmit={addVariant}><h2>Phiên bản bán</h2><input name="price" inputMode="decimal" placeholder="Giá, ví dụ 199000" required /><input name="stock" type="number" min="0" placeholder="Tồn kho" required /><input name="sellerSku" placeholder="Mã Seller (tùy chọn)" /><button disabled={busy}>Thêm phiên bản</button></form><form className={styles.form} onSubmit={saveShipping}><h2>Kiện hàng</h2><input name="weight" type="number" min="1" placeholder="Khối lượng (gram)" required /><button disabled={busy}>Lưu kiện hàng</button></form></>}
      </div>
    </section>}
  </div>;
}
