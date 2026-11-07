import { useMemo, useState } from 'react';
import { AuthContext } from '../contexts/useAuth';
import { ApiError } from '../services/apiClient';
import { AdminBrandEditor } from '../features/admin-brands/AdminBrandEditor';
import type { BrandApi, AdminBrand } from '../features/admin-brands/brandApi';
import styles from './AdminBrandPreview.module.css';

function createPreviewApi(mode: string): BrandApi {
    let rows: AdminBrand[] = [{ id: 1, name: 'Thương hiệu minh họa', slug: 'thuong-hieu-minh-hoa', isActive: true }, { id: 2, name: 'Mẫu đã tắt', slug: 'mau-da-tat', isActive: false }];
    let reloadFails = false;
    return {
      async list() { if (reloadFails) throw new Error('Lỗi tải lại minh họa'); return rows.map(row => ({ ...row })); },
      async update(id, patch) {
        if (mode === 'conflict') throw new ApiError('Slug thương hiệu đã tồn tại (minh họa).', 409);
        rows = rows.map(row => row.id === id ? { ...row, ...patch } : row);
        if (mode === 'unknown') throw new Error('Mất phản hồi minh họa');
        if (mode === 'reload-error') reloadFails = true;
        return { ...rows.find(row => row.id === id)!, searchReconciliation: patch.name ? { jobId: 'demo-job', status: 'PENDING' } : null };
      },
    };
}

export function AdminBrandPreviewControls() {
  const [mode, setMode] = useState('normal');
  const api = useMemo(() => createPreviewApi(mode), [mode]);
  return <>
    <aside className={styles.banner}><strong>PREVIEW: tài khoản, thương hiệu, job và kết quả đều minh họa; không gọi Backend, không lưu DB.</strong>
      <label>Tình huống minh họa<select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="normal">Lưu bình thường</option><option value="conflict">Slug trùng 409</option>
        <option value="reload-error">Đã lưu nhưng tải lại lỗi</option><option value="unknown">Mất phản hồi, khóa ghi</option>
      </select></label><p>Đổi tình huống sẽ đặt lại mẫu; không phải khôi phục yêu cầu thật. Module chưa nối vào Admin #28.</p>
    </aside>
    <AuthContext.Provider value={{ user: { id: 999999, email: 'admin-preview@example.test', fullName: 'Admin minh họa', role: 'ADMIN', isActive: true }, loading: false, login: () => {}, logout: async () => {}, refresh: async () => {} }}>
      <AdminBrandEditor key={mode} api={api} />
    </AuthContext.Provider>
  </>;
}
