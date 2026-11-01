import { Link } from 'react-router-dom';
import type { Product } from '../../types/marketplace';
import { formatPrice, mediaUrl } from '../../services/marketplaceApi';
import styles from './ProductCard.module.css';

export function ProductCard({ product }: { product: Product }) {
  const image = product.images.find((item) => item.isPrimary) ?? product.images[0];
  const secondaryImage = image
    ? product.images.find((item) => item.id !== image.id && item.url !== image.url)
    : undefined;

  return (
    <article className={styles.card}>
      <Link to={`/products/${product.id}`} className={styles.imageWrap}>
        {image ? (
          <>
            <img
              src={mediaUrl(image.url)}
              alt={product.name}
              className={secondaryImage ? styles.primaryImg : styles.singleImg}
            />
            {secondaryImage && (
              <img
                src={mediaUrl(secondaryImage.url)}
                alt=""
                aria-hidden="true"
                className={styles.secondaryImg}
              />
            )}
          </>
        ) : (
          <span className={styles.noImage}>Chưa có ảnh</span>
        )}
      </Link>
      <div className={styles.body}>
        <Link to={`/products/${product.id}`} className={styles.name}>
          {product.name}
        </Link>
        <div className={styles.priceRow}>
          <strong className={styles.price}>
            {formatPrice(product.minPrice ?? product.variants[0]?.price)}
          </strong>
        </div>
        <div className={styles.statusRow}>
          {product.inStock === false && <span className={styles.out}>Hết hàng</span>}
          {product.store && (
            <span className={styles.storeName}>{product.store.name}</span>
          )}
        </div>
      </div>
    </article>
  );
}
