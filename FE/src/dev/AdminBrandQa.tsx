import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthProvider';
import { useAuth } from '../contexts/useAuth';
import { LoginPage } from '../pages/LoginPage';
import { AdminBrandEditor } from '../features/admin-brands/AdminBrandEditor';
import '../index.css';

export function BrandQa() {
  const { user, loading } = useAuth();
  return <>
    <aside>LOCAL QA — gọi Backend thật, thay đổi được lưu vào database QA. Chỉ dùng môi trường riêng; không có tài khoản/token mẫu. Chưa tích hợp router Admin.</aside>
    {loading ? <p role="status">Đang xác thực…</p> : user ? <AdminBrandEditor /> : <LoginPage />}
  </>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(import.meta.env.DEV
  ? <StrictMode><MemoryRouter><AuthProvider><BrandQa /></AuthProvider></MemoryRouter></StrictMode>
  : <p>Trang QA chỉ dùng trong development.</p>);
