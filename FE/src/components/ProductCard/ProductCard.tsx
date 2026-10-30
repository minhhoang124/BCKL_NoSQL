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
        <span className={product.brand ? styles.mallBadge : styles.noelBadge} aria-hidden="true">
          {product.brand ? '✓ Chính hãng' : '🎄 Noel Deal'}
        </span>
        {secondaryImage && (
          <span className={styles.angleBadge} aria-hidden="true">
            2 góc ảnh
          </span>
        )}
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
        <p className={styles.meta}>
          {product.category.name}
          {product.brand ? ` · ${product.brand.name}` : ''}
        </p>
        <Link to={`/products/${product.id}`} className={styles.name}>
          {product.name}
        </Link>
        <div className={styles.priceRow}>
          <strong className={styles.price}>
            {formatPrice(product.minPrice ?? product.variants[0]?.price)}
          </strong>
          <span className={styles.promoMini} aria-hidden="true">
            Voucher Noel
          </span>
        </div>
        <div className={styles.statusRow}>
          <span className={product.inStock === false ? styles.out : styles.stock}>
            {product.inStock === false ? 'Hết hàng' : 'Còn hàng'}
          </span>
          <span className={styles.ratingTag} aria-hidden="true">
            ★ 4.9
          </span>
        </div>
      </div>
    </article>
  );
}
