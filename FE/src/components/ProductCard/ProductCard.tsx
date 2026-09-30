import { Link } from 'react-router-dom';
import type { Product } from '../../types/marketplace';
import { formatPrice, mediaUrl } from '../../services/marketplaceApi';
import styles from './ProductCard.module.css';


export function ProductCard({ product }: { product: Product }) {
  const image = product.images.find((item) => item.isPrimary) ?? product.images[0];
  return (
    <article className={styles.card}>
      <Link to={`/products/${product.id}`} className={styles.imageWrap}>
        {image ? <img src={mediaUrl(image.url)} alt={product.name} /> : <span>Chưa có ảnh</span>}
      </Link>
      <div className={styles.body}>
        <p className={styles.meta}>{product.category.name}{product.brand ? ` · ${product.brand.name}` : ''}</p>
        <Link to={`/products/${product.id}`} className={styles.name}>{product.name}</Link>
        <strong>{formatPrice(product.minPrice ?? product.variants[0]?.price)}</strong>
        <span className={product.inStock === false ? styles.out : styles.stock}>{product.inStock === false ? 'Hết hàng' : 'Còn hàng'}</span>
      </div>
    </article>
  );
}
