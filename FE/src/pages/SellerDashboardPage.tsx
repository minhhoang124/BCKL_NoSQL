import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../services/apiClient';
import { formatPrice, marketplaceApi, mediaUrl } from '../services/marketplaceApi';
import type { Brand, Category, Product, Store } from '../types/marketplace';
import styles from './Marketplace.module.css';
import { SearchAnalytics } from '../features/SearchAnalytics';
import { Dashboard } from '../features/dashboard/Dashboard';
import { ProductDetailsEditor } from '../features/seller-listing/ProductDetailsEditor';

const flat = (nodes: Category[]): Category[] => nodes.flatMap((node) => [node, ...flat(node.children)]);
const emptyDraft = { name: '', description: '', categoryId: '', brandId: '' };

const moderationLabels: Record<string, string> = {
  NOT_SUBMITTED: 'Bản nháp (Chưa gửi duyệt)',
  PENDING: 'Chờ Admin duyệt',
  APPROVED: 'Đã duyệt công khai',
  REJECTED: 'Bị từ chối',
  FROZEN: 'Tạm đóng băng',
};

const visibilityLabels: Record<string, string> = {
  DRAFT: 'Chưa mở bán',
  ACTIVE: 'Đang bán',
  HIDDEN: 'Tạm ẩn',
};

const storeStatusLabels: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  ACTIVE: 'Đang hoạt động',
  REJECTED: 'Cần bổ sung hồ sơ',
  SUSPENDED: 'Tạm khóa',
  CLOSED: 'Đã đóng',
};

type StepKey = 'info' | 'images' | 'variants' | 'shipping' | 'submit';

// Seller product list filters (client-side over the seller's own products).
type StatusFilter = 'all' | 'live' | 'pending' | 'fix' | 'hidden' | 'draft';
type StockFilter = 'all' | 'out' | 'low';
type SortKey = 'newest' | 'oldest' | 'price-asc' | 'price-desc' | 'stock-asc' | 'name';
const LOW_STOCK = 5;
const statusTabs: Array<[StatusFilter, string]> = [
  ['all', 'Tất cả'], ['live', 'Đang bán'], ['pending', 'Chờ duyệt'], ['fix', 'Cần chỉnh sửa'], ['hidden', 'Đã ẩn'], ['draft', 'Bản nháp'],
];
const statusGroup = (item: Product): Exclude<StatusFilter, 'all'> => {
  const moderation = item.moderationStatus ?? 'NOT_SUBMITTED';
  if (moderation === 'PENDING') return 'pending';
  if (moderation === 'REJECTED' || moderation === 'FROZEN') return 'fix';
  if (item.sellerStatus === 'HIDDEN') return 'hidden';
  if (moderation === 'APPROVED') return 'live';
  return 'draft';
};
const knownStock = (item: Product): number | null => {
  const variants = item.variants ?? [];
  if (!variants.length || variants.some((v) => typeof v.stock !== 'number')) return null;
  return variants.reduce((sum, v) => sum + (v.stock as number), 0);
};
const minPrice = (item: Product): number | null => {
  const prices = (item.variants ?? []).map((v) => Number(v.price)).filter((v) => Number.isFinite(v));
  return prices.length ? Math.min(...prices) : null;
};

