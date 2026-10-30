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
          <span className={styles.kicker} aria-hidden="true">🎄 TRUNG TÂM TÀI KHOẢN &amp; BẢO MẬT</span>
          <h1>Thông tin tài khoản</h1>
        </div>
        <div className={styles.securitySeal} aria-hidden="true">
          <span>🛡️ Bảo vệ phiên đăng nhập &amp; Masked PII</span>
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
          <div className={styles.quickLinks}>
            {hasBuyerAccess(user) && <p><Link to="/account/addresses">Quản lý địa chỉ nhận hàng</Link></p>}
            {hasBuyerAccess(user) && <p><Link to="/account/orders">Đơn mua của tôi</Link></p>}
            {hasBuyerAccess(user) && <p><Link to="/account/aftersales">Yêu cầu hậu mãi của tôi</Link></p>}
            {user.role!=='ADMIN' && (user.role==='SELLER'||import.meta.env.VITE_SELLER_ONBOARDING_ENABLED==='true') && <p><Link to="/account/store-application">Đăng ký / quản lý hồ sơ Store</Link></p>}
          </div>
        </aside>

        <div className={styles.detailColumn}>
          <div className={styles.profileCard}>
            <div className={styles.profileHeader}>
              <h2>{user.fullName || user.email}</h2>
              <span className={user.isActive ? styles.activeBadge : styles.lockedBadge} aria-hidden="true">
                {user.isActive ? '✓ Đang bảo vệ' : 'Đã khóa'}
              </span>
            </div>
            <div className={styles.infoGrid}>
              <p>Email: {user.email}</p>
              <p>Vai trò: {user.role}</p>
              <p>ID: #{user.id}</p>
              <p>Trạng thái: {user.isActive ? 'Hoạt động' : 'Đã khóa'}</p>
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
