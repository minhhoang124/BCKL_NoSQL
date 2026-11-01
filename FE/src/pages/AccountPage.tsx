import { useAuth } from '../contexts/useAuth';
import { Link } from 'react-router-dom';
import { hasBuyerAccess } from '../utils/buyerAccess';
import styles from './AccountPage.module.css';
import { AccountSettings } from '../features/account-settings/AccountSettings';
import { EmailVerificationSettings } from '../features/auth-email/EmailRecoveryPages';
import { GoogleLink } from '../features/auth-google/GoogleAuth';
import { PhoneOtpSettings } from '../features/phone-otp/PhoneOtpSettings';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(6, local.length - 2))}@${domain}`;
}

export function AccountPage() {
  const { user } = useAuth();

  if (!user) return null; // Will be caught by ProtectedRoute anyway

  const avatarInitial = (user.fullName || user.email || 'U').trim().slice(0, 1).toUpperCase();

  return (
    <div className={styles.container}>
      <div className={styles.headerBanner}>
        <div>
          <h1>Thông tin tài khoản</h1>
        </div>
        <div className={styles.securitySeal} aria-hidden="true">
          <span>Email tài khoản</span>
          <strong>{maskEmail(user.email)}</strong>
        </div>
      </div>

      <div className={styles.masterDetail}>
        <aside className={styles.sidebar}>
          <div className={styles.userBrief} aria-hidden="true">
            <div className={styles.avatarCircle}>{avatarInitial}</div>
            <div className={styles.userBriefMeta}>
              <strong>{user.fullName || 'Thành viên BCKL'}</strong>
              <span>{maskEmail(user.email)}</span>
            </div>
          </div>
          <div className={styles.quickNav}>
            <span className={styles.quickNavTitle}>Tài khoản của tôi</span>
            <p><Link to="/account" className={styles.quickNavActive}>Hồ sơ &amp; Bảo mật</Link></p>
            {hasBuyerAccess(user) && <p><Link to="/account/addresses">Quản lý địa chỉ nhận hàng</Link></p>}
            {hasBuyerAccess(user) && <p><Link to="/account/orders">Đơn mua của tôi</Link></p>}
            {hasBuyerAccess(user) && <p><Link to="/account/aftersales">Yêu cầu hậu mãi</Link></p>}
            {user.role !== 'ADMIN' && (user.role === 'SELLER' || import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === 'true') && (
              <p><Link to="/account/store-application">Đăng ký / quản lý hồ sơ Store</Link></p>
            )}
          </div>
        </aside>

        <div className={styles.detailColumn}>
          <div className={styles.profileCard}>
            <div className={styles.profileHeader}>
              <div>
                <h2>Hồ sơ của tôi</h2>
                <p className={styles.profileSubtitle}>Quản lý thông tin hồ sơ để bảo mật tài khoản</p>
              </div>
              {!user.isActive && <span className={styles.lockedBadge}>Đã khóa</span>}
            </div>
            <div className={styles.infoGrid}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Họ và tên</span>
                <span className={styles.infoValue}>{user.fullName || 'Chưa thiết lập'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Email</span>
                <span className={styles.infoValue}>{maskEmail(user.email)}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Trạng thái tài khoản</span>
                <span className={styles.infoValue}>
                  <span className={user.isActive ? styles.statusActiveDot : styles.statusLockedDot}>●</span>
                  {' '}{user.isActive ? 'Tài khoản hoạt động bình thường' : 'Tài khoản đang bị tạm khóa'}
                </span>
              </div>
            </div>
          </div>
          {import.meta.env.VITE_ACCOUNT_SETTINGS_ENABLED === 'true' && <AccountSettings />}
          {import.meta.env.VITE_AUTH_EMAIL_ENABLED === 'true' && <EmailVerificationSettings />}
          <GoogleLink />
          <PhoneOtpSettings />
        </div>
      </div>
    </div>
  );
}