export function SellerDashboardPage() {
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  // 'products' = product list only; 'editor' = separate add/edit screen (no long scroll past the list).
  type Tab = 'store' | 'products' | 'editor' | 'dashboard';
  const isTab = (value: string | null): value is Tab => value === 'store' || value === 'products' || value === 'editor' || value === 'dashboard';
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const [tab, setTabState] = useState<Tab>(isTab(requested) ? requested : 'store');
  // Links from the shared seller sidebar (?tab=) switch the section; buttons keep the URL in sync.
  useEffect(() => {
    if (isTab(requested)) setTabState(requested);
  }, [requested]);
  // ?tab=editor&product=<id> reopens the same product after a reload.
  const requestedProduct = useRef(params.get('tab') === 'editor' ? Number(params.get('product')) || null : null);
  const setTab = (next: Tab, productId?: number | null) => {
    setTabState(next);
    setParams((current) => {
      const copy = new URLSearchParams(current);
      copy.set('tab', next);
      if (next === 'editor' && productId) copy.set('product', String(productId)); else copy.delete('product');
      return copy;
    }, { replace: true });
    window.scrollTo?.({ top: 0 });
  };
  const [activeStep, setActiveStep] = useState<StepKey>('info');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [missingAttributes, setMissingAttributes] = useState<string[] | null>(null);
  const [attributeCheckFailed, setAttributeCheckFailed] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const pending = useRef(false);

  const selectProduct = (product: Product | null) => {
    if (pending.current) return;
    setSelected(product);
    setActiveStep('info');
    setDraft(
      product
        ? {
            name: product.name,
            description: product.description ?? '',
            categoryId: String(product.category.id),
            brandId: product.brand ? String(product.brand.id) : '',
          }
        : emptyDraft,
    );
  };

  const openEditor = (product: Product | null) => {
    if (pending.current) return;
    selectProduct(product);
    setTab('editor', product?.id ?? null);
  };

  const leafCategories = useMemo(
    () => flat(categories).filter((item) => item.isLeaf),
    [categories],
  );

  const load = async () => {
    const [storeResult, productRows, categoryRows, brandRows] = await Promise.all([
      marketplaceApi.myStore().catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
      marketplaceApi.myProducts().catch((e) => {
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return [];
        throw e;
      }),
      marketplaceApi.categories(),
      marketplaceApi.brands(),
    ]);
    setStore(storeResult);
    setProducts(productRows);
    setCategories(categoryRows);
    setBrands(brandRows);
    setSelected((current) =>
      current ? productRows.find((item) => item.id === current.id) ?? null : null,
    );
    if (requestedProduct.current) {
      const reopened = productRows.find((item) => item.id === requestedProduct.current);
      requestedProduct.current = null;
      if (reopened) selectProduct(reopened);
    }
  };

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [error]);

  // Submit checklist: required category attributes that are not saved yet.
  useEffect(() => {
    if (activeStep !== 'submit' || !selected) return;
    let active = true;
    setMissingAttributes(null);
    setAttributeCheckFailed(false);
    marketplaceApi.categoryAttributes(selected.category.id)
      .then((schema) => {
        if (!active) return;
        const saved = new Set((selected.attributeValues ?? []).map((v) => v.attributeDefinitionId));
        setMissingAttributes(schema.attributeDefinitions.filter((d) => d.isRequired && !saved.has(d.id)).map((d) => d.name));
      })
      .catch(() => { if (active) setAttributeCheckFailed(true); });
    return () => { active = false; };
  }, [activeStep, selected]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Không thể tải kênh người bán.'),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const run = async (work: () => Promise<unknown>, success: string, onSaved?: () => void) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      onSaved?.();
      setMessage(success);
      try {
        await load();
      } catch {
        setError('Đã lưu nhưng chưa tải lại được danh sách. Vui lòng tải lại trang.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const saveStore = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get('name')),
      description: String(data.get('description') || ''),
    };
    void run(
      () => (store ? marketplaceApi.updateStore(body) : marketplaceApi.createStore(body)),
      store ? 'Đã cập nhật cửa hàng.' : 'Đã gửi yêu cầu mở cửa hàng.',
    );
  };

  const saveProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = {
      name: draft.name,
      description: draft.description,
      categoryId: Number(draft.categoryId),
      brandId: draft.brandId ? Number(draft.brandId) : null,
    };
    if (selected) {
      void run(
        () => marketplaceApi.updateProduct(selected.id, body),
        'Đã cập nhật sản phẩm.',
        () => {
          setSelected(null);
          setDraft(emptyDraft);
          setActiveStep('info');
          setTab('products');
        },
      );
    } else {
      void run(
        async () => {
          const created = await marketplaceApi.createProduct(body);
          setSelected(created);
          setTab('editor', created.id);
          setDraft({
            name: created.name,
            description: created.description ?? '',
            categoryId: String(created.category.id),
            brandId: created.brand ? String(created.brand.id) : '',
          });
          setActiveStep('images');
        },
        'Đã tạo sản phẩm nháp thành công! Hãy tiếp tục tải ảnh chính và cấu hình phân loại giá/kho.',
      );
    }
  };

  const saveShipping = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    void run(
      () =>
        marketplaceApi.shipping(selected.id, {
          packageWeightGrams: Number(data.get('weight')),
        }),
      'Đã lưu kiện hàng.',
    );
  };

  const upload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const body = new FormData(event.currentTarget);
    body.set('isPrimary', 'true');
    body.set('sortOrder', '0');
    void run(
      () => marketplaceApi.addImage(selected.id, body),
      'Đã tải ảnh chính. Bạn có thể chuyển sang bước Phân loại & Giá/Kho.',
      () => {
        setActiveStep('variants');
      },
    );
  };

  // Step 3 attributes follow the SAVED category: block other steps until a category change is saved.
  const categoryDirty = !!selected && draft.categoryId !== String(selected.category.id);
  const approvedCount = products.filter((item) => item.moderationStatus === 'APPROVED').length;
  const pendingCount = products.filter((item) => item.moderationStatus === 'PENDING').length;
  const keyword = query.trim().toLowerCase();
  const statusCounts = products.reduce<Record<StatusFilter, number>>((acc, item) => {
    acc[statusGroup(item)] += 1;
    return acc;
  }, { all: products.length, live: 0, pending: 0, fix: 0, hidden: 0, draft: 0 });
  const productCategories = [...new Map(products.map((item) => [item.category.id, item.category.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  const filtersActive = !!keyword || statusFilter !== 'all' || !!categoryFilter || stockFilter !== 'all';
  const clearFilters = () => { setQuery(''); setStatusFilter('all'); setCategoryFilter(''); setStockFilter('all'); };
  const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) =>
    a === null ? (b === null ? 0 : 1) : b === null ? -1 : (a - b) * dir;
  const visibleProducts = products
    .filter((item) => !keyword || item.name.toLowerCase().includes(keyword))
    .filter((item) => statusFilter === 'all' || statusGroup(item) === statusFilter)
    .filter((item) => !categoryFilter || String(item.category.id) === categoryFilter)
    .filter((item) => {
      if (stockFilter === 'all') return true;
      const stock = knownStock(item);
      return stock !== null && (stockFilter === 'out' ? stock === 0 : stock > 0 && stock <= LOW_STOCK);
    })
    .sort((a, b) => {
      switch (sortKey) {
        case 'oldest': return a.id - b.id;
        case 'price-asc': return nullsLast(minPrice(a), minPrice(b), 1);
        case 'price-desc': return nullsLast(minPrice(a), minPrice(b), -1);
        case 'stock-asc': return nullsLast(knownStock(a), knownStock(b), 1);
        case 'name': return a.name.localeCompare(b.name, 'vi');
        default: return b.id - a.id;
      }
    });
  const priceRange = (item: Product) => {
    const prices = (item.variants ?? []).map((v) => Number(v.price)).filter((v) => Number.isFinite(v));
    if (!prices.length) return '—';
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? formatPrice(String(min)) : `${formatPrice(String(min))} – ${formatPrice(String(max))}`;
  };
  const stockTotal = (item: Product) => {
    const variants = item.variants ?? [];
    // Only show a total when every SKU reports stock; a partial sum would look complete.
    if (!variants.length || variants.some((v) => typeof v.stock !== 'number')) return '—';
    return variants.reduce((sum, v) => sum + (v.stock as number), 0);
  };
  const statusTone = (item: Product) =>
    item.moderationStatus === 'APPROVED' ? styles.scToneOk
      : item.moderationStatus === 'REJECTED' || item.moderationStatus === 'FROZEN' ? styles.scToneBad
        : item.moderationStatus === 'PENDING' ? styles.scToneWait : styles.scToneMuted;
  const done = (ok: boolean) => <span className={ok ? styles.scCheckOk : styles.scCheckMissing}>{ok ? 'Đã xong' : 'Còn thiếu'}</span>;

  return (
    <div className={styles.scShell}>
      <aside className={styles.scSidebar} aria-label="Kênh người bán">
        <div className={styles.scStoreCard}>
          <h1>Kênh người bán</h1>
          <strong>{store?.name ?? 'Chưa có cửa hàng'}</strong>
          <span>{store ? (storeStatusLabels[store.status] ?? store.status) : 'Chưa tạo'}</span>
        </div>
        <nav className={styles.scNav}>
          <span className={styles.scNavGroup}>Sản phẩm</span>
          <button type="button" className={tab === 'products' || (tab === 'editor' && selected) ? styles.scNavActive : undefined} onClick={() => setTab('products')}>
            Sản phẩm ({products.length})
          </button>
          <button type="button" className={tab === 'editor' && !selected ? styles.scNavActive : undefined} disabled={busy} onClick={() => openEditor(null)}>
            Thêm sản phẩm mới
          </button>
          <span className={styles.scNavGroup}>Đơn hàng</span>
          <Link to="/seller/orders">Đơn hàng của cửa hàng</Link>
          <Link to="/seller/aftersales">Xử lý hậu mãi</Link>
          {import.meta.env.VITE_PRODUCT_REVIEWS_ENABLED === 'true' && <Link to="/seller/reviews">Phản hồi đánh giá</Link>}
          <span className={styles.scNavGroup}>Cửa hàng</span>
          <button type="button" className={tab === 'store' ? styles.scNavActive : undefined} onClick={() => setTab('store')}>
            Cửa hàng
          </button>
          <button type="button" className={tab === 'dashboard' ? styles.scNavActive : undefined} onClick={() => setTab('dashboard')}>
            Thống kê
          </button>
        </nav>
      </aside>

      <div className={styles.scMain}>
        {error && <p ref={errorRef} className={styles.error} role="alert">{error}</p>}
        {message && <p className={styles.success}>{message}</p>}

        {tab === 'dashboard' ? (
          <>
            <Dashboard scope="SELLER" storeId={store?.id} />
            <SearchAnalytics scope="SELLER" />
          </>
        ) : tab === 'store' ? (
          <section className={styles.scCard}>
            <div className={styles.scCardHead}>
              <h2>{store?.application || (!store && import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === 'true') ? 'Hồ sơ mở cửa hàng' : store ? 'Thông tin cửa hàng' : 'Mở cửa hàng'}</h2>
              <span className={styles.scStatus}>{store ? (storeStatusLabels[store.status] ?? store.status) : 'Chưa tạo'}</span>
            </div>
            {store?.application || (!store && import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === 'true') ? (
              <div className={styles.scBody}>
                <p>Thông tin liên hệ, địa chỉ lấy/trả hàng và lịch sử được quản lý cùng hồ sơ đã nộp.</p>
                <Link className={styles.scSecondaryLink} to="/account/store-application">Mở hồ sơ cửa hàng</Link>
              </div>
            ) : (
              <form className={styles.scForm} onSubmit={saveStore}>
                <label className={styles.scRow}>
                  <span>Tên cửa hàng</span>
                  <input name="name" required minLength={3} defaultValue={store?.name} />
                </label>
                <label className={styles.scRow}>
                  <span>Mô tả</span>
                  <textarea name="description" rows={5} defaultValue={store?.description ?? ''} />
                </label>
                <p className={styles.scRowNote}>
                  {store?.status === 'ACTIVE'
                    ? 'Cửa hàng đã hoạt động; bạn có thể tạo và gửi sản phẩm.'
                    : 'Cửa hàng cần được duyệt trước khi thêm sản phẩm.'}
                </p>
                <div className={styles.scActionsRow}>
                  {store?.status === 'REJECTED' && (
                    <button type="button" className={styles.scSecondary} onClick={() => run(marketplaceApi.resubmitStore, 'Đã nộp lại hồ sơ cửa hàng.')}>
                      Nộp lại sau chỉnh sửa
                    </button>
                  )}
                  <button className={styles.scPrimary} disabled={busy}>{store ? 'Lưu thay đổi' : 'Gửi yêu cầu'}</button>
                </div>
              </form>
            )}
          </section>
        ) : tab === 'products' ? (
            <section className={styles.scCard}>
              <div className={styles.scCardHead}>
                <div>
                  <h2>Sản phẩm của tôi</h2>
                  <p className={styles.scMuted}>{products.length} sản phẩm · {approvedCount} đã duyệt · {pendingCount} chờ duyệt</p>
                </div>
                <div className={styles.scToolbar}>
                  <button type="button" className={styles.scPrimary} disabled={busy} onClick={() => openEditor(null)}>+ Thêm sản phẩm mới</button>
                </div>
              </div>
              <div className={styles.scStatusTabs} role="group" aria-label="Lọc theo trạng thái">
                {statusTabs.map(([key, label]) => (
                  <button type="button" key={key} aria-pressed={statusFilter === key} className={statusFilter === key ? styles.scStatusTabActive : undefined} onClick={() => setStatusFilter(key)}>
                    {label} <span>({statusCounts[key]})</span>
                  </button>
                ))}
              </div>
              <div className={styles.scFilterBar}>
                <input type="search" aria-label="Tìm sản phẩm của tôi" placeholder="Tìm theo tên sản phẩm" value={query} onChange={(e) => setQuery(e.target.value)} />
                <select aria-label="Lọc theo danh mục" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="">Tất cả danh mục</option>
                  {productCategories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select aria-label="Lọc theo tồn kho" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)}>
                  <option value="all">Mọi mức tồn kho</option>
                  <option value="out">Hết hàng</option>
                  <option value="low">Sắp hết (≤ {LOW_STOCK})</option>
                </select>
                <select aria-label="Sắp xếp sản phẩm" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  <option value="newest">Mới nhất</option>
                  <option value="oldest">Cũ nhất</option>
                  <option value="price-asc">Giá thấp → cao</option>
                  <option value="price-desc">Giá cao → thấp</option>
                  <option value="stock-asc">Tồn kho ít nhất</option>
                  <option value="name">Tên A → Z</option>
                </select>
                {filtersActive && <button type="button" className={styles.scLinkBtn} onClick={clearFilters}>Xóa bộ lọc</button>}
                <span className={styles.scMuted} role="status">{visibleProducts.length}/{products.length} sản phẩm</span>
              </div>
              <div className={styles.scTableWrap}>
                <table className={styles.scTable}>
                  <thead>
                    <tr><th>Tên sản phẩm</th><th>Phân loại</th><th>Giá</th><th>Kho</th><th>Trạng thái</th><th>Thao tác</th></tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((item) => {
                      const cover = item.images?.find((img) => img.isPrimary) ?? item.images?.[0];
                      return (
                        <tr key={item.id} className={selected?.id === item.id ? styles.scRowActive : undefined}>
                          <td className={styles.scProductCell}>
                            {cover ? <img src={mediaUrl(cover.url)} alt="" /> : <span className={styles.scThumbEmpty} aria-hidden="true" />}
                            <strong>{item.name}</strong>
                            <small>{item.category?.name}</small>
                          </td>
                          <td>{item.variants?.length ?? 0}</td>
                          <td>{priceRange(item)}</td>
                          <td>{stockTotal(item)}</td>
                          <td>
                            <span className={`${styles.scStatus} ${statusTone(item)}`}>
                              {item.moderationStatus ? (moderationLabels[item.moderationStatus] ?? item.moderationStatus) : 'Bản nháp'}
                            </span>
                            <small className={styles.scMutedBlock}>{item.sellerStatus ? (visibilityLabels[item.sellerStatus] ?? item.sellerStatus) : 'Đang bán'}</small>
                          </td>
                          <td>
                            <div className={styles.scRowActions}>
                              <button type="button" disabled={busy} className={styles.scLinkBtn} onClick={() => openEditor(item)}>Chỉnh sửa</button>
                              {(item.moderationStatus === 'NOT_SUBMITTED' || item.moderationStatus === 'REJECTED') && (
                                <button type="button" disabled={busy} className={styles.scLinkBtn} aria-label={`Gửi duyệt ${item.name}`}
                                  onClick={() => run(() => marketplaceApi.submitProduct(item.id), 'Đã gửi duyệt.')}>Gửi duyệt</button>
                              )}
                              {item.moderationStatus === 'APPROVED' && item.version && (
                                <button type="button" disabled={busy} className={styles.scLinkBtn}
                                  onClick={() => run(() => marketplaceApi.visibility(item.id, item.version!, item.sellerStatus === 'HIDDEN' ? 'ACTIVE' : 'HIDDEN'), 'Đã đổi hiển thị.')}>
                                  {item.sellerStatus === 'HIDDEN' ? 'Hiện' : 'Ẩn'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {products.length === 0 && <p className={styles.scEmpty}>Chưa có sản phẩm nào. Bấm “+ Thêm sản phẩm mới” để tạo sản phẩm đầu tiên.</p>}
                {products.length > 0 && visibleProducts.length === 0 && <p className={styles.scEmpty}>Không có sản phẩm phù hợp bộ lọc. <button type="button" className={styles.scLinkBtn} onClick={clearFilters}>Xóa bộ lọc</button></p>}
              </div>
            </section>
        ) : (
            <section className={styles.scCard} aria-label="Soạn sản phẩm">
              <div className={styles.scCardHead}>
                <div>
                  <button type="button" className={styles.scBackLink} disabled={busy} onClick={() => setTab('products')}>← Danh sách sản phẩm</button>
                  <h2>{selected ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm mới'}</h2>
                  {selected && (
                    <p className={styles.scMuted}>
                      {selected.name} · Mã #{selected.id} · {moderationLabels[selected.moderationStatus ?? 'NOT_SUBMITTED'] ?? selected.moderationStatus}
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.scSteps} role="tablist">
                <button type="button" className={activeStep === 'info' ? styles.scStepActive : undefined} onClick={() => setActiveStep('info')}>1. Thông tin cơ bản</button>
                <button type="button" className={activeStep === 'images' ? styles.scStepActive : undefined} disabled={!selected || categoryDirty} onClick={() => setActiveStep('images')} title={categoryDirty ? 'Lưu sản phẩm để áp dụng danh mục mới' : !selected ? 'Lưu thông tin cơ bản trước khi tải ảnh' : ''}>2. Ảnh sản phẩm</button>
                <button type="button" className={activeStep === 'variants' ? styles.scStepActive : undefined} disabled={!selected || categoryDirty} onClick={() => setActiveStep('variants')} title={categoryDirty ? 'Lưu sản phẩm để áp dụng danh mục mới' : !selected ? 'Lưu thông tin cơ bản trước khi cấu hình phân loại' : ''}>3. Phân loại &amp; Giá/Kho</button>
                <button type="button" className={activeStep === 'shipping' ? styles.scStepActive : undefined} disabled={!selected || categoryDirty} onClick={() => setActiveStep('shipping')} title={categoryDirty ? 'Lưu sản phẩm để áp dụng danh mục mới' : !selected ? 'Lưu thông tin cơ bản trước khi cấu hình vận chuyển' : ''}>4. Kiện hàng</button>
                {selected && <button type="button" className={activeStep === 'submit' ? styles.scStepActive : undefined} disabled={categoryDirty} onClick={() => setActiveStep('submit')}>5. Gửi duyệt</button>}
              </div>

              <div hidden={activeStep !== 'info'}>
                <form className={styles.scForm} onSubmit={saveProduct} aria-label="Sản phẩm">
                  <h3>1. Thông tin cơ bản</h3>
                  <div className={styles.scRow}>
                    <label htmlFor="seller-product-name">Tên</label>
                    <span className={styles.scCounted}>
                      <input id="seller-product-name" name="name" required minLength={3} maxLength={240} disabled={busy} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                      <small aria-hidden="true">{draft.name.length}/240</small>
                    </span>
                  </div>
                  <label className={styles.scRow}>
                    <span>Danh mục</span>
                    <select name="categoryId" required disabled={busy} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                      <option value="">Chọn danh mục lá</option>
                      {leafCategories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  {categoryDirty && <p className={styles.scRowNote} role="status">Danh mục đã đổi nhưng chưa lưu. Bấm “Lưu sản phẩm” để cập nhật thuộc tính theo danh mục mới.</p>}
                  <label className={styles.scRow}>
                    <span>Thương hiệu</span>
                    <select name="brandId" disabled={busy} value={draft.brandId} onChange={(e) => setDraft({ ...draft, brandId: e.target.value })}>
                      <option value="">Không thương hiệu</option>
                      {brands.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label className={styles.scRow}>
                    <span>Mô tả</span>
                    <textarea name="description" rows={6} disabled={busy} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </label>
                  <div className={styles.scActionsRow}>
                    {selected && <button type="button" className={styles.scSecondary} disabled={busy} onClick={() => openEditor(null)}>Tạo mới / bỏ chỉnh sửa</button>}
                    <button className={styles.scPrimary} disabled={busy}>Lưu sản phẩm</button>
                  </div>
                </form>
              </div>

              {selected && (
                <div hidden={activeStep !== 'images'}>
                  <form className={styles.scForm} onSubmit={upload}>
                    <h3>2. Ảnh đại diện sản phẩm</h3>
                    <div className={styles.scRow}>
                      <span>Ảnh sản phẩm</span>
                      <div>
                        <div className={styles.scImageGrid}>
                          {(selected.images ?? []).map((img, index, all) => {
                            const coverIndex = Math.max(0, all.findIndex((x) => x.isPrimary));
                            return (
                              <figure key={img.id}>
                                <img src={mediaUrl(img.url)} alt="" />
                                <figcaption>{index === coverIndex ? 'Ảnh bìa' : `Ảnh ${index + 1}`}</figcaption>
                              </figure>
                            );
                          })}
                        </div>
                        <input name="file" type="file" aria-label="Chọn ảnh sản phẩm" accept="image/jpeg,image/png,image/webp" required disabled={busy} />
                        <p className={styles.scRowNote}>Định dạng JPEG, PNG hoặc WebP, tối đa 5MB. Ảnh mới tải lên được đặt làm ảnh bìa.</p>
                      </div>
                    </div>
                    <div className={styles.scActionsRow}>
                      <button type="button" className={styles.scSecondary} onClick={() => setActiveStep('variants')}>Bỏ qua bước ảnh sang Phân loại ›</button>
                      <button className={styles.scPrimary} disabled={busy}>Tải ảnh &amp; tiếp tục</button>
                    </div>
                  </form>
                </div>
              )}

              {selected && (
                <div hidden={activeStep !== 'variants'} className={styles.scStepBody}>
                  <h3>3. Phân loại, Thuộc tính &amp; Giá/Kho SKU</h3>
                  <ProductDetailsEditor
                    key={selected.id}
                    product={selected}
                    busy={busy}
                    run={run}
                    onInventoryChanged={(fresh) => {
                      setProducts((rows) => rows.map((row) => (row.id === fresh.id ? fresh : row)));
                      setSelected((current) => (current?.id === fresh.id ? fresh : current));
                    }}
                  />
                  <div className={styles.scActionsRow}>
                    <button type="button" className={styles.scSecondary} onClick={() => setActiveStep('shipping')}>Tiếp tục sang bước Kiện hàng ›</button>
                  </div>
                </div>
              )}

              {selected && (
                <div hidden={activeStep !== 'shipping'}>
                  <form className={styles.scForm} onSubmit={saveShipping}>
                    <h3>4. Thông tin kiện hàng &amp; Vận chuyển</h3>
                    <div className={styles.scRow}>
                      <label htmlFor="seller-package-weight">Khối lượng kiện hàng đóng gói (gram) *</label>
                      <span className={styles.scUnitInput}>
                        <input id="seller-package-weight" name="weight" type="number" min="1" placeholder="Ví dụ: 500" required disabled={busy} defaultValue={selected.shippingProfile?.packageWeightGrams ?? ''} />
                        <small aria-hidden="true">gr</small>
                      </span>
                    </div>
                    <p className={styles.scRowNote}>Khối lượng sau khi đóng gói, bắt buộc trước khi gửi duyệt.</p>
                    <div className={styles.scActionsRow}>
                      <button type="button" className={styles.scSecondary} onClick={() => setActiveStep('submit')}>Tiếp tục sang bước Kiểm tra &amp; Gửi duyệt ›</button>
                      <button className={styles.scPrimary} disabled={busy}>Lưu kiện hàng</button>
                    </div>
                  </form>
                </div>
              )}

              {selected && (
                <div hidden={activeStep !== 'submit'} className={styles.scStepBody}>
                  <h3>5. Kiểm tra &amp; gửi duyệt</h3>
                  <ul className={styles.scChecklist}>
                    <li><span>Thông tin cơ bản</span><span>{selected.name} · {selected.category.name}</span>{done(true)}</li>
                    <li><span>Ảnh sản phẩm</span><span>{selected.images?.length ? `${selected.images.length} ảnh` : 'Chưa có ảnh chính'}</span>{done(!!selected.images?.length)}</li>
                    <li><span>Thuộc tính bắt buộc</span><span>{attributeCheckFailed ? 'Không kiểm tra được; mở bước 3 để xem thuộc tính' : missingAttributes === null ? 'Đang kiểm tra…' : missingAttributes.length ? `Chưa lưu: ${missingAttributes.join(', ')}` : 'Đã lưu đủ'}</span>{done(missingAttributes !== null && missingAttributes.length === 0)}</li>
                    <li><span>Phân loại &amp; Giá/Kho</span><span>{selected.variants?.length ? `${selected.variants.length} SKU` : 'Chưa tạo phân loại hàng'}</span>{done(!!selected.variants?.length)}</li>
                    <li><span>Kiện hàng</span><span>{selected.shippingProfile?.packageWeightGrams ? `${selected.shippingProfile.packageWeightGrams} gr` : 'Chưa lưu khối lượng'}</span>{done(!!selected.shippingProfile?.packageWeightGrams)}</li>
                  </ul>
                  <div className={styles.scActionsRow}>
                    {selected.moderationStatus === 'NOT_SUBMITTED' || selected.moderationStatus === 'REJECTED' ? (
                      <button type="button" className={styles.scPrimary} disabled={busy}
                        onClick={() => run(() => marketplaceApi.submitProduct(selected.id), 'Đã gửi duyệt sản phẩm. Sản phẩm sẽ hiển thị trên sàn sau khi được duyệt.')}>
                        Gửi duyệt
                      </button>
                    ) : selected.moderationStatus === 'PENDING' ? (
                      <p className={styles.scRowNote}>Sản phẩm đang trong hàng đợi kiểm duyệt của Admin.</p>
                    ) : (
                      <p className={styles.scRowNote}>Sản phẩm đã được duyệt và đang hoạt động trên sàn.</p>
                    )}
                  </div>
                </div>
              )}
            </section>
        )}
      </div>
    </div>
  );
}
