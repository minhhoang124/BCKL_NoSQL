import { useAuth } from '../contexts/useAuth';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { marketplaceApi } from '../services/marketplaceApi';
import type { Brand, Category, Product } from '../types/marketplace';
import { SearchResultCard } from '../services/searchTelemetry';
import { analyticsToken, prepareSearchTelemetry } from '../services/searchAnalyticsClient';
import { ApiError } from '../services/apiClient';
import styles from './Marketplace.module.css';

const searchWithTelemetry = async (body:Record<string,unknown>) => {await prepareSearchTelemetry();return marketplaceApi.search(body);};
const flatten = (nodes: Category[], depth = 0): Array<Category & { depth: number }> =>
  nodes.flatMap((node) => [{ ...node, depth }, ...flatten(node.children, depth + 1)]);

export function HomePage() {
  const [searchParams] = useSearchParams();
  const {loading:checkingSession}=useAuth();
  if(checkingSession)return <p role="status">Đang chuẩn bị tìm kiếm…</p>;
  return <HomeResults key={searchParams.toString()} initialQuery={searchParams.get('q')?.trim() ?? ''} />;
}

function HomeResults({ initialQuery }: { initialQuery: string }) {
  const [tracking,setTracking]=useState<{token:string}|undefined>();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [inStock, setInStock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<Parameters<typeof marketplaceApi.publicProducts>[0]>({ limit: 24 });
  const requestId = useRef(Symbol());
  const flatCategories = useMemo(() => flatten(categories), [categories]);

  useEffect(() => {
    const current = Symbol();
    requestId.current = current;
    const productRequest = initialQuery
      ? searchWithTelemetry({ query: initialQuery, topK: 24, candidateK: 100 })
      : marketplaceApi.publicProducts({ limit: 24 });
    Promise.all([productRequest, marketplaceApi.categories(), marketplaceApi.brands()])
      .then(([result, categoryRows, brandRows]) => {
        if (requestId.current !== current) return;
        setTracking('responseTimeMs' in result ? analyticsToken(result.analytics) : undefined);
        setProducts('responseTimeMs' in result ? result.items.map((item) => item.product) : result.items);
        setNextCursor('nextCursor' in result ? result.nextCursor : null);
        setResponseTime('responseTimeMs' in result ? result.responseTimeMs : null);
        setSearched(Boolean(initialQuery)); setQuery(initialQuery); setCategories(categoryRows); setBrands(brandRows);
      })
      .catch((e) => { if (requestId.current === current) setError(e instanceof ApiError ? e.message : 'Không thể tải danh mục sản phẩm.'); })
      .finally(() => { if (requestId.current === current) setLoading(false); });
    return () => { requestId.current = Symbol(); };
  }, [initialQuery]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    const current = Symbol(); requestId.current = current;
    setTracking(undefined); setProducts([]); setNextCursor(null); setResponseTime(null);
    try {
      if (query.trim()) {
        const result = await searchWithTelemetry({ query: query.trim(), topK: 24, candidateK: 100, ...(categoryId ? { categoryIds: [Number(categoryId)] } : {}), ...(brandId ? { brandIds: [Number(brandId)] } : {}), ...(inStock ? { inStock: true } : {}) });
        if (requestId.current !== current) return;
        setTracking(analyticsToken(result.analytics)); setProducts(result.items.map((item) => item.product)); setResponseTime(result.responseTimeMs); setSearched(true);
      } else {
        const filters = { limit: 24, ...(categoryId ? { categoryId: Number(categoryId) } : {}), ...(brandId ? { brandId: Number(brandId) } : {}), ...(inStock ? { inStock: true } : {}) };
        const page = await marketplaceApi.publicProducts(filters);
        if (requestId.current !== current) return;
        setProducts(page.items); setNextCursor(page.nextCursor); setAppliedFilters(filters);
        setResponseTime(null); setSearched(false);
      }
    } catch (e) { if (requestId.current === current) setError(e instanceof ApiError ? e.message : 'Tìm kiếm đang tạm thời không khả dụng.'); }
    finally { if (requestId.current === current) setLoading(false); }
  };

  const loadMore = async () => {
    if (nextCursor === null || loading) return;
    const current = Symbol(); requestId.current = current;
    setLoading(true); setError('');
    try {
      const page = await marketplaceApi.publicProducts({ ...appliedFilters, afterId: nextCursor });
      if (requestId.current !== current) return;
      setProducts((previous) => [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      if (requestId.current === current) setError(e instanceof ApiError ? e.message : 'Không thể tải thêm sản phẩm.');
    } finally { if (requestId.current === current) setLoading(false); }
  };

  return <div className={styles.page}>
    <section className={styles.heroGrid}>
      <div className={styles.hero}>
        <div className={styles.heroBadgeRow} aria-hidden="true">
          <span className={styles.heroSeasonPill}>🎄 NOEL MEGA SALE 2026</span>
          <span className={styles.heroGuaranteePill}>✓ Mall Chính Hãng · Freeship 0Đ</span>
        </div>
        <h1>Khám phá sản phẩm phù hợp</h1>
        <p>Tìm theo từ khóa, ngữ nghĩa và lọc lại bằng dữ liệu đang bán thực tế.</p>
        <div className={styles.voucherRow} aria-hidden="true">
          <div className={styles.voucherChip}>
            <strong>GIẢM 120K</strong>
            <span>Đơn từ 499K · Noel2026</span>
          </div>
          <div className={styles.voucherChip}>
            <strong>FREESHIP 0Đ</strong>
            <span>Mọi đơn hàng Mall</span>
          </div>
          <div className={styles.voucherChip}>
            <strong>AI CLIP 📷</strong>
            <span>Tìm nhanh bằng hình ảnh</span>
          </div>
        </div>
      </div>
      <div className={styles.heroSide} aria-hidden="true">
        <div className={styles.sideBannerGold}>
          <span className={styles.sideTag}>KHUNG GIỜ VÀNG 0H · 12H · 21H</span>
          <strong>Săn Voucher Giáng Sinh 50%</strong>
          <span>Cộng dồn ưu đãi cửa hàng &amp; miễn phí vận chuyển</span>
        </div>
        <div className={styles.sideBannerPine}>
          <span className={styles.sideTag}>ĐỐI TÁC THANH TOÁN</span>
          <strong>VNPay-QR Hoàn Tiền Đến 20%</strong>
          <span>Bảo vệ người mua 100% · Đồng kiểm khi nhận hàng</span>
        </div>
      </div>
    </section>

    <div className={styles.flashRibbon} aria-hidden="true">
      <div className={styles.flashTitle}>
        <span>⚡ FLASH SALE GIÁNG SINH</span>
        <div className={styles.countdown}>
          <b>02</b>:<b>18</b>:<b>45</b>
        </div>
      </div>
      <span className={styles.flashSub}>Di chuột qua sản phẩm có nhiều góc chụp để xem nhanh ảnh thực tế chuẩn Shein</span>
    </div>

    <form className={styles.toolbar} onSubmit={submit}>
      <input aria-label="Từ khóa" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tai nghe chống ồn, giày chạy bộ..." />
      <select aria-label="Danh mục" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Mọi danh mục</option>{flatCategories.map((item) => <option key={item.id} value={item.id}>{'—'.repeat(item.depth)} {item.name}</option>)}</select>
      <select aria-label="Thương hiệu" value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">Mọi thương hiệu</option>{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <label className={styles.stockCheck}><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> Còn hàng</label>
      <button disabled={loading}>{loading ? 'Đang tìm…' : 'Tìm kiếm'}</button>
    </form>
    <p className={styles.hint}>{import.meta.env.VITE_IMAGE_SEARCH_ENABLED === 'true' ? <Link to="/search/image">Tìm sản phẩm bằng ảnh JPEG/PNG</Link> : 'Tìm kiếm bằng ảnh chưa được bật ở bản triển khai này.'}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {searched && <p className={styles.searchStats}>{products.length} kết quả{responseTime !== null ? ` · Search Service ${Math.round(responseTime)} ms` : ''}</p>}
    {!loading && !error && !products.length && nextCursor === null ? <div className={styles.empty}>Chưa có sản phẩm phù hợp.</div> : <section className={styles.grid}>{products.map((item) => <SearchResultCard key={`${tracking?.token??"catalog"}:${item.id}`} product={item} token={tracking?.token} />)}</section>}
    {nextCursor !== null && <div className={styles.loadMoreWrap}><button className={styles.loadMoreBtn} disabled={loading} onClick={() => void loadMore()}>Tải thêm sản phẩm</button></div>}
  </div>;
}
