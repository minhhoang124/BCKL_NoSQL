import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatPrice, marketplaceApi, mediaUrl } from '../services/marketplaceApi';
import type { Product } from '../types/marketplace';
import { ApiError, AuthSessionChangedError } from '../services/apiClient';
import styles from './Marketplace.module.css';
import { PublicProductReviews } from '../features/product-reviews/PublicProductReviews';
import { ProductPurchase } from '../features/seller-listing/ProductPurchase';

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
  return <div className={`${styles.page} ${styles.buyerSurface}`}>
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
          <p className={styles.storeMeta}>{product.category.name}</p>
          <h1 className={styles.productTitle}>{product.name}</h1>
          {product.brand && <p className={styles.storeMeta}>{product.brand.name}</p>}
          <div className={styles.priceBanner}>
            <strong className={styles.price}>{formatPrice(product.minPrice ?? product.variants[0]?.price)}</strong>
            {product.inStock === false && <span className={styles.outStockPill}>Hết hàng</span>}
          </div>
        </div>
        <div className={styles.purchaseArea}>
          {/* Options render once inside ProductPurchase: read-only chips for guests, selectors for buyers. */}
          <ProductPurchase product={product} />
        </div>
      </div>
    </section>
    {product.store && <section className={`${styles.panel} ${styles.shopCard}`} aria-label="Cửa hàng">
      <div><h2>{product.store.name}</h2><Link className={styles.shopLink} to={`/stores/${product.store.id}`}>Xem shop</Link></div>
      {import.meta.env.VITE_CHAT_ENABLED === 'true' && <Link className={styles.shopLink} to={`/messages?storeId=${product.store.id}&productId=${product.id}`}>Chat với cửa hàng</Link>}
    </section>}
    {!!product.attributes?.length && <section className={styles.panel}><h2>Thông số</h2><table className={styles.attributeTable}><tbody>{product.attributes.map((item) => <tr key={item.id}><th scope="row">{item.name}</th><td>{String(item.value ?? '—')}</td></tr>)}</tbody></table></section>}
    {product.description && <section className={styles.panel}><h2>Mô tả sản phẩm</h2><p className={styles.descriptionText}>{product.description}</p></section>}
    {import.meta.env.VITE_PRODUCT_REVIEWS_ENABLED === 'true' && <PublicProductReviews productId={product.id} />}
  </div>;
}
