import { useAuth } from '../contexts/useAuth';
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

  return (
    <div className={styles.container}>
      <div className={styles.masterDetail}>
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
