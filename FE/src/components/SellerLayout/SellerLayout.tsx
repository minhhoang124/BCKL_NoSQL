import { NavLink, Outlet } from 'react-router-dom';
import styles from '../../pages/Marketplace.module.css';

/**
 * Seller Centre shell for the seller sub-pages (orders, after-sales, reviews). It mirrors
 * the sidebar of SellerDashboardPage so every seller screen shares one navigation.
 * Product / store / statistics live on /seller and are opened through ?tab=.
 */
export function SellerLayout() {
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? styles.scNavActive : undefined);
  return (
    <div className={styles.scShell}>
      <aside className={styles.scSidebar} aria-label="Kênh người bán">
        <div className={styles.scStoreCard}>
          <span className={styles.scBrand}>Kênh người bán</span>
        </div>
        <nav className={styles.scNav}>
          <span className={styles.scNavGroup}>Sản phẩm</span>
          <NavLink to="/seller?tab=products" end>Sản phẩm của tôi</NavLink>
          <span className={styles.scNavGroup}>Đơn hàng</span>
          <NavLink to="/seller/orders" className={link}>Đơn hàng của cửa hàng</NavLink>
          <NavLink to="/seller/aftersales" className={link}>Xử lý hậu mãi</NavLink>
          {import.meta.env.VITE_PRODUCT_REVIEWS_ENABLED === 'true' && <NavLink to="/seller/reviews" className={link}>Phản hồi đánh giá</NavLink>}
          <span className={styles.scNavGroup}>Cửa hàng</span>
          <NavLink to="/seller?tab=store" end>Cửa hàng</NavLink>
          <NavLink to="/seller?tab=dashboard" end>Thống kê</NavLink>
        </nav>
      </aside>
      <div className={styles.scMain}>
        <Outlet />
      </div>
    </div>
  );
}
