import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { ApiError, fetchApi } from '../services/apiClient';
import { useAuth } from '../contexts/useAuth';
import { mediaUrl } from '../services/marketplaceApi';
import { AdminBrandEditor } from '../features/admin-brands/AdminBrandEditor';
import styles from './AdminDashboardPage.module.css';
import { AdminAccountsReader } from '../features/admin-accounts/AdminAccountsReader';
import { AdminAccountStatusWorkspace } from '../features/admin-accounts/AdminAccountStatusWorkspace';
import { createAccountReadApi } from '../features/admin-accounts/accountReadApi';
import { AdminSystemHealth } from '../features/admin-system-health/AdminSystemHealth';
import { createSystemHealthApi } from '../features/admin-system-health/systemHealthApi';
import { Dashboard } from '../features/dashboard/Dashboard';

const accountsReadApi = createAccountReadApi();
const systemHealthApi = createSystemHealthApi();

type ProductQueueItem = {
  id: number;
  name: string;
  storeId: number;
  version: number;
  submittedAt: string | null;
  sellerStatus: string;
  moderationStatus: string;
};
type ProductPage = { items: ProductQueueItem[]; nextCursor: number | null };
type ProductDetail = ProductQueueItem & {
  description?: string | null;
  store?: { name?: string; seller?: { email?: string } };
  category?: { name?: string };
  brand?: { name?: string } | null;
  images?: Array<{ id: number; url: string; isPrimary: boolean }>;
  shippingProfile?: { packageWeightGrams: number | null; packageLengthCm: string | number | null; packageWidthCm: string | number | null; packageHeightCm: string | number | null } | null;
  attributeValues?: Array<{ id: number; attributeDefinition: { name: string }; option?: { value: string } | null; textValue: string | null; numberValue: string | number | null; booleanValue: boolean | null }>;
  optionGroups?: Array<{ id: number; name: string; values: Array<{ id: number; value: string }> }>;
  variants?: Array<{
    id: number;
    skuCode: string;
    sellerSku?: string | null;
    price: string | number;
    stock: number;
    isActive: boolean;
    optionValueLinks?: Array<{ optionValueId: number; optionGroupId: number }>;
  }>;
  statusHistory?: Array<{
    id: number;
    version: number;
    toModerationStatus?: string;
    reason?: string | null;
    createdAt?: string;
  }>;
};
type StoreRecord = {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  seller?: { email?: string; fullName?: string | null };
  statusHistory?: Array<{
    fromStatus?: string;
    toStatus: string;
    reason: string;
    createdAt: string;
  }>;
};
type Category = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  isActive: boolean;
};
type Brand = { id: number; name: string; slug: string; isActive: boolean };
type Toast = { kind: 'success' | 'error'; message: string } | null;

// Invalidates earlier reads on refresh, route changes and unmount (also StrictMode).
function useReadSequence() {
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const nextRead = useCallback(() => ++sequence.current, []);
  const isCurrent = useCallback((request: number) => request === sequence.current, []);
  return { nextRead, isCurrent };
}

const navItems = [
  { to: '/admin', label: 'Tổng quan', icon: '▦', end: true },
  { to: '/admin/products', label: 'Duyệt sản phẩm', icon: '◇' },
  { to: '/admin/stores', label: 'Cửa hàng', icon: '⌂' },
  { to: '/admin/catalog', label: 'Danh mục & thương hiệu', icon: '▤' },
  { to: '/admin/users', label: 'Tài khoản', icon: '◎' },
  { to: '/admin/system-health', label: 'Sức khỏe hệ thống', icon: '◉' },
  { to: '/admin/returns', label: 'Hậu mãi', icon: '↺', disabled: true },
];

