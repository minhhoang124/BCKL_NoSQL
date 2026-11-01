import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatPrice, marketplaceApi, mediaUrl } from '../services/marketplaceApi';
import type { Product } from '../types/marketplace';
import { ApiError, AuthSessionChangedError } from '../services/apiClient';
import styles from './Marketplace.module.css';
import { PublicProductReviews } from '../features/product-reviews/PublicProductReviews';
import { ProductPurchase } from '../features/seller-listing/ProductPurchase';
import { StateCard } from '../components/StateCard/StateCard';

export function ProductDetailPage() {
  const { id } = useParams();
  const [result, setResult] = useState<{ id: number; product?: Product; error?: string } | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const productId = Number(id); const invalidId = !Number.isInteger(productId) || productId < 1;
  useEffect(() => {
    if (invalidId) return;
    let active = true;
    // This endpoint returns public data only. Bootstrap/login may rotate the
    // session epoch while the initial GET is in flight; retry that read once.
    marketplaceApi.publicProduct(productId)
      .catch((error: unknown) => {
        if (active && error instanceof AuthSessionChangedError)
          return marketplaceApi.publicProduct(productId);
        throw error;
      })
      .then((product) => { if (active) { setResult({ id: productId, product }); setSelectedImageUrl(null); } })
      .catch((e) => { if (active) setResult({ id: productId, error: e instanceof ApiError ? e.message : 'Không thể tải sản phẩm.' }); });
    return () => { active = false; };
  }, [invalidId, productId]);
  const product = result?.id === productId ? result.product : undefined;
  const error = result?.id === productId ? result.error : undefined;
  if (invalidId) return <p className={styles.error} role="alert">Mã sản phẩm không hợp lệ.</p>;
  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!product) return <p>Đang tải sản phẩm…</p>;
  const primaryImage = product.images.find((item) => item.isPrimary) ?? product.images[0];
  const activeImageUrl = selectedImageUrl ?? primaryImage?.url;
  return <div className={styles.page}>
    <section className={styles.detail}>
      <div className={styles.galleryColumn}>
        <div className={styles.gallery}>
          {activeImageUrl ? <img src={mediaUrl(activeImageUrl)} alt={product.name} /> : <div className={styles.empty}>Chưa có ảnh</div>}
        </div>
        {product.images.length > 1 && (
          <div className={styles.thumbStrip} aria-hidden="true">
            {product.images.map((item) => (
              <div
                key={item.id}
                onMouseEnter={() => setSelectedImageUrl(item.url)}
                onClick={() => setSelectedImageUrl(item.url)}
                className={activeImageUrl === item.url ? `${styles.thumbItem} ${styles.thumbActive}` : styles.thumbItem}
              >
                <img src={mediaUrl(item.url)} alt="" />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.stickyBuyColumn}>
        <div className={styles.panel}>
          <div className={styles.badgeRow}>
            <span className={styles.badge}>{product.category.name}</span>
          </div>
          <h1 className={styles.productTitle}>{product.name}</h1>
          <p className={styles.storeMeta}>{product.brand?.name ?? 'Không thương hiệu'} · {product.store && <Link to={`/stores/${product.store.id}`}>{product.store.name}</Link>}</p>
          <div className={styles.priceBanner}>
            <strong className={styles.price}>{formatPrice(product.minPrice ?? product.variants[0]?.price)}</strong>
            <span className={product.inStock ? styles.inStockPill : styles.outStockPill}>{product.inStock ? 'Còn hàng' : 'Hết hàng'}</span>
          </div>
          <p className={styles.descriptionText}>{product.description || 'Sản phẩm chưa có mô tả.'}</p>
        </div>
        <ProductPurchase product={product} />
        {product.inStock === false && (
          <StateCard
            title="Sản phẩm đang hết hàng"
            role="status"
            action={import.meta.env.VITE_CHAT_ENABLED === 'true' && product.store
              ? { label: 'Chat với cửa hàng', to: `/messages?storeId=${product.store.id}&productId=${product.id}` }
              : undefined}
          >
            <p>Bạn vẫn có thể xem thông tin sản phẩm. Tạm thời chưa thể thêm sản phẩm này vào giỏ.</p>
          </StateCard>
        )}
        {import.meta.env.VITE_CHAT_ENABLED === 'true' && product.store && product.inStock !== false && (
          <div className={styles.chatStoreBar}>
            <Link to={`/messages?storeId=${product.store.id}&productId=${product.id}`} className={styles.chatStoreLink}>Chat với cửa hàng</Link>
          </div>
        )}
      </div>
    </section>
    {!!product.attributes?.length && <section className={styles.panel}><h2>Thông số</h2>{product.attributes.map((item) => <div className={styles.row} key={item.id}><span>{item.name}</span><strong>{String(item.value)}</strong></div>)}</section>}
    {import.meta.env.VITE_PRODUCT_REVIEWS_ENABLED === 'true' && <PublicProductReviews productId={product.id} />}
  </div>;
}
