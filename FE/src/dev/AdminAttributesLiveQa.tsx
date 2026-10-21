import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../contexts/useAuth';
import { LoginPage } from '../pages/LoginPage';
import { API_URL } from '../services/apiClient';
import { AdminCategoryAttributesReader } from '../features/admin-category-attributes/AdminCategoryAttributesReader';
import { createAttributeReadApi } from '../features/admin-category-attributes/attributeReadApi';
import type { AttributeReadApi } from '../features/admin-category-attributes/attributeReadApi';
import styles from './AdminAttributesLiveQa.module.css';

// Real shared GET adapter; no synthetic identity, token or fixture transport.
const liveReadApi = createAttributeReadApi();
function positive(raw: string, max: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= max && String(value) === raw.trim() ? value : null;
}
export function AdminAttributesLiveQa({ api = liveReadApi }: { api?: AttributeReadApi }) {
  const { user, loading, logout } = useAuth();
  const [category, setCategory] = useState('');
  const [pageSize, setPageSize] = useState('2');
  const [config, setConfig] = useState<{ categoryId: number; pageSize: number } | null>(null);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true); setConfig(null); setError('');
    try { await logout(); }
    catch { setError('Chưa xác nhận được đăng xuất. Không nhận ca đăng xuất đã đạt.'); }
    finally { setSigningOut(false); }
  }
  function apply(event: FormEvent) {
    event.preventDefault(); setError(''); setConfig(null);
    const categoryId = positive(category, 2147483647), size = positive(pageSize, 100);
    if (categoryId === null || size === null) {
      setError('Category ID phải là số nguyên dương tối đa 2147483647; cỡ trang từ 1 đến 100.'); return;
    }
    setConfig({ categoryId, pageSize: size });
  }
  return <main className={styles.root}>
    <header><h1>QA Attributes — Backend thật, chỉ đọc</h1>
      <p>Trang DEV riêng, không phải Catalog production. Đăng nhập qua AuthProvider thật; không dùng Admin hoặc response mẫu.</p>
      <p>API: <code>{API_URL}</code>. Chỉ dùng PostgreSQL QA riêng. Không bật tạo/sửa hoặc gọi PATCH legacy.</p>
    </header>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Đang kiểm tra phiên QA…</p> : !user ? <LoginPage /> : <>
      <p>Phiên: {user.fullName || user.email} · {user.role}</p>
      <button disabled={signingOut} onClick={() => void signOut()}>Đăng xuất QA</button>
      {!user.isActive || user.role !== 'ADMIN' ? <p role="alert">Cần tài khoản Admin đang hoạt động; chưa gọi API Attributes.</p> : <>
        <form onSubmit={apply} aria-label="Cấu hình QA chỉ đọc">
          <label>Category ID QA <input value={category} onChange={e => setCategory(e.target.value)} inputMode="numeric" /></label>
          <label>Cỡ trang QA <input value={pageSize} onChange={e => setPageSize(e.target.value)} inputMode="numeric" /></label>
          <button type="submit">Mở bộ đọc thật</button>
        </form>
        {config && <AdminCategoryAttributesReader key={`${user.id}:${config.categoryId}`} {...config} api={api} />}
      </>}
    </>}
  </main>;
}
