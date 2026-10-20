import { useMemo, useState } from 'react';
import { AuthContext } from '../contexts/useAuth';
import { ApiError } from '../services/apiClient';
import { AdminAccountsReader } from '../features/admin-accounts/AdminAccountsReader';
import { createAccountReadApi } from '../features/admin-accounts/accountReadApi';
import type { AdminAccount } from '../features/admin-accounts/accountReadApi';

const examples: AdminAccount[] = [
  { id: 1, fullName: 'Nguyễn Minh An (mẫu)', email: 'buyer-a@example.test', role: 'USER', isActive: true, store: null },
  { id: 2, fullName: 'Cửa hàng Minh Họa', email: 'seller-a@example.test', role: 'SELLER', isActive: true, store: { id: 10, name: 'Store mẫu A', status: 'SUSPENDED' } },
  { id: 3, fullName: null, email: 'buyer-inactive@example.test', role: 'USER', isActive: false, store: null },
  { id: 4, fullName: 'Admin mẫu', email: 'admin-sample@example.test', role: 'ADMIN', isActive: true, store: null },
  { id: 5, fullName: 'Seller mẫu', email: 'email-minh-hoa-rat-dai-kiem-tra-mobile@example.test', role: 'SELLER', isActive: false, store: { id: 11, name: 'Store mẫu B', status: 'ACTIVE' } },
].map(row => ({ ...row, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' } as AdminAccount));
export function AdminAccountsReadPreview() {
  const [mode, setMode] = useState('ready');
  const api = useMemo(() => createAccountReadApi(async (path, options) => {
    // Deliberately local synthetic transport: no fetch, token, storage or Backend.
    if (mode === 'loading') return new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
    if (mode === 'error') throw new Error('Synthetic network error');
    if (mode === 'unauthorized') throw new ApiError('Synthetic expired session', 401);
    if (mode === 'forbidden') throw new ApiError('Synthetic missing permission', 403);
    const params = new URL(path, 'https://preview.invalid').searchParams;
    const q = (params.get('q') ?? '').toLocaleLowerCase('vi');
    const afterId = Number(params.get('afterId') ?? 0);
    const role = params.get('role'); const active = params.get('isActive'); const limit = Number(params.get('limit'));
    const remaining = mode === 'empty' ? [] : examples.filter(row => row.id > afterId && (!role || row.role === role) &&
      (active === null || row.isActive === (active === 'true')) && `${row.email} ${row.fullName ?? ''}`.normalize('NFC').toLocaleLowerCase('vi').includes(q));
    const items = remaining.slice(0, limit);
    return { items, nextCursor: remaining.length > limit ? items.at(-1)!.id : null };
  }), [mode]);
  return <>
    <div style={{ padding: 12, color: '#20242b', background: '#fff', colorScheme: 'light' }}>
      <p><strong>API GIẢ LẬP — KHÔNG PHẢI BACKEND/POSTGRESQL.</strong> Tài khoản, Store và ID đều là mẫu. Không dùng để nghiệm thu runtime.</p>
      <label>Ca đọc Accounts <select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="ready">Danh sách và phân trang</option><option value="empty">Rỗng</option><option value="loading">Đang tải</option>
        <option value="error">Lỗi mạng</option><option value="unauthorized">401 hết phiên</option><option value="forbidden">403 mất quyền</option><option value="unconnected">Chưa kết nối</option>
      </select></label>
    </div>
    <AuthContext.Provider value={{ user: { id: 999999, email: 'admin-preview@example.test', fullName: 'Admin mẫu', role: 'ADMIN', isActive: true },
      loading: false, login: () => {}, logout: async () => {}, refresh: async () => {} }}>
      <AdminAccountsReader key={mode} api={mode === 'unconnected' ? undefined : api} pageSize={2} />
    </AuthContext.Provider>
  </>;
}
