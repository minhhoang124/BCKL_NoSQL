import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { hasBuyerAccess } from '../../utils/buyerAccess';
import styles from './AccountLayout.module.css';

/**
 * Shared shell for every "Tài khoản" page (Shopee-style): one left sidebar with the
 * signed-in identity and the account sections, page content on the right. Pages
 * rendered inside must not add their own sidebar or outer width.
 */
export function AccountLayout() {
  const { user } = useAuth();
  const name = user ? user.fullName || user.email : '';
  const buyer = !!user && hasBuyerAccess(user);
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? styles.active : undefined);
  return (
    <div className={styles.shell}>
      {user && (
        <aside className={styles.sidebar} aria-label="Tài khoản mua hàng">
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">{name.trim().charAt(0).toUpperCase() || '?'}</span>
            <div>
              <strong>{user.fullName || 'Tài khoản của bạn'}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <nav className={styles.nav} aria-label="Điều hướng tài khoản">
            <span className={styles.group}>Tài khoản của tôi</span>
            <NavLink to="/account" end className={link}>Hồ sơ của tôi</NavLink>
            {buyer && <NavLink to="/account/addresses" className={link}>Sổ địa chỉ</NavLink>}
            {buyer && <>
              <span className={styles.group}>Mua hàng</span>
              <NavLink to="/account/orders" className={link}>Đơn mua</NavLink>
              {import.meta.env.VITE_AFTERSALES_ENABLED !== 'false' && <NavLink to="/account/aftersales" className={link}>Yêu cầu hậu mãi</NavLink>}
              {import.meta.env.VITE_PRODUCT_REVIEWS_ENABLED === 'true' && <NavLink to="/account/reviews" className={link}>Đánh giá của tôi</NavLink>}
            </>}
            {import.meta.env.VITE_NOTIFICATIONS_ENABLED === 'true' && <NavLink to="/account/notifications" className={link}>Thông báo</NavLink>}
            {user.role !== 'ADMIN' && (user.role === 'SELLER' || import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === 'true') && (
              <NavLink to="/account/store-application" className={link}>Hồ sơ cửa hàng</NavLink>
            )}
          </nav>
        </aside>
      )}
      <div className={styles.main}>
        <Outlet />
      </div>
    </div>
  );
}