async function readError(error: unknown) {
  if (error instanceof ApiError && error.status === 401)
    return 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.';
  if (error instanceof ApiError && error.status === 403)
    return 'Tài khoản hiện tại không có quyền thực hiện thao tác này.';
  return error instanceof Error
    ? error.message
    : 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.pageHeading}>
      <div>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function Notice({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className={styles.errorBox} role="alert">
      <span>{error}</span>
      {onRetry && (
        <button className={styles.textButton} onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}

function OverviewPage() {
  const { nextRead, isCurrent } = useReadSequence();
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({
    pendingProducts: 0,
    productsHasMore: false,
    pendingStores: 0,
    productsLoaded: false,
    storesLoaded: false,
  });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const request = nextRead();
    setLoading(true);
    setError('');
    const [products, stores] = await Promise.allSettled([
      fetchApi<ProductPage>('/admin/products/review-queue?limit=50'),
      fetchApi<StoreRecord[]>('/admin/stores'),
    ]);
    if (!isCurrent(request)) return;
    setLoading(false);
    setCounts({
      pendingProducts:
        products.status === 'fulfilled' ? products.value.items.length : 0,
      productsHasMore:
        products.status === 'fulfilled' && products.value.nextCursor !== null,
      pendingStores:
        stores.status === 'fulfilled'
          ? stores.value.filter((store) => store.status === 'PENDING').length
          : 0,
      productsLoaded: products.status === 'fulfilled',
      storesLoaded: stores.status === 'fulfilled',
    });
    if (products.status === 'rejected' || stores.status === 'rejected')
      setError(
        'Một số số liệu chưa tải được. Bạn vẫn có thể mở từng mục để thử lại.',
      );
  }, [nextRead, isCurrent]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <PageHeading
        eyebrow="TRUNG TÂM ĐIỀU HÀNH"
        title="Tổng quan"
        description="Theo dõi các yêu cầu cần xử lý và tình trạng quản trị hệ thống."
        action={
          <button
            className={styles.secondaryButton}
            onClick={() => void load()}
          >
            ↻　Làm mới
          </button>
        }
      />
      {error && <Notice error={error} onRetry={() => void load()} />}
      {loading && <p role="status">Đang tải số liệu…</p>}
      <div className={styles.statGrid} aria-busy={loading}>
        <Link to="/admin/products" className={styles.statCard}>
          <span className={styles.statIcon}>◇</span>
          <span className={styles.statLabel}>Sản phẩm chờ duyệt</span>
          <strong>
            {counts.productsLoaded
              ? `${counts.pendingProducts}${counts.productsHasMore ? '+' : ''}`
              : '—'}
          </strong>
          <span className={styles.statHint}>
            {counts.productsLoaded
              ? counts.productsHasMore
                ? 'Có thêm yêu cầu trong hàng chờ'
                : 'Đang chờ Admin xem xét'
              : 'Không tải được số liệu'}
          </span>
        </Link>
        <Link to="/admin/stores" className={styles.statCard}>
          <span className={`${styles.statIcon} ${styles.statIconYellow}`}>
            ⌂
          </span>
          <span className={styles.statLabel}>Cửa hàng chờ duyệt</span>
          <strong>{counts.storesLoaded ? counts.pendingStores : '—'}</strong>
          <span className={styles.statHint}>
            {counts.storesLoaded
              ? 'Yêu cầu mở cửa hàng'
              : 'Không tải được số liệu'}
          </span>
        </Link>
        <Link to="/admin/catalog" className={styles.statCard}>
          <span className={`${styles.statIcon} ${styles.statIconGreen}`}>
            ▤
          </span>
          <span className={styles.statLabel}>Danh mục & thương hiệu</span>
          <strong>Quản lý</strong>
          <span className={styles.statHint}>Cập nhật dữ liệu catalog</span>
        </Link>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <h2>Việc cần xử lý</h2>
            <p>Các tác vụ đang được Backend hỗ trợ</p>
          </div>
          {counts.productsLoaded && counts.storesLoaded && (
            <span className={styles.liveBadge}>
              <i /> Đã tải dữ liệu
            </span>
          )}
        </div>
        <div className={styles.taskRows}>
          <Link to="/admin/products" className={styles.taskRow}>
            <span className={styles.taskSymbol}>◇</span>
            <span>
              <b>Kiểm duyệt sản phẩm</b>
              <small>Xem nội dung, biến thể và quyết định duyệt</small>
            </span>
            <span className={styles.rowCount}>
              {counts.productsLoaded ? counts.pendingProducts : '—'}
            </span>
            <span className={styles.chevron}>›</span>
          </Link>
          <Link to="/admin/stores" className={styles.taskRow}>
            <span className={`${styles.taskSymbol} ${styles.orange}`}>⌂</span>
            <span>
              <b>Xét duyệt cửa hàng</b>
              <small>Duyệt, từ chối hoặc tạm khóa theo trạng thái</small>
            </span>
            <span className={styles.rowCount}>
              {counts.storesLoaded ? counts.pendingStores : '—'}
            </span>
            <span className={styles.chevron}>›</span>
          </Link>
        </div>
      </section>
      <Dashboard scope="ADMIN" />
    </>
  );
}

function ProductQueuePage() {
  const { nextRead, isCurrent } = useReadSequence();
  const [items, setItems] = useState<ProductQueueItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const load = useCallback(async (afterId?: number | null, append = false) => {
    const request = nextRead();
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (afterId) query.set('afterId', String(afterId));
      const page = await fetchApi<ProductPage>(
        `/admin/products/review-queue?${query}`,
      );
      if (!isCurrent(request)) return;
      setItems((previous) =>
        append ? [...previous, ...page.items] : page.items,
      );
      setCursor(page.nextCursor);
    } catch (caught) {
      if (!isCurrent(request)) return;
      if (!append) { setItems([]); setCursor(null); }
      setError(await readError(caught));
    } finally {
      if (isCurrent(request)) setLoading(false);
    }
  }, [nextRead, isCurrent]);
  useEffect(() => {
    void load();
  }, [load]);
  const filtered = items.filter((item) =>
    `${item.id} ${item.name} ${item.storeId}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="KIỂM DUYỆT"
        title="Duyệt sản phẩm"
        description="Kiểm tra thông tin sản phẩm đang chờ trước khi cho phép xuất hiện công khai."
        action={
          <button
            className={styles.secondaryButton}
            onClick={() => void load()}
          >
            ↻　Làm mới
          </button>
        }
      />
      <div className={styles.toolbar}>
        <label className={styles.searchBox}>
          <span>⌕</span>
          <input
            aria-label="Tìm sản phẩm"
            placeholder="Tìm theo tên, mã sản phẩm hoặc cửa hàng"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <span className={styles.resultsCount}>
          {items.length} yêu cầu đã tải
        </span>
      </div>
      {error && <Notice error={error} onRetry={() => void load()} />}
      <section className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>SẢN PHẨM</th>
                <th>MÃ SẢN PHẨM</th>
                <th>CỬA HÀNG</th>
                <th>GỬI DUYỆT</th>
                <th>TRẠNG THÁI</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className={styles.productCell}>
                      <span className={styles.productThumb}>▧</span>
                      <b>{item.name}</b>
                    </div>
                  </td>
                  <td>#{item.id}</td>
                  <td>#{item.storeId}</td>
                  <td>
                    {item.submittedAt
                      ? new Date(item.submittedAt).toLocaleDateString('vi-VN')
                      : '—'}
                  </td>
                  <td>
                    <span className={styles.statusPill}>
                      <i /> Chờ duyệt
                    </span>
                  </td>
                  <td>
                    <Link
                      className={styles.primarySmall}
                      to={`/admin/products/${item.id}`}
                    >
                      Xem xét　›
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className={styles.emptyState}>
                      <span>◇</span>
                      <b>
                        {search
                          ? 'Không tìm thấy sản phẩm phù hợp'
                          : 'Chưa có sản phẩm chờ duyệt'}
                      </b>
                      <small>
                        {search
                          ? 'Thử từ khóa khác.'
                          : 'Các sản phẩm mới gửi sẽ xuất hiện tại đây.'}
                      </small>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && (
          <div className={styles.loadingLine}>Đang tải danh sách…</div>
        )}
        {cursor && (
          <div className={styles.tableFooter}>
            <button
              className={styles.secondaryButton}
              disabled={loading}
              onClick={() => void load(cursor, true)}
            >
              Tải thêm
            </button>
          </div>
        )}
      </section>
      <p className={styles.caption}>
        Danh sách được lấy trực tiếp từ hàng chờ Backend. Quyết định duyệt yêu
        cầu dùng đúng phiên bản nội dung đang hiển thị.
      </p>
    </>
  );
}

function ProductReviewPage({ notify }: { notify: (toast: Toast) => void }) {
  const { productId } = useParams();
  return <ProductReviewContent key={productId} notify={notify} />;
}

function ProductReviewContent({ notify }: { notify: (toast: Toast) => void }) {
  const { nextRead, isCurrent } = useReadSequence();
  const mutation = useRef(false);
  const [needsReload, setNeedsReload] = useState(false);
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    if (mutation.current) return;
    const request = nextRead();
    setLoading(true);
    setProduct(null);
    setError('');
    try {
      const next = await fetchApi<ProductDetail>(`/admin/products/${productId}`);
      if (!isCurrent(request)) return;
      setProduct(next);
      setNeedsReload(false);
    } catch (caught) {
      if (!isCurrent(request)) return;
      setError(await readError(caught));
    } finally {
      if (isCurrent(request)) setLoading(false);
    }
  }, [productId, nextRead, isCurrent]);
  useEffect(() => {
    void load();
  }, [load]);
  const decide = async (decision: 'approve' | 'reject' | 'freeze') => {
    if (!product || mutation.current || needsReload || loading || String(product.id) !== productId) return;
    if (decision !== 'approve' && reason.trim().length < 1) {
      setError('Vui lòng ghi lý do cho quyết định này.');
      return;
    }
    if (!window.confirm(`Xác nhận ${decision === 'approve' ? 'duyệt' : decision === 'reject' ? 'từ chối' : 'đóng băng'} sản phẩm #${product.id}, phiên bản ${product.version}?`)) return;
    mutation.current = true;
    const request = nextRead();
    setBusy(true);
    setError('');
    try {
      await fetchApi(`/admin/products/${product.id}/${decision}`, {
        method: 'POST',
        body: JSON.stringify(
          decision === 'approve'
            ? { version: product.version }
            : { version: product.version, reason: reason.trim() },
        ),
      });
      if (!isCurrent(request)) return;
      notify({
        kind: 'success',
        message:
          decision === 'approve'
            ? 'Đã duyệt sản phẩm.'
            : decision === 'reject'
              ? 'Đã yêu cầu chỉnh sửa sản phẩm.'
              : 'Đã đóng băng sản phẩm.',
      });
      navigate('/admin/products');
    } catch (caught) {
      if (!isCurrent(request)) return;
      setNeedsReload(true);
      const message = await readError(caught);
      setError(
        caught instanceof ApiError && caught.status === 409
          ? `${message} Nội dung vừa thay đổi; hãy tải lại và kiểm tra trước khi quyết định.`
          : message,
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const images = product?.images ?? [];
  if (loading)
    return (
      <>
        <PageHeading
          eyebrow="KIỂM DUYỆT"
          title="Chi tiết sản phẩm"
          description="Đang tải dữ liệu trực tiếp từ hệ thống."
        />
        <div className={styles.loadingCard}>Đang tải hồ sơ sản phẩm…</div>
      </>
    );
  return (
    <>
      <Link to="/admin/products" className={styles.backLink}>
        ‹　Quay lại hàng chờ
      </Link>
      <PageHeading
        eyebrow={`SẢN PHẨM #${productId}`}
        title={product?.name ?? 'Chi tiết sản phẩm'}
        description="Đối chiếu nội dung, hình ảnh và thông tin biến thể trước khi ra quyết định."
      />
      {error && <Notice error={error} onRetry={busy ? undefined : () => void load()} />}
      {!product ? (
        <section className={styles.panel}>
          <div className={styles.emptyState}>
            <b>Không tải được sản phẩm</b>
            <small>Kiểm tra kết nối hoặc tải lại trang.</small>
            <button
              className={styles.secondaryButton}
              onClick={() => void load()}
            >
              Thử lại
            </button>
          </div>
        </section>
      ) : (
        <div className={styles.reviewGrid}>
          <div className={styles.reviewMain}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Hình ảnh sản phẩm</h2>
                  <p>{images.length} ảnh trong hồ sơ</p>
                </div>
              </div>
              <div className={styles.imageGrid}>
                {images.length ? (
                  images.map((image, index) => (
                    <div key={image.id} className={styles.reviewImage}>
                      <img
                        src={mediaUrl(image.url)}
                        alt={`${product.name} ${index + 1}`}
                      />
                      {image.isPrimary && <em>Ảnh chính</em>}
                    </div>
                  ))
                ) : (
                  <div className={styles.imagePlaceholder}>
                    Không có ảnh hiển thị
                  </div>
                )}
              </div>
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Thông tin mô tả</h2>
                  <p>Nội dung người bán đã gửi kiểm duyệt</p>
                </div>
                <span className={styles.statusPill}>
                  <i /> {product.moderationStatus}
                </span>
              </div>
              <dl className={styles.detailList}>
                <div>
                  <dt>Cửa hàng</dt>
                  <dd>{product.store?.name ?? `#${product.storeId}`}</dd>
                </div>
                <div>
                  <dt>Người bán</dt>
                  <dd>{product.store?.seller?.email ?? '—'}</dd>
                </div>
                <div>
                  <dt>Danh mục</dt>
                  <dd>{product.category?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt>Thương hiệu</dt>
                  <dd>{product.brand?.name ?? 'Chưa xác định'}</dd>
                </div>
                <div className={styles.fullRow}>
                  <dt>Mô tả</dt>
                  <dd className={styles.description}>
                    {product.description || 'Chưa có mô tả.'}
                  </dd>
                </div>
              </dl>
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Biến thể & giá bán</h2>
                  <p>Giá và tồn kho được lưu theo từng biến thể</p>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>GIÁ</th>
                      <th>TỒN KHO</th>
                      <th>TRẠNG THÁI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(product.variants ?? []).map((variant) => (
                      <tr key={variant.id}>
                        <td>
                          {variant.skuCode || `Variant #${variant.id}`}
                          {variant.sellerSku && <div>SKU người bán: {variant.sellerSku}</div>}
                          <div>{(variant.optionValueLinks ?? []).map((link) => {
                            const group = product.optionGroups?.find((g) => g.id === link.optionGroupId);
                            return `${group?.name ?? link.optionGroupId}: ${group?.values.find((v) => v.id === link.optionValueId)?.value ?? link.optionValueId}`;
                          }).join(' · ') || 'Biến thể mặc định'}</div>
                        </td>
                        <td>
                          {Number(variant.price).toLocaleString('vi-VN')} ₫
                        </td>
                        <td>{variant.stock}</td>
                        <td>{variant.isActive ? 'Đang hoạt động' : 'Tắt'}</td>
                      </tr>
                    ))}
                    {!product.variants?.length && (
                      <tr>
                        <td colSpan={4}>Chưa có thông tin biến thể.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHead}><h2>Thuộc tính & kiện hàng</h2></div>
              <dl className={styles.detailList}>
                {(product.attributeValues ?? []).map((attribute) => (
                  <div key={attribute.id}><dt>{attribute.attributeDefinition.name}</dt><dd>{attribute.option?.value ?? attribute.textValue ?? attribute.numberValue ?? (attribute.booleanValue == null ? '—' : attribute.booleanValue ? 'Có' : 'Không')}</dd></div>
                ))}
                <div><dt>Khối lượng (g)</dt><dd>{product.shippingProfile?.packageWeightGrams ?? 'Chưa có'}</dd></div>
                <div><dt>Dài × rộng × cao (cm)</dt><dd>{product.shippingProfile ? [product.shippingProfile.packageLengthCm, product.shippingProfile.packageWidthCm, product.shippingProfile.packageHeightCm].map((v) => v ?? '—').join(' × ') : 'Chưa có'}</dd></div>
              </dl>
            </section>
          </div>
          <aside className={styles.reviewAside}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Quyết định kiểm duyệt</h2>
                  <p>Phiên bản nội dung: v{product.version}</p>
                </div>
              </div>
              <label className={styles.fieldLabel} htmlFor="moderation-reason">
                Ghi chú / lý do
              </label>
              <textarea
                id="moderation-reason"
                className={styles.textarea}
                rows={4}
                maxLength={1000}
                disabled={busy}
                placeholder="Bắt buộc khi từ chối hoặc đóng băng sản phẩm"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <button
                className={styles.approveButton}
                disabled={busy || needsReload || product.moderationStatus !== 'PENDING'}
                onClick={() => void decide('approve')}
              >
                {busy ? 'Đang lưu…' : '✓　Duyệt sản phẩm'}
              </button>
              <button
                className={styles.rejectButton}
                disabled={
                  busy ||
                  needsReload ||
                  product.moderationStatus !== 'PENDING' ||
                  reason.trim().length < 1
                }
                onClick={() => void decide('reject')}
              >
                Yêu cầu chỉnh sửa
              </button>
              {product.moderationStatus === 'APPROVED' && (
                <button
                  className={styles.freezeButton}
                  disabled={busy || needsReload || reason.trim().length < 1}
                  onClick={() => void decide('freeze')}
                >
                  Đóng băng sản phẩm
                </button>
              )}
              <p className={styles.formHint}>
                Hệ thống sẽ từ chối quyết định nếu nội dung đã thay đổi hoặc sản
                phẩm chưa đạt điều kiện công khai.
              </p>
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Lịch sử xử lý</h2>
                  <p>Các quyết định đã ghi nhận</p>
                </div>
              </div>
              {product.statusHistory?.length ? (
                <div className={styles.historyList}>
                  {product.statusHistory.map((entry) => (
                    <div className={styles.historyItem} key={entry.id}>
                      <span className={styles.historyDot} />
                      <div>
                        <b>
                          {entry.toModerationStatus ?? 'Cập nhật trạng thái'}
                        </b>
                        <small>
                          {entry.createdAt
                            ? new Date(entry.createdAt).toLocaleString('vi-VN')
                            : `Phiên bản v${entry.version}`}
                        </small>
                        {entry.reason && <p>{entry.reason}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.mutedText}>Chưa có lịch sử kiểm duyệt.</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function StorePage({ notify }: { notify: (toast: Toast) => void }) {
  const { nextRead, isCurrent } = useReadSequence();
  const mutation = useRef(false);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [reasonById, setReasonById] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const load = useCallback(async () => {
    const request = nextRead();
    setLoading(true);
    setError('');
    try {
      const next = await fetchApi<StoreRecord[]>('/admin/stores');
      if (!isCurrent(request)) return;
      setStores(next);
      setNeedsReload(false);
    } catch (caught) {
      if (!isCurrent(request)) return;
      setStores([]);
      setError(await readError(caught));
    } finally {
      if (isCurrent(request)) setLoading(false);
    }
  }, [nextRead, isCurrent]);
  useEffect(() => {
    void load();
  }, [load]);
  const visible =
    filter === 'ALL'
      ? stores
      : stores.filter((store) => store.status === filter);
  const review = async (
    store: StoreRecord,
    status: 'ACTIVE' | 'REJECTED' | 'SUSPENDED',
  ) => {
    if (mutation.current || loading || needsReload) return;
    const reason = reasonById[store.id]?.trim() ?? '';
    if (reason.length < 3) {
      setError('Nhập lý do từ 3 ký tự trước khi cập nhật cửa hàng.');
      return;
    }
    if (!window.confirm(`Xác nhận chuyển cửa hàng ${store.name} sang ${status}?`)) return;
    mutation.current = true;
    setBusyId(store.id);
    setError('');
    try {
      await fetchApi(`/admin/stores/${store.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason }),
      });
      notify({
        kind: 'success',
        message: `Đã cập nhật cửa hàng #${store.id}.`,
      });
      setReasonById((value) => ({ ...value, [store.id]: '' }));
      await load();
    } catch (caught) {
      setNeedsReload(true);
      setError(await readError(caught));
    } finally {
      mutation.current = false;
      setBusyId(null);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="QUẢN LÝ NGƯỜI BÁN"
        title="Cửa hàng"
        description="Xét duyệt hồ sơ và quản lý trạng thái hoạt động của cửa hàng."
        action={
          <button
            className={styles.secondaryButton}
            disabled={busyId !== null || loading}
            onClick={() => void load()}
          >
            ↻　Làm mới
          </button>
        }
      />
      <div className={styles.filterTabs}>
        {[
          ['ALL', 'Tất cả'],
          ['PENDING', 'Chờ duyệt'],
          ['ACTIVE', 'Đang hoạt động'],
          ['REJECTED', 'Từ chối'],
          ['SUSPENDED', 'Tạm khóa'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? styles.activeTab : ''}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>
              {value === 'ALL'
                ? stores.length
                : stores.filter((store) => store.status === value).length}
            </span>
          </button>
        ))}
      </div>
      {error && <Notice error={error} onRetry={busyId !== null ? undefined : () => void load()} />}
      <div className={styles.storeGrid}>
        {visible.map((store) => (
          <section className={styles.panel} key={store.id}>
            <div className={styles.storeCardHead}>
              <span className={styles.storeAvatar}>
                {store.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2>{store.name}</h2>
                <p>
                  Cửa hàng #{store.id} ·{' '}
                  {store.seller?.fullName || store.seller?.email || 'Người bán'}
                </p>
              </div>
              <span
                className={`${styles.storeStatus} ${styles[`status${store.status}`] ?? ''}`}
              >
                {store.status}
              </span>
            </div>
            {store.seller?.email && (
              <div className={styles.storeMeta}>
                <span>Email</span>
                <b>{store.seller.email}</b>
              </div>
            )}
            {store.description && (
              <p className={styles.storeDescription}>{store.description}</p>
            )}
            <label className={styles.fieldLabel} htmlFor={`reason-${store.id}`}>
              Lý do quyết định
            </label>
            <textarea
              id={`reason-${store.id}`}
              rows={2}
              className={styles.textarea}
              placeholder="Ghi lý do (tối thiểu 3 ký tự)"
              value={reasonById[store.id] ?? ''}
              maxLength={500}
              disabled={busyId !== null || loading}
              onChange={(event) =>
                setReasonById((value) => ({
                  ...value,
                  [store.id]: event.target.value,
                }))
              }
            />
            <div className={styles.storeActions}>
              {store.status === 'PENDING' && (
                <>
                  <button
                    className={styles.approveButton}
                    disabled={busyId !== null || loading || needsReload}
                    onClick={() => void review(store, 'ACTIVE')}
                  >
                    Duyệt cửa hàng
                  </button>
                  <button
                    className={styles.rejectButton}
                    disabled={busyId !== null || loading || needsReload}
                    onClick={() => void review(store, 'REJECTED')}
                  >
                    Từ chối
                  </button>
                </>
              )}
              {store.status === 'ACTIVE' && (
                <button
                  className={styles.rejectButton}
                  disabled={busyId !== null || loading || needsReload}
                  onClick={() => void review(store, 'SUSPENDED')}
                >
                  Tạm khóa
                </button>
              )}
              {store.status === 'SUSPENDED' && (
                <button
                  className={styles.approveButton}
                  disabled={busyId !== null || loading || needsReload}
                  onClick={() => void review(store, 'ACTIVE')}
                >
                  Mở lại hoạt động
                </button>
              )}
              {store.status === 'REJECTED' && (
                <p className={styles.formHint}>
                  Chờ người bán chỉnh sửa và nộp lại hồ sơ.
                </p>
              )}
            </div>
            {store.statusHistory?.length ? (
              <details className={styles.storeHistory}>
                <summary>
                  Lịch sử trạng thái ({store.statusHistory.length})
                </summary>
                {store.statusHistory.map((item, index) => (
                  <p key={`${item.createdAt}-${index}`}>
                    <b>{item.toStatus}</b> · {item.reason}{' '}
                    <small>
                      {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                    </small>
                  </p>
                ))}
              </details>
            ) : null}
          </section>
        ))}
        {!loading && !error && visible.length === 0 && (
          <section className={`${styles.panel} ${styles.emptyState}`}>
            <b>Chưa có cửa hàng trong nhóm này</b>
            <small>
              Các hồ sơ mới sẽ được cập nhật khi người bán gửi yêu cầu.
            </small>
          </section>
        )}
      </div>
      {loading && (
        <div className={styles.loadingCard}>Đang tải danh sách cửa hàng…</div>
      )}
    </>
  );
}

function CategoryTree({
  categories,
  selectedId,
  onSelect,
  disabled,
}: {
  categories: Category[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  disabled: boolean;
}) {
  const roots = categories.filter((category) => category.parentId === null);
  const render = (category: Category, level: number): ReactNode => (
    <div key={category.id}>
      <button
        className={`${styles.categoryTreeItem} ${selectedId === category.id ? styles.categorySelected : ''}`}
        disabled={disabled}
        style={{ paddingLeft: `${14 + level * 22}px` }}
        onClick={() => onSelect(category.id)}
      >
        <span className={styles.treeBranch}>{level ? '↳' : '◇'}</span>
        <span>{category.name}</span>
        <small>{category.isActive ? 'Đang bật' : 'Đã tắt'}</small>
      </button>
      {categories
        .filter((candidate) => candidate.parentId === category.id)
        .map((child) => render(child, level + 1))}
    </div>
  );
  return (
    <div>
      {roots.map((root) => render(root, 0))}
      {categories.some(
        (category) =>
          category.parentId !== null &&
          !categories.some((parent) => parent.id === category.parentId),
      ) &&
        categories
          .filter(
            (category) =>
              category.parentId !== null &&
              !categories.some((parent) => parent.id === category.parentId),
          )
          .map((orphan) => render(orphan, 0))}
      {!categories.length && (
        <p className={styles.mutedText}>Chưa có danh mục.</p>
      )}
    </div>
  );
}

function CatalogPage({ notify }: { notify: (toast: Toast) => void }) {
  const { nextRead, isCurrent } = useReadSequence();
  const mutation = useRef(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', slug: '', parentId: '' });
  const [brandForm, setBrandForm] = useState({ name: '', slug: '' });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'categories' | 'brands'>('categories');
  const [editorOpened, setEditorOpened] = useState(false);
  const [editorLocked, setEditorLocked] = useState(false);
  const [brandRevision, setBrandRevision] = useState(0);
  const editorLock = useRef(false);
  const onEditorLock = useCallback((locked: boolean) => {
    editorLock.current = locked;
    setEditorLocked(locked);
  }, []);
  const catalogBusy = busy || editorLocked;
  const selected =
    categories.find((category) => category.id === selectedId) ?? null;
  const load = useCallback(async () => {
    const request = nextRead();
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const [nextCategories, nextBrands] = await Promise.all([
        fetchApi<Category[]>('/admin/categories'),
        fetchApi<Brand[]>('/admin/brands'),
      ]);
      if (!isCurrent(request)) return;
      setCategories(nextCategories);
      setBrands(nextBrands);
      setReady(true);
    } catch (caught) {
      if (!isCurrent(request)) return;
      setCategories([]);
      setBrands([]);
      setError(await readError(caught));
    } finally {
      if (isCurrent(request)) setLoading(false);
    }
  }, [nextRead, isCurrent]);
  useEffect(() => {
    void load();
  }, [load]);
  const saveCategory = async () => {
    if (mutation.current || editorLock.current || loading || !ready) return;
    if (selectedId !== null && !selected) {
      setError('Danh mục đang sửa không còn trong danh sách. Hãy tải lại hoặc hủy bản nháp để tạo mới.');
      return;
    }
    if (!form.name.trim() || !form.slug.trim()) {
      setError('Nhập tên và mã đường dẫn danh mục.');
      return;
    }
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        slug: form.slug,
        parentId: form.parentId ? Number(form.parentId) : null,
      };
      if (selected)
        await fetchApi(`/admin/categories/${selected.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      else
        await fetchApi('/admin/categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      notify({
        kind: 'success',
        message: selected ? 'Đã cập nhật danh mục.' : 'Đã tạo danh mục.',
      });
      setForm({ name: '', slug: '', parentId: '' });
      setSelectedId(null);
      await load();
    } catch (caught) {
      setError(await readError(caught));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const saveBrand = async () => {
    if (mutation.current || editorLock.current || loading || !ready) return;
    if (!brandForm.name.trim() || !brandForm.slug.trim()) {
      setError('Nhập tên và mã đường dẫn thương hiệu.');
      return;
    }
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      await fetchApi('/admin/brands', {
        method: 'POST',
        body: JSON.stringify(brandForm),
      });
      notify({ kind: 'success', message: 'Đã tạo thương hiệu.' });
      setBrandForm({ name: '', slug: '' });
      setBrandRevision(value => value + 1);
      await load();
    } catch (caught) {
      setError(await readError(caught));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const updateCategoryActive = async (category: Category) => {
    if (mutation.current || editorLock.current || loading || !ready) return;
    if (!window.confirm(`Xác nhận ${category.isActive ? 'tắt' : 'bật'} danh mục ${category.name}? Thay đổi có thể ảnh hưởng sản phẩm công khai.`)) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      await fetchApi(`/admin/categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !category.isActive }),
      });
      notify({
        kind: 'success',
        message: `Đã ${category.isActive ? 'tắt' : 'bật'} danh mục.`,
      });
      await load();
    } catch (caught) {
      setError(await readError(caught));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const updateBrandActive = async (brand: Brand) => {
    if (mutation.current || editorLock.current || loading || !ready) return;
    if (!window.confirm(`Xác nhận ${brand.isActive ? 'tắt' : 'bật'} thương hiệu ${brand.name}? Thay đổi có thể ảnh hưởng sản phẩm công khai.`)) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      await fetchApi(`/admin/brands/${brand.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !brand.isActive }),
      });
      notify({
        kind: 'success',
        message: `Đã ${brand.isActive ? 'tắt' : 'bật'} thương hiệu.`,
      });
      setBrandRevision(value => value + 1);
      await load();
    } catch (caught) {
      setError(await readError(caught));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const beginEdit = (category: Category) => {
    if (mutation.current || editorLock.current || loading || !ready) return;
    setSelectedId(category.id);
    setForm({
      name: category.name,
      slug: category.slug,
      parentId: category.parentId ? String(category.parentId) : '',
    });
  };
  return (
    <>
      <PageHeading
        eyebrow="CATALOG"
        title="Danh mục & thương hiệu"
        description="Tổ chức cây danh mục và chuẩn hóa thương hiệu dùng trong toàn sàn."
        action={
          <button
            className={styles.secondaryButton}
            disabled={catalogBusy || loading}
            onClick={() => { if (!mutation.current && !editorLock.current) void load(); }}
          >
            ↻　Làm mới
          </button>
        }
      />
      {error && <Notice error={error} onRetry={catalogBusy ? undefined : () => { if (!mutation.current && !editorLock.current) void load(); }} />}
      <div className={styles.filterTabs}>
        <button
          className={tab === 'categories' ? styles.activeTab : ''}
          disabled={catalogBusy}
          onClick={() => setTab('categories')}
        >
          Danh mục <span>{categories.length}</span>
        </button>
        <button
          className={tab === 'brands' ? styles.activeTab : ''}
          disabled={catalogBusy}
          onClick={() => setTab('brands')}
        >
          Thương hiệu <span>{brands.length}</span>
        </button>
      </div>
      {tab === 'categories' ? (
        <div className={styles.catalogGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Cây danh mục</h2>
                <p>Chọn một mục để cập nhật</p>
              </div>
              <button
                className={styles.textButton}
                disabled={busy || loading}
                onClick={() => {
                  if (mutation.current) return;
                  setSelectedId(null);
                  setForm({ name: '', slug: '', parentId: '' });
                }}
              >
                + Tạo mới
              </button>
            </div>
            <div className={styles.categoryTree}>
              <CategoryTree
                categories={categories}
                selectedId={selectedId}
                disabled={busy || loading || !ready}
                onSelect={(id) => {
                  const category = categories.find((item) => item.id === id);
                  if (category) beginEdit(category);
                }}
              />
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>{selectedId !== null ? 'Chỉnh sửa danh mục' : 'Thêm danh mục'}</h2>
                <p>
                  {selectedId !== null
                    ? `Đang sửa #${selectedId}`
                    : 'Tạo danh mục cha hoặc danh mục con'}
                </p>
              </div>
            </div>
            <label className={styles.fieldLabel} htmlFor="category-name">
              Tên danh mục
            </label>
            <input
              id="category-name"
              className={styles.input}
              disabled={busy || loading}
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Ví dụ: Thiết bị âm thanh"
            />
            <label className={styles.fieldLabel} htmlFor="category-slug">
              Mã đường dẫn
            </label>
            <input
              id="category-slug"
              className={styles.input}
              disabled={busy || loading}
              value={form.slug}
              onChange={(event) =>
                setForm({ ...form, slug: event.target.value })
              }
              placeholder="thiet-bi-am-thanh"
            />
            <label className={styles.fieldLabel} htmlFor="category-parent">
              Danh mục cha
            </label>
            <select
              id="category-parent"
              className={styles.input}
              disabled={busy || loading}
              value={form.parentId}
              onChange={(event) =>
                setForm({ ...form, parentId: event.target.value })
              }
            >
              <option value="">Danh mục gốc</option>
              {categories
                .filter(
                  (category) => category.id !== selectedId && category.isActive,
                )
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
            <div className={styles.formActions}>
              <button
                className={styles.approveButton}
                disabled={busy || loading || !ready || (selectedId !== null && !selected)}
                onClick={() => void saveCategory()}
              >
                {busy
                  ? 'Đang lưu…'
                  : selectedId !== null
                    ? 'Lưu thay đổi'
                    : 'Tạo danh mục'}
              </button>
              {selectedId !== null && (
                <>
                  {selected && (
                    <button
                      className={styles.secondaryButton}
                      disabled={busy || loading || !ready}
                      onClick={() => void updateCategoryActive(selected)}
                    >
                      {selected.isActive ? 'Tắt danh mục' : 'Bật danh mục'}
                    </button>
                  )}
                  <button
                    className={styles.textButton}
                    disabled={busy || loading}
                    onClick={() => {
                      if (mutation.current) return;
                      setSelectedId(null);
                      setForm({ name: '', slug: '', parentId: '' });
                    }}
                  >
                    Hủy chỉnh sửa
                  </button>
                </>
              )}
            </div>
            <p className={styles.formHint}>
              Tắt danh mục có thể khiến sản phẩm không còn công khai. Giao diện quản lý định nghĩa thuộc tính chưa nằm trong đợt bàn giao này; Backend đã có API tạo/cập nhật thuộc tính.
            </p>
          </section>
        </div>
      ) : (
        <div className={styles.catalogGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Thương hiệu</h2>
                <p>Danh sách thương hiệu trong hệ thống</p>
              </div>
              <button className={styles.textButton} disabled={catalogBusy || loading || !ready || editorOpened}
                onClick={() => setEditorOpened(true)}>Sửa tên/slug thương hiệu</button>
            </div>
            <div className={styles.brandList}>
              {brands.map((brand) => (
                <div className={styles.brandRow} key={brand.id}>
                  <span className={styles.brandAvatar}>
                    {brand.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <b>{brand.name}</b>
                    <small>{brand.slug}</small>
                  </span>
                  <span
                    className={
                      brand.isActive ? styles.activeText : styles.mutedText
                    }
                  >
                    {brand.isActive ? 'Đang bật' : 'Đã tắt'}
                  </span>
                  <button
                    className={styles.textButton}
                    disabled={catalogBusy || loading || !ready}
                    onClick={() => void updateBrandActive(brand)}
                  >
                    {brand.isActive ? 'Tắt' : 'Bật'}
                  </button>
                </div>
              ))}
              {!brands.length && !loading && (
                <p className={styles.mutedText}>Chưa có thương hiệu.</p>
              )}
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Thêm thương hiệu</h2>
                <p>Chỉ nhập thương hiệu đã được xác minh</p>
              </div>
            </div>
            <label className={styles.fieldLabel} htmlFor="brand-name">
              Tên thương hiệu
            </label>
            <input
              id="brand-name"
              className={styles.input}
              disabled={catalogBusy || loading}
              value={brandForm.name}
              onChange={(event) =>
                setBrandForm({ ...brandForm, name: event.target.value })
              }
              placeholder="Ví dụ: Sony"
            />
            <label className={styles.fieldLabel} htmlFor="brand-slug">
              Mã đường dẫn
            </label>
            <input
              id="brand-slug"
              className={styles.input}
              disabled={catalogBusy || loading}
              value={brandForm.slug}
              onChange={(event) =>
                setBrandForm({ ...brandForm, slug: event.target.value })
              }
              placeholder="sony"
            />
            <button
              className={styles.approveButton}
              disabled={catalogBusy || loading || !ready}
              onClick={() => void saveBrand()}
            >
              {busy ? 'Đang lưu…' : 'Thêm thương hiệu'}
            </button>
            <p className={styles.formHint}>
              Không suy đoán thương hiệu từ tên nguồn hoặc tên nhà bán lẻ.
            </p>
          </section>
        </div>
      )}
      {/* Keep the editor mounted across Catalog tabs so drafts/unknown locks survive. */}
      {editorOpened && <div hidden={tab !== 'brands'}>
        <AdminBrandEditor embedded disabled={busy || loading || !ready} reloadToken={brandRevision}
          onLockChange={onEditorLock} onSaved={() => { void load(); }} />
      </div>}
      {loading && (
        <div className={styles.loadingCard}>
          Đang tải danh mục và thương hiệu…
        </div>
      )}
    </>
  );
}

function UnsupportedPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <PageHeading
        eyebrow="CHƯA TRIỂN KHAI GIAO DIỆN"
        title={title}
        description={description}
      />
      <section className={styles.unsupported}>
        <span>◷</span>
        <h2>Chức năng chưa được nghiệm thu</h2>
        <p>
          Giao diện và API hậu mãi chưa được tích hợp trong đợt bàn giao này.
          {' '}Trang không dùng dữ liệu mẫu để thay cho chức năng thật.
        </p>
        <Link className={styles.secondaryButton} to="/admin">
          Quay lại tổng quan
        </Link>
      </section>
    </>
  );
}

export function AdminDashboardPage() {
  const { user } = useAuth();
  if (!user || user.role !== 'ADMIN' || !user.isActive)
    return <p role="alert">Chỉ tài khoản Admin đang hoạt động được quản trị.</p>;
  return <AdminConsole key={user.id} />;
}

function AdminConsole() {
  const { user, logout } = useAuth();
  const [toast, setToast] = useState<Toast>(null);
  const showToast = useCallback((next: Toast) => {
    setToast(next);
    window.setTimeout(() => setToast(null), 4000);
  }, []);
  const initials = useMemo(
    () =>
      user?.fullName?.split(/\s+/).slice(-1)[0]?.slice(0, 1).toUpperCase() ??
      'A',
    [user],
  );
  const navigate = useNavigate();
  const signOut = async () => {
    try {
      await logout();
      navigate('/login');
    } catch {
      showToast({
        kind: 'error',
        message: 'Không thể đăng xuất. Vui lòng thử lại.',
      });
    }
  };
  return (
    <div className={styles.adminShell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} to="/admin">
          <span className={styles.brandMark}>B</span>
          <span>
            <b>BCKL</b>
            <small>ADMIN CONSOLE</small>
          </span>
        </Link>
        <div className={styles.sideSection}>MENU CHÍNH</div>
        <nav className={styles.sideNav}>
          {navItems.map((item) =>
            item.disabled ? (
              <div
                key={item.to}
                className={`${styles.navItem} ${styles.navDisabled}`}
                title="Giao diện chưa triển khai; xem phạm vi và API hiện có trong tài liệu QA"
              >
                <span>{item.icon}</span>
                {item.label}
                <i>Chưa có UI</i>
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }: { isActive: boolean }) =>
                  `${styles.navItem} ${isActive ? styles.navActive : ''}`
                }
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.helpCard}>
            <span>✦</span>
            <b>Trung tâm hỗ trợ</b>
            <small>Cần trợ giúp khi vận hành?</small>
            <button
              onClick={() =>
                showToast({
                  kind: 'error',
                  message: 'Kênh hỗ trợ chưa được cấu hình.',
                })
              }
            >
              Liên hệ nhóm dự án　›
            </button>
          </div>
          <div className={styles.sideUser}>
            <span className={styles.avatar}>{initials}</span>
            <span>
              <b>{user?.fullName || 'Quản trị viên'}</b>
              <small>Quản trị viên</small>
            </span>
            <button aria-label="Đăng xuất" onClick={() => void signOut()}>
              ↗
            </button>
          </div>
        </div>
      </aside>
      <main className={styles.adminMain}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            BCKL <span>/</span> <b>Quản trị hệ thống</b>
          </div>
          <div className={styles.topActions}>
            <span className={styles.environmentTag}>Bảng điều khiển</span>
            <button
              className={styles.iconButton}
              aria-label="Thông báo"
              title="API thông báo chưa triển khai"
            >
              ♧
            </button>
            <button
              className={styles.topAvatar}
              onClick={() => void signOut()}
              title="Đăng xuất"
            >
              {initials}
            </button>
          </div>
        </header>
        <div className={styles.content}>
          <Routes>
            <Route index element={<OverviewPage />} />
            <Route path="products" element={<ProductQueuePage />} />
            <Route
              path="products/:productId"
              element={<ProductReviewPage notify={showToast} />}
            />
            <Route path="stores" element={<StorePage notify={showToast} />} />
            <Route
              path="catalog"
              element={<CatalogPage notify={showToast} />}
            />
            <Route
              path="users"
              element={import.meta.env.VITE_ADMIN_ACCOUNT_STATUS_ENABLED === 'true' ? <AdminAccountStatusWorkspace embedded /> : <AdminAccountsReader api={accountsReadApi} embedded />}
            />
            <Route
              path="system-health"
              element={<AdminSystemHealth api={systemHealthApi} embedded />}
            />
            <Route
              path="returns"
              element={
                <UnsupportedPage
                  title="Xử lý hậu mãi"
                  description="Xem yêu cầu trả hàng, quyết định phương án và ghi nhận hoàn tiền mô phỏng."
                />
              }
            />
            <Route path="*" element={<OverviewPage />} />
          </Routes>
        </div>
        <footer className={styles.adminFooter}>
          © 2026 BCKL E-Commerce <span>·</span> Bảng điều khiển quản trị
        </footer>
      </main>
      {toast && (
        <div
          className={`${styles.toast} ${toast.kind === 'error' ? styles.toastError : ''}`}
          role="status"
        >
          {toast.kind === 'success' ? '✓' : '!'}　{toast.message}
        </div>
      )}
    </div>
  );
}
