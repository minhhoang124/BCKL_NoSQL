import { useAuth } from '../contexts/useAuth';
import { Link } from 'react-router-dom';
import { hasBuyerAccess } from '../utils/buyerAccess';
import styles from './AccountPage.module.css';
import { AccountSettings } from '../features/account-settings/AccountSettings';
import { EmailVerificationSettings } from '../features/auth-email/EmailRecoveryPages';

export function AccountPage() {
  const { user } = useAuth();

  if (!user) return null; // Will be caught by ProtectedRoute anyway

  return (
    <div className={styles.container}>
      <h1>Thông tin tài khoản</h1>
      <div className={styles.profileCard}>
        <h2>{user.fullName || user.email}</h2>
        <p>Email: {user.email}</p>
        <p>Vai trò: {user.role}</p>
        <p>ID: #{user.id}</p>
        <p>Trạng thái: {user.isActive ? 'Hoạt động' : 'Đã khóa'}</p>
        {hasBuyerAccess(user) && <p><Link to="/account/addresses">Quản lý địa chỉ nhận hàng</Link></p>}
        {hasBuyerAccess(user) && <p><Link to="/account/orders">Đơn mua của tôi</Link></p>}
        {hasBuyerAccess(user) && <p><Link to="/account/aftersales">Yêu cầu hậu mãi của tôi</Link></p>}
        {user.role!=='ADMIN' && (user.role==='SELLER'||import.meta.env.VITE_SELLER_ONBOARDING_ENABLED==='true') && <p><Link to="/account/store-application">Đăng ký / quản lý hồ sơ Store</Link></p>}
      </div>
      {import.meta.env.VITE_ACCOUNT_SETTINGS_ENABLED === 'true' && <AccountSettings />}
      {import.meta.env.VITE_AUTH_EMAIL_ENABLED === 'true' && <EmailVerificationSettings />}
    </div>
  );
}
