import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatPrice, marketplaceApi, mediaUrl } from '../services/marketplaceApi';
import type { Product } from '../types/marketplace';
import { ApiError } from '../services/apiClient';
import styles from './Marketplace.module.css';

export function ProductDetailPage() {
  const { id } = useParams();
  const [result, setResult] = useState<{ id: number; product?: Product; error?: string } | null>(null);
  const productId = Number(id); const invalidId = !Number.isInteger(productId) || productId < 1;
  useEffect(() => {
    if (invalidId) return;
    let active = true;
    marketplaceApi.publicProduct(productId)
      .then((product) => { if (active) setResult({ id: productId, product }); })
      .catch((e) => { if (active) setResult({ id: productId, error: e instanceof ApiError ? e.message : 'Không thể tải sản phẩm.' }); });
    return () => { active = false; };
  }, [invalidId, productId]);
  const product = result?.id === productId ? result.product : undefined;
  const error = result?.id === productId ? result.error : undefined;
  if (invalidId) return <p className={styles.error} role="alert">Mã sản phẩm không hợp lệ.</p>;
  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!product) return <p>Đang tải sản phẩm…</p>;
  const image = product.images.find((item) => item.isPrimary) ?? product.images[0];
  return <div className={styles.page}>
    <section className={styles.detail}>
      <div className={styles.gallery}>{image ? <img src={mediaUrl(image.url)} alt={product.name} /> : <div className={styles.empty}>Chưa có ảnh</div>}</div>
      <div className={styles.panel}><span className={styles.badge}>{product.category.name}</span><h1>{product.name}</h1><p>{product.brand?.name ?? 'Không thương hiệu'} · {product.store?.name}</p><strong className={styles.price}>{formatPrice(product.minPrice ?? product.variants[0]?.price)}</strong><p>{product.inStock ? 'Còn hàng' : 'Hết hàng'}</p><p>{product.description || 'Sản phẩm chưa có mô tả.'}</p></div>
    </section>
    {import.meta.env.VITE_CHAT_ENABLED === 'true' && product.store && <Link to={`/messages?storeId=${product.store.id}`}>Chat với cửa hàng</Link>}
    {!!product.attributes?.length && <section className={styles.panel}><h2>Thông số</h2>{product.attributes.map((item) => <div className={styles.row} key={item.id}><span>{item.name}</span><strong>{String(item.value)}</strong></div>)}</section>}
  </div>;
}
