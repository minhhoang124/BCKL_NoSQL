import { useAuth } from '../contexts/useAuth';
import { Link } from 'react-router-dom';
import styles from './AccountPage.module.css';

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
        {user.role === 'USER' && user.isActive && <p><Link to="/account/addresses">Quản lý địa chỉ nhận hàng</Link></p>}
      </div>
    </div>
  );
}
