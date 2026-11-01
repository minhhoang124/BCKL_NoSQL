import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../services/apiClient';
import { marketplaceApi } from '../services/marketplaceApi';
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

export function SellerDashboardPage() {
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [tab, setTab] = useState<'store' | 'products' | 'dashboard'>('store');
  const [activeStep, setActiveStep] = useState<StepKey>('info');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
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
  };

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
        },
      );
    } else {
      void run(
        async () => {
          const created = await marketplaceApi.createProduct(body);
          setSelected(created);
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

  const approvedCount = products.filter((item) => item.moderationStatus === 'APPROVED').length;
  const pendingCount = products.filter((item) => item.moderationStatus === 'PENDING').length;

  return (
    <div className={styles.page}>
      <div className={styles.sellerHeaderBanner}>
        <div>
          <span className={styles.sellerKicker} aria-hidden="true">
            🎄 KÊNH NGƯỜI BÁN · MÙA LỄ HỘI NOEL 2026
          </span>
          <h1>Kênh người bán</h1>
          <p>Hoàn thiện thông tin cửa hàng và sản phẩm trước khi gửi duyệt.</p>
        </div>
        <div className={styles.sellerQuickNav}>
          <Link to="/seller/orders" className={styles.sellerNavBtn}>
            Đơn hàng của cửa hàng
          </Link>
          <p>
            <Link to="/seller/aftersales" className={styles.sellerNavBtnSecondary}>
              Xử lý hậu mãi
            </Link>
          </p>
          {import.meta.env.VITE_PRODUCT_REVIEWS_ENABLED === 'true' && (
            <p>
              <Link to="/seller/reviews" className={styles.sellerNavBtnSecondary}>
                Phản hồi đánh giá
              </Link>
            </p>
          )}
        </div>
      </div>

      <div className={styles.sellerKpiGrid} aria-hidden="true">
        <div className={styles.sellerKpiCard}>
          <span>Trạng thái gian hàng</span>
          <strong>{store ? (storeStatusLabels[store.status] ?? store.status) : 'Chưa tạo'}</strong>
          <small>{store?.name ?? 'Chưa đăng ký tên cửa hàng'}</small>
        </div>
        <div className={styles.sellerKpiCard}>
          <span>Sản phẩm đã duyệt</span>
          <strong>
            {approvedCount} / {products.length}
          </strong>
          <small>Đang hiển thị trên sàn</small>
        </div>
        <div className={styles.sellerKpiCard}>
          <span>Chờ Admin kiểm duyệt</span>
          <strong>{pendingCount}</strong>
          <small>Hàng chờ duyệt nội dung</small>
        </div>
        <div className={styles.sellerKpiCard}>
          <span>Cập nhật Giá &amp; Kho SKU</span>
          <strong>Áp dụng ngay</strong>
          <small>Không cần chờ duyệt lại</small>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          className={tab === 'store' ? styles.active : ''}
          onClick={() => setTab('store')}
        >
          Cửa hàng
        </button>
        <button
          className={tab === 'products' ? styles.active : ''}
          onClick={() => setTab('products')}
        >
          Sản phẩm ({products.length})
        </button>
        <button
          className={tab === 'dashboard' ? styles.active : ''}
          onClick={() => setTab('dashboard')}
        >
          Thống kê
        </button>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {message && <p className={styles.success}>{message}</p>}

      {tab === 'dashboard' ? (
        <>
          <Dashboard scope="SELLER" storeId={store?.id} />
          <SearchAnalytics scope="SELLER" />
        </>
      ) : tab === 'store' ? (
        <section className={styles.columns}>
          {store?.application ||
          (!store && import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === 'true') ? (
            <div className={styles.panel}>
              <h2>Hồ sơ mở cửa hàng</h2>
              <p>
                Thông tin liên hệ, địa chỉ lấy/trả hàng và lịch sử được quản lý cùng hồ sơ đã nộp.
              </p>
              <Link to="/account/store-application">Mở hồ sơ cửa hàng</Link>
            </div>
          ) : (
            <form className={`${styles.panel} ${styles.form}`} onSubmit={saveStore}>
              <h2>{store ? 'Thông tin cửa hàng' : 'Mở cửa hàng'}</h2>
              <label>
                Tên cửa hàng
                <input name="name" required minLength={3} defaultValue={store?.name} />
              </label>
              <label>
                Mô tả
                <textarea
                  name="description"
                  rows={5}
                  defaultValue={store?.description ?? ''}
                />
              </label>
              <button disabled={busy}>{store ? 'Lưu thay đổi' : 'Gửi yêu cầu'}</button>
              {store?.status === 'REJECTED' && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => run(marketplaceApi.resubmitStore, 'Đã nộp lại hồ sơ cửa hàng.')}
                >
                  Nộp lại sau chỉnh sửa
                </button>
              )}
            </form>
          )}
          <aside className={styles.panel}>
            <h2>Trạng thái</h2>
            <span className={styles.badge}>{store?.status ?? 'CHƯA TẠO'}</span>
            <p>
              {store?.status === 'ACTIVE'
                ? 'Cửa hàng đã hoạt động; bạn có thể tạo và gửi sản phẩm.'
                : 'Cửa hàng cần được duyệt trước khi thêm sản phẩm.'}
            </p>
          </aside>
        </section>
      ) : (
        <section className={`${styles.columns} ${styles.sellerWorkspace}`}>
          <div className={styles.panel}>
            <div className={styles.panelHeaderRow}>
              <h2>Sản phẩm của tôi</h2>
              <button
                type="button"
                className={styles.newProductBtn}
                disabled={busy}
                onClick={() => selectProduct(null)}
              >
                + Thêm sản phẩm mới
              </button>
            </div>
            <div className={styles.list}>
              {products.map((item) => (
                <div
                  className={selected?.id === item.id ? `${styles.row} ${styles.rowActive}` : styles.row}
                  key={item.id}
                >
                  <div>
                    <strong>{item.name}</strong>
                    <div className={styles.itemMetaLine}>
                      <span className={styles.statusPill}>
                        {item.moderationStatus ? (moderationLabels[item.moderationStatus] ?? item.moderationStatus) : 'Bản nháp'}
                      </span>
                      <span> · </span>
                      <span>{item.sellerStatus ? (visibilityLabels[item.sellerStatus] ?? item.sellerStatus) : 'Đang bán'}</span>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <button disabled={busy} className={styles.secondary} onClick={() => selectProduct(item)}>
                      Chỉnh sửa
                    </button>
                    {item.moderationStatus === 'NOT_SUBMITTED' ||
                    item.moderationStatus === 'REJECTED' ? (
                      <button
                        disabled={busy}
                        aria-label={`Gửi duyệt ${item.name}`}
                        onClick={() =>
                          run(() => marketplaceApi.submitProduct(item.id), 'Đã gửi duyệt.')
                        }
                      >
                        Gửi duyệt
                      </button>
                    ) : null}
                    {item.moderationStatus === 'APPROVED' && item.version && (
                      <button
                        disabled={busy}
                        className={styles.secondary}
                        onClick={() =>
                          run(
                            () =>
                              marketplaceApi.visibility(
                                item.id,
                                item.version!,
                                item.sellerStatus === 'HIDDEN' ? 'ACTIVE' : 'HIDDEN',
                              ),
                            'Đã đổi hiển thị.',
                          )
                        }
                      >
                        {item.sellerStatus === 'HIDDEN' ? 'Hiện' : 'Ẩn'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {products.length === 0 && (
                <p className={styles.emptyHint}>Chưa có sản phẩm nào. Hãy tạo sản phẩm đầu tiên bên phải.</p>
              )}
            </div>
          </div>

          <div className={styles.panel}>
            {/* Guided Multi-Step Wizard Header */}
            <div className={styles.stepWizard}>
              <div className={styles.stepWizardHead}>
                <h2>{selected ? 'Sửa #' + selected.id : 'Tạo sản phẩm'}</h2>
                {selected && (
                  <span className={styles.stepCurrentNotice}>
                    Mã sản phẩm: #{selected.id} · Trạng thái: {moderationLabels[selected.moderationStatus ?? 'NOT_SUBMITTED'] ?? selected.moderationStatus}
                  </span>
                )}
              </div>
              <div className={styles.stepTabsRow} role="tablist">
                <button
                  type="button"
                  className={activeStep === 'info' ? styles.stepTabActive : styles.stepTab}
                  onClick={() => setActiveStep('info')}
                >
                  1. Thông tin cơ bản
                </button>
                <button
                  type="button"
                  className={activeStep === 'images' ? styles.stepTabActive : styles.stepTab}
                  disabled={!selected}
                  onClick={() => setActiveStep('images')}
                  title={!selected ? 'Lưu thông tin cơ bản trước khi tải ảnh' : ''}
                >
                  2. Ảnh sản phẩm
                </button>
                <button
                  type="button"
                  className={activeStep === 'variants' ? styles.stepTabActive : styles.stepTab}
                  disabled={!selected}
                  onClick={() => setActiveStep('variants')}
                  title={!selected ? 'Lưu thông tin cơ bản trước khi cấu hình phân loại' : ''}
                >
                  3. Phân loại &amp; Giá/Kho
                </button>
                <button
                  type="button"
                  className={activeStep === 'shipping' ? styles.stepTabActive : styles.stepTab}
                  disabled={!selected}
                  onClick={() => setActiveStep('shipping')}
                  title={!selected ? 'Lưu thông tin cơ bản trước khi cấu hình vận chuyển' : ''}
                >
                  4. Kiện hàng
                </button>
                {selected && (
                  <button
                    type="button"
                    className={activeStep === 'submit' ? styles.stepTabActive : styles.stepTab}
                    onClick={() => setActiveStep('submit')}
                  >
                    5. Gửi duyệt
                  </button>
                )}
              </div>
            </div>

            {/* Step 1: Basic Info */}
            <div hidden={activeStep !== 'info'}>
              <form className={styles.form} onSubmit={saveProduct} aria-label="Sản phẩm">
                <h3>1. Thông tin cơ bản</h3>
                <label>
                  Tên
                  <input
                    name="name"
                    required
                    minLength={3}
                    disabled={busy}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label>
                  Danh mục
                  <select
                    name="categoryId"
                    required
                    disabled={busy}
                    value={draft.categoryId}
                    onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                  >
                    <option value="">Chọn danh mục lá</option>
                    {leafCategories.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Thương hiệu
                  <select
                    name="brandId"
                    disabled={busy}
                    value={draft.brandId}
                    onChange={(e) => setDraft({ ...draft, brandId: e.target.value })}
                  >
                    <option value="">Không thương hiệu</option>
                    {brands.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mô tả
                  <textarea
                    name="description"
                    rows={4}
                    disabled={busy}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </label>
                <div className={styles.formButtonsRow}>
                  <button disabled={busy}>Lưu sản phẩm</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => selectProduct(null)}
                  >
                    Tạo mới / bỏ chỉnh sửa
                  </button>
                </div>
              </form>
            </div>

            {/* Step 2: Product Images */}
            {selected && (
              <div hidden={activeStep !== 'images'}>
                <form className={styles.form} onSubmit={upload}>
                  <h3>2. Ảnh đại diện sản phẩm</h3>
                  <p className={styles.stepHint}>
                    Ảnh chính là hình ảnh đầu tiên người mua nhìn thấy trên sàn. Định dạng hỗ trợ: JPEG, PNG, WebP (tối đa 5MB).
                  </p>
                  {selected.images?.length > 0 && (
                    <div className={styles.uploadedImagesPreview}>
                      <span>Đã có {selected.images.length} ảnh được tải lên.</span>
                    </div>
                  )}
                  <input
                    name="file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    required
                    disabled={busy}
                  />
                  <div className={styles.formButtonsRow}>
                    <button disabled={busy}>Tải ảnh &amp; tiếp tục</button>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => setActiveStep('variants')}
                    >
                      Bỏ qua bước ảnh sang Phân loại ›
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Step 3: Variants, SKU, Prices, Stocks */}
            {selected && (
              <div hidden={activeStep !== 'variants'}>
                <h3>3. Phân loại, Thuộc tính &amp; Giá/Kho SKU</h3>
                <ProductDetailsEditor
                  key={selected.id}
                  product={selected}
                  busy={busy}
                  run={run}
                  onInventoryChanged={(fresh) => {
                    setProducts((rows) =>
                      rows.map((row) => (row.id === fresh.id ? fresh : row)),
                    );
                    setSelected((current) =>
                      current?.id === fresh.id ? fresh : current,
                    );
                  }}
                />
                <div className={styles.nextStepBar}>
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => setActiveStep('shipping')}
                  >
                    Tiếp tục sang bước Kiện hàng ›
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Shipping Profile */}
            {selected && (
              <div hidden={activeStep !== 'shipping'}>
                <form className={styles.form} onSubmit={saveShipping}>
                  <h3>4. Thông tin kiện hàng &amp; Vận chuyển</h3>
                  <p className={styles.stepHint}>
                    Nhập khối lượng sau khi đóng gói. Đây là thông tin bắt buộc trước khi gửi duyệt.
                  </p>
                  <label>
                    Khối lượng kiện hàng đóng gói (gram) *
                    <input
                      name="weight"
                      type="number"
                      min="1"
                      placeholder="Ví dụ: 500"
                      required
                      disabled={busy}
                      defaultValue={selected.shippingProfile?.packageWeightGrams ?? ''}
                    />
                  </label>
                  <div className={styles.formButtonsRow}>
                    <button disabled={busy}>Lưu kiện hàng</button>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => setActiveStep('submit')}
                    >
                      Tiếp tục sang bước Kiểm tra &amp; Gửi duyệt ›
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Step 5: Review & Submit for Moderation */}
            {selected && (
              <div hidden={activeStep !== 'submit'}>
                <div className={styles.reviewSubmissionCard}>
                  <h3>5. Kiểm tra &amp; gửi duyệt</h3>
                  <p className={styles.stepHint}>
                    Trước khi gửi duyệt, vui lòng kiểm tra xem bạn đã hoàn thành các thông tin cần thiết:
                  </p>
                  <ul className={styles.submissionChecklist}>
                    <li>
                      ✓ <strong>Thông tin cơ bản:</strong> {selected.name} ({selected.category.name})
                    </li>
                    <li>
                      {selected.images?.length > 0 ? '✓' : '⚠️'} <strong>Ảnh chính:</strong>{' '}
                      {selected.images?.length > 0
                        ? `Đã có ${selected.images.length} ảnh`
                        : 'Chưa có ảnh chính — cần có trước khi gửi duyệt'}
                    </li>
                    <li>
                      {selected.variants?.length > 0 ? '✓' : '⚠️'} <strong>Phân loại &amp; Giá/Kho:</strong>{' '}
                      {selected.variants?.length > 0
                        ? `Đã có ${selected.variants.length} SKU biến thể`
                        : 'Chưa tạo phân loại hàng'}
                    </li>
                    <li>
                      {selected.shippingProfile?.packageWeightGrams ? '✓' : '⚠️'}{' '}
                      <strong>Kiện hàng:</strong>{' '}
                      {selected.shippingProfile?.packageWeightGrams
                        ? `${selected.shippingProfile.packageWeightGrams}g`
                        : 'Chưa lưu khối lượng kiện hàng'}
                    </li>
                  </ul>

                  <div className={styles.submissionActionsRow}>
                    {selected.moderationStatus === 'NOT_SUBMITTED' ||
                    selected.moderationStatus === 'REJECTED' ? (
                      <button
                        type="button"
                        className={styles.submitForApprovalBtn}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => marketplaceApi.submitProduct(selected.id),
                            'Đã gửi duyệt sản phẩm. Sản phẩm sẽ hiển thị trên sàn sau khi được duyệt.',
                          )
                        }
                      >
                        Gửi duyệt
                      </button>
                    ) : selected.moderationStatus === 'PENDING' ? (
                      <p className={styles.pendingReviewNotice}>
                        ⏳ Sản phẩm đang trong hàng đợi kiểm duyệt của Admin.
                      </p>
                    ) : (
                      <p className={styles.approvedNotice}>
                        ✓ Sản phẩm đã được duyệt và đang hoạt động trên sàn.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
