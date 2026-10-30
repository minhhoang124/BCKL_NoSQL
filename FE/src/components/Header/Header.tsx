import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hasBuyerAccess } from '../../utils/buyerAccess';
import { NotificationBadge } from '../../features/notifications/NotificationsPage';
import { useAuth } from '../../contexts/useAuth';
import { ApiError } from '../../services/apiClient';
import styles from './Header.module.css';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const HOT_KEYWORDS = [
  'Áo len Noel',
  'Bàn phím cơ',
  'Tai nghe chống ồn',
  'Nến thơm Giáng sinh',
  'Quà tặng 2026',
];

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
      {/* Tier 1: Shopee Utility Strip with Noel Festive Accent */}
      <div className={styles.utilityBar}>
        <div className={styles.utilityInner}>
          <div className={styles.utilityLeft}>
            <span className={styles.festivePill}>🎄 Mùa Lễ Hội Noel 2026</span>
            <span className={styles.utilityDivider}>·</span>
            <span>Cam kết Chính hãng 100%</span>
            <span className={styles.utilityDivider}>·</span>
            <span>Freeship 0Đ toàn quốc</span>
          </div>
          <div className={styles.utilityRight}>
            <span>Đổi trả 7 ngày</span>
            <span className={styles.utilityDivider}>·</span>
            <span>Hỗ trợ 24/7: 1900 8822</span>
            <span className={styles.utilityDivider}>·</span>
            <span>Tiếng Việt</span>
          </div>
        </div>
      </div>

      {/* Tier 2 & 3: Main Search Header + Hot Keywords + Navigation */}
      <div className={styles.mainBar}>
        <div className={styles.logo}>
          <Link to="/">
            <span className={styles.santaHat} aria-hidden="true">🎅</span>
            BCKL
          </Link>
          <span className={styles.tagline}>Chợ hiện đại</span>
        </div>

        <div className={styles.search}>
          <div className={styles.searchBoxWrap}>
            <form
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
                placeholder="Tìm kiếm sản phẩm, thương hiệu, quà tặng Noel..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {import.meta.env.VITE_IMAGE_SEARCH_ENABLED === 'true' && (
                <Link
                  to="/search/image"
                  className={styles.cameraBtn}
                  title="Tìm kiếm sản phẩm bằng hình ảnh (AI CLIP)"
                >
                  <span aria-hidden="true">📷</span>
                  <span>AI Ảnh</span>
                </Link>
              )}
              <button type="submit">
                <MagnifyingGlassIcon aria-hidden="true" />
                Tìm
              </button>
            </form>
          </div>

          <div className={styles.hotKeywords} aria-label="Từ khóa phổ biến">
            {HOT_KEYWORDS.map((kw) => (
              <span
                key={kw}
                className={styles.keywordChip}
                onClick={() => {
                  setSearchQuery(kw);
                  navigate(`/?q=${encodeURIComponent(kw)}`);
                }}
              >
                {kw}
              </span>
            ))}
          </div>
        </div>

        <nav className={styles.nav}>
          {user ? (
            <>
              <Link to="/account" className={styles.accountLink}>
                Tài khoản ({user.fullName || user.email})
              </Link>
              {hasBuyerAccess(user) && (
                <Link to="/cart" className={styles.cartLink}>
                  Giỏ hàng
                </Link>
              )}
              <NotificationBadge />
              {import.meta.env.VITE_CHAT_ENABLED === 'true' && user.role !== 'ADMIN' && (
                <Link to="/messages">Tin nhắn</Link>
              )}
              {user.role === 'SELLER' && (
                <Link to="/seller" className={styles.roleBadgeLink}>
                  Kênh người bán
                </Link>
              )}
              {user.role === 'USER' && import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === 'true' && (
                <Link to="/account/store-application" className={styles.roleBadgeLink}>
                  Mở Store
                </Link>
              )}
              {user.role === 'ADMIN' && (
                <Link to="/admin" className={styles.roleBadgeLink}>
                  Quản trị
                </Link>
              )}
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
              <Link to="/login" className={styles.loginLink}>
                Đăng nhập
              </Link>
              <Link to="/register" className={styles.registerBtn}>
                Đăng ký
              </Link>
            </>
          )}
        </nav>
      </div>

      {logoutError && (
        <p className={styles.logoutError} role="alert">
          {logoutError}
        </p>
      )}
    </header>
  );
}
