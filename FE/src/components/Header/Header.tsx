import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hasBuyerAccess } from '../../utils/buyerAccess';
import { NotificationBadge } from '../../features/notifications/NotificationsPage';
import { useAuth } from '../../contexts/useAuth';
import { ApiError } from '../../services/apiClient';
import styles from './Header.module.css';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

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

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <Link to="/">BCKL</Link>
        <span className={styles.tagline}>Chợ hiện đại</span>
      </div>
      <div className={styles.search}>
        <form onSubmit={(e) => { e.preventDefault(); if (searchQuery.trim()) navigate(`/?q=${encodeURIComponent(searchQuery.trim())}`); }}>
          <input aria-label="Tìm sản phẩm" type="search" placeholder="Tìm kiếm sản phẩm..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          <button type="submit"><MagnifyingGlassIcon aria-hidden="true" />Tìm</button>
        </form>
      </div>
      <nav className={styles.nav}>
        {user ? (
          <>
            <Link to="/account">Tài khoản ({user.fullName || user.email})</Link>
            {hasBuyerAccess(user) && <Link to="/cart">Giỏ hàng</Link>}
            <NotificationBadge />
            {import.meta.env.VITE_CHAT_ENABLED === 'true' && user.role !== 'ADMIN' && <Link to="/messages">Tin nhắn</Link>}
            {user.role === 'SELLER' && <Link to="/seller">Kênh người bán</Link>}
            {user.role === 'USER' && import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === 'true' && <Link to="/account/store-application">Mở Store</Link>}
            {user.role === 'ADMIN' && <Link to="/admin">Quản trị</Link>}
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
            <Link to="/login">Đăng nhập</Link>
            <Link to="/register" className={styles.registerBtn}>Đăng ký</Link>
          </>
        )}
      </nav>
      {logoutError && (
        <p className={styles.logoutError} role="alert">
          {logoutError}
        </p>
      )}
    </header>
  );
}
