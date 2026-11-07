import { useMemo, useState } from 'react';
import { AuthContext } from '../contexts/useAuth';
import { ApiError } from '../services/apiClient';
import { AdminCategoryAttributesReader } from '../features/admin-category-attributes/AdminCategoryAttributesReader';
import { createAttributeReadApi } from '../features/admin-category-attributes/attributeReadApi';

const definitions = [
  { id: 1, name: 'Kết nối (mẫu)', slug: 'ket-noi', dataType: 'SINGLE_SELECT', isActive: true },
  { id: 2, name: 'Khối lượng (mẫu)', slug: 'khoi-luong', dataType: 'NUMBER', isActive: true },
  { id: 3, name: 'Chống nước (mẫu)', slug: 'chong-nuoc', dataType: 'BOOLEAN', isActive: false },
].map(row => ({ ...row, categoryId: 12, revision: 3, isRequired: false, isFilterable: false, allowsCustom: false,
  sortOrder: 0, usage: { referencedProductCount: 0 }, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' }));
const options = ['Bluetooth (mẫu)', 'Có dây (mẫu)', 'Wi-Fi (mẫu)'].map((value, i) => ({ id: i + 1, attributeDefinitionId: 1,
  value, slug: `option-${i + 1}`, sortOrder: i, isActive: i !== 1, referencedProductCount: 0 }));

export function AdminAttributeReadPreview() {
  const [mode, setMode] = useState('ready');
  const api = useMemo(() => createAttributeReadApi(async path => {
    // Local synthetic transport: never calls fetch, Backend, refresh or storage.
    if (mode === 'error') throw new Error('Synthetic network error');
    if (mode === 'forbidden') throw new ApiError('Synthetic forbidden', 403);
    if (mode === 'expired') throw new ApiError('Synthetic expired', 401);
    const url = new URL(path, 'https://preview.invalid');
    if (/\/attributes\/\d+$/.test(url.pathname)) return definitions.find(row => row.id === Number(url.pathname.split('/').at(-1)));
    const isOptions = url.pathname.endsWith('/options');
    const source = isOptions ? options : definitions;
    const limit = Number(url.searchParams.get('limit'));
    const afterId = Number(url.searchParams.get('afterId') ?? 0);
    const active = url.searchParams.get('isActive');
    const remaining = mode === 'empty' ? [] : source.filter(row => row.id > afterId && (active === null || row.isActive === (active === 'true')));
    const items = remaining.slice(0, limit);
    return { items, nextCursor: remaining.length > limit ? items.at(-1)!.id : null,
      ...(isOptions ? { definitionRevision: mode === 'revision' && afterId > 0 ? 4 : 3 } : {}) };
  }), [mode]);
  return <>
    <div style={{ padding: 12, color: '#20242b', background: '#fff', colorScheme: 'light' }}>
      <p><strong>API GIẢ LẬP — KHÔNG PHẢI BACKEND/POSTGRESQL.</strong> Admin, ID, revision, usage đều là mẫu; không dùng nghiệm thu runtime.</p>
      <label>Ca đọc giả lập <select value={mode} onChange={e => setMode(e.target.value)}>
        <option value="ready">Đọc và phân trang</option><option value="revision">Revision đổi ở trang options thứ hai</option>
        <option value="empty">Rỗng</option><option value="error">Lỗi mạng</option><option value="forbidden">403 mất quyền</option><option value="expired">401 hết phiên</option>
      </select></label>
    </div>
    <AuthContext.Provider value={{ user: { id: 999999, email: 'admin-preview@example.test', fullName: 'Admin mẫu', role: 'ADMIN', isActive: true },
      loading: false, login: () => {}, logout: async () => {}, refresh: async () => {} }}>
      <AdminCategoryAttributesReader key={mode} categoryId={12} api={api} pageSize={2} />
    </AuthContext.Provider>
  </>;
}
