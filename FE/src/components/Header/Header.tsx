import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hasBuyerAccess } from '../../utils/buyerAccess';
import { NotificationBadge } from '../../features/notifications/NotificationsPage';
import { useAuth } from '../../contexts/useAuth';
import { ApiError } from '../../services/apiClient';
import styles from './Header.module.css';
import { CameraIcon, MagnifyingGlassIcon, ShoppingCartIcon } from '@heroicons/react/24/outline';

/**
 * Marketplace header: a slim utility row (role channels on the left; notifications,
 * messages, account and sign-out on the right) above logo + search + cart.
 * Accessible names are kept stable ("Giỏ hàng", "Tài khoản (…)", "Đăng xuất")
 * because route tests and browser QA drivers select by them.
 */
export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = async () => {
    setLogoutError(null);
    setIsLoggingOut(true);

    try {
      await logout();
      navigate('/');
    } catch (error) {
      setLogoutError(
        error instanceof ApiError
          ? error.message
          : 'Không thể đăng xuất. Vui lòng kiểm tra kết nối và thử lại.',
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  const displayName = user ? user.fullName || user.email : '';
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <header className={styles.header}>
      <div className={styles.utilityBar}>
        <div className={styles.utilityInner}>
          <nav className={styles.utilityLeft} aria-label="Kênh">
            {user?.role === 'SELLER' && <Link to="/seller">Kênh người bán</Link>}
            {user?.role === 'USER' && import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === 'true' && (
              <Link to="/account/store-application">Mở cửa hàng</Link>
            )}
            {user?.role === 'ADMIN' && <Link to="/admin">Quản trị</Link>}
            {!user && <span>Thanh toán khi nhận hàng hoặc qua VNPay</span>}
          </nav>

          <nav className={styles.utilityRight} aria-label="Tài khoản">
            {user ? (
              <>
                <NotificationBadge />
                {import.meta.env.VITE_CHAT_ENABLED === 'true' && user.role !== 'ADMIN' && (
                  <Link to="/messages">Tin nhắn</Link>
                )}
                <Link to="/account" className={styles.account} aria-label={`Tài khoản (${displayName})`}>
                  <span className={styles.avatar} aria-hidden="true">{initial}</span>
                  <span className={styles.accountName}>{displayName}</span>
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className={styles.logoutBtn}
                  disabled={isLoggingOut}
                >
                  {isLoggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
                </button>
              </>
            ) : (
              <>
                <Link to="/register">Đăng ký</Link>
                <span className={styles.utilityDivider} aria-hidden="true" />
                <Link to="/login">Đăng nhập</Link>
              </>
            )}
          </nav>
        </div>
      </div>

      <div className={styles.mainBar}>
        <Link to="/" className={styles.logo} aria-label="BCKL – Trang chủ">
          <span className={styles.logoMark} aria-hidden="true">B</span>
          <span className={styles.logoText}>BCKL</span>
        </Link>

        <form
          className={styles.search}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (searchQuery.trim()) {
              navigate(`/?q=${encodeURIComponent(searchQuery.trim())}`);
            }
          }}
        >
          <input
            aria-label="Tìm sản phẩm"
            type="search"
            placeholder="Tìm sản phẩm, thương hiệu..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {import.meta.env.VITE_IMAGE_SEARCH_ENABLED === 'true' && (
            <Link to="/search/image" className={styles.cameraBtn} title="Tìm sản phẩm bằng ảnh">
              <CameraIcon aria-hidden="true" />
              <span>Tìm ảnh</span>
            </Link>
          )}
          <button type="submit">
            <MagnifyingGlassIcon aria-hidden="true" />
            Tìm
          </button>
        </form>

        {user && hasBuyerAccess(user) ? (
          <Link to="/cart" className={styles.cartLink} aria-label="Giỏ hàng" title="Giỏ hàng">
            <ShoppingCartIcon aria-hidden="true" />
          </Link>
        ) : (
          <span className={styles.cartSpacer} aria-hidden="true" />
        )}
      </div>

      {logoutError && (
        <p className={styles.logoutError} role="alert">
          {logoutError}
        </p>
      )}
    </header>
  );
}
