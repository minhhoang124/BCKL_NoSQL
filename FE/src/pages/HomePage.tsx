import { useAuth } from '../contexts/useAuth';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { marketplaceApi } from '../services/marketplaceApi';
import type { Brand, Category, Product } from '../types/marketplace';
import { SearchResultCard } from '../services/searchTelemetry';
import { analyticsToken, prepareSearchTelemetry } from '../services/searchAnalyticsClient';
import { ApiError } from '../services/apiClient';
import { StateCard } from '../components/StateCard/StateCard';
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
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
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
        setSearched(Boolean(initialQuery)); setQuery(initialQuery); setCategories(categoryRows); setBrands(brandRows);
      })
      .catch((e) => { if (requestId.current === current) setError(e instanceof ApiError ? e.message : 'Không thể tải danh mục sản phẩm.'); })
      .finally(() => { if (requestId.current === current) setLoading(false); });
    return () => { requestId.current = Symbol(); };
  }, [initialQuery]);

  const submit = (event: FormEvent) => { event.preventDefault(); void runFilters(categoryId); };
  // Category chips apply immediately; clicking the active chip clears the category filter.
  const pickCategory = (id: string) => {
    const next = categoryId === id ? '' : id;
    setCategoryId(next); void runFilters(next);
  };
  const runFilters = async (categoryId: string) => {
    setError(''); setLoading(true);
    const current = Symbol(); requestId.current = current;
    setTracking(undefined); setProducts([]); setNextCursor(null);
    // Price range exists only on the keyword search API; never sent to the catalog list.
    const priceRange = query.trim() ? priceFilter(minPrice, maxPrice) : {};
    if (priceRange === null) {
      setLoading(false);
      setError('Khoảng giá không hợp lệ: nhập số nguyên từ 0, giá “Từ” không lớn hơn giá “Đến”.');
      return;
    }
    try {
      if (query.trim()) {
        const result = await searchWithTelemetry({ query: query.trim(), topK: 24, candidateK: 100, ...(categoryId ? { categoryIds: [Number(categoryId)] } : {}), ...(brandId ? { brandIds: [Number(brandId)] } : {}), ...(inStock ? { inStock: true } : {}), ...priceRange });
        if (requestId.current !== current) return;
        setTracking(analyticsToken(result.analytics)); setProducts(result.items.map((item) => item.product)); setSearched(true);
      } else {
        const filters = { limit: 24, ...(categoryId ? { categoryId: Number(categoryId) } : {}), ...(brandId ? { brandId: Number(brandId) } : {}), ...(inStock ? { inStock: true } : {}) };
        const page = await marketplaceApi.publicProducts(filters);
        if (requestId.current !== current) return;
        setProducts(page.items); setNextCursor(page.nextCursor); setAppliedFilters(filters);
        setSearched(false);
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

  const clearFilters = () => {
    setCategoryId(''); setBrandId(''); setInStock(false); setMinPrice(''); setMaxPrice('');
  };
  const keyword = query.trim();

  return <div className={`${styles.page} ${styles.buyerSurface}`}>
    {!!categories.length && <section className={styles.categoryShelf} aria-label="Khám phá danh mục">
      <h1>Danh mục</h1>
      <div className={styles.categoryChips}>{categories.map((category) => <button type="button" key={category.id} aria-pressed={categoryId === String(category.id)} onClick={() => pickCategory(String(category.id))}>{category.name}</button>)}</div>
    </section>}

    <div className={styles.searchLayout}>
      <form className={styles.filterPanel} onSubmit={submit} aria-label="Bộ lọc sản phẩm">
        <h2>Bộ lọc</h2>
        <label className={styles.filterField}>
          <span>Từ khóa</span>
          <input aria-label="Từ khóa" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tai nghe, loa, bàn phím..." />
        </label>
        <label className={styles.filterField}>
          <span>Danh mục</span>
          <select aria-label="Danh mục" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Mọi danh mục</option>{flatCategories.map((item) => <option key={item.id} value={item.id}>{'—'.repeat(item.depth)} {item.name}</option>)}</select>
        </label>
        <label className={styles.filterField}>
          <span>Thương hiệu</span>
          <select aria-label="Thương hiệu" value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">Mọi thương hiệu</option>{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </label>
        <fieldset className={styles.filterField} disabled={!keyword}>
          <legend>Khoảng giá</legend>
          <div className={styles.priceRange}>
            <input aria-label="Giá từ" inputMode="numeric" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="Từ ₫" />
            <input aria-label="Giá đến" inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Đến ₫" />
          </div>
          {!keyword && <small>Nhập từ khóa để lọc theo giá.</small>}
        </fieldset>
        <label className={styles.stockCheck}><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> Còn hàng</label>
        <button className={styles.filterSubmit} disabled={loading}>{loading ? 'Đang tìm…' : 'Tìm kiếm'}</button>
        <button type="button" className={styles.filterClear} onClick={clearFilters}>Xóa bộ lọc</button>
        {import.meta.env.VITE_IMAGE_SEARCH_ENABLED === 'true' && <p className={styles.hint}><Link to="/search/image">Tìm sản phẩm bằng ảnh</Link></p>}
      </form>

      <section className={styles.results} aria-live="polite">
        <header className={styles.resultsHeader}>
          <h2>{searched && initialQuery ? `Kết quả cho “${initialQuery}”` : searched ? 'Kết quả tìm kiếm' : (flatCategories.find((item) => item.id === appliedFilters?.categoryId)?.name ?? 'Sản phẩm mới')}</h2>
          {searched && <p className={styles.searchStats}>{products.length} kết quả</p>}
        </header>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!loading && !error && !products.length && nextCursor === null ? <StateCard title={searched ? 'Không có kết quả' : 'Chưa có sản phẩm'} role="status" action={searched ? { label: 'Xóa bộ lọc', onClick: clearFilters } : undefined}><p>{searched ? 'Không có kết quả phù hợp. Hãy thử từ khóa khác hoặc bỏ bớt bộ lọc.' : 'Chưa có sản phẩm phù hợp.'}</p></StateCard> : <div className={styles.grid}>{products.map((item) => <SearchResultCard key={`${tracking?.token??"catalog"}:${item.id}`} product={item} token={tracking?.token} />)}</div>}
        {nextCursor !== null && <div className={styles.loadMoreWrap}><button className={styles.loadMoreBtn} disabled={loading} onClick={() => void loadMore()}>Tải thêm sản phẩm</button></div>}
      </section>
    </div>
  </div>;
}

/** Whole-VND, non-negative, min ≤ max. {} when empty; null when invalid. */
export function priceFilter(min: string, max: string): { minPrice?: number; maxPrice?: number } | null {
  const parse = (value: string) => {
    const v = value.trim().replace(/[.\s]/g, '');
    if (!v) return undefined;
    if (!/^\d{1,12}$/.test(v)) return null;
    return Number(v);
  };
  const lo = parse(min), hi = parse(max);
  if (lo === null || hi === null) return null;
  if (lo !== undefined && hi !== undefined && lo > hi) return null;
  return { ...(lo !== undefined ? { minPrice: lo } : {}), ...(hi !== undefined ? { maxPrice: hi } : {}) };
}
