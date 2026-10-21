import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminAttributeReadPreview } from './AdminAttributeReadPreview';
import { AdminCategoryAttributesLayout } from '../features/admin-category-attributes/AdminCategoryAttributesLayout';
import type { CategoryAttributeExample, LayoutState } from '../features/admin-category-attributes/AdminCategoryAttributesLayout';
import '../index.css';

// Synthetic examples only. Never derived from live catalog or user data.
const examples: readonly CategoryAttributeExample[] = [
  { sampleKey: 'DEMO-01', name: 'Kết nối', slug: 'ket-noi', dataType: 'SINGLE_SELECT', isRequired: true, isFilterable: true, allowsCustom: false, sortOrder: 0, isActive: true, revision: 3, usage: 6,
    options: [{ sampleKey: 'OPTION-01', value: 'Bluetooth', slug: 'bluetooth', sortOrder: 0, isActive: true, usage: 6 }, { sampleKey: 'OPTION-02', value: 'Có dây', slug: 'co-day', sortOrder: 1, isActive: false, usage: 0 }] },
  { sampleKey: 'DEMO-02', name: 'Khối lượng mô tả', slug: 'khoi-luong-mo-ta', dataType: 'NUMBER', isRequired: false, isFilterable: false, allowsCustom: true, sortOrder: 1, isActive: true, revision: 1, usage: 0, options: [] },
  { sampleKey: 'DEMO-03', name: 'Chống nước', slug: 'chong-nuoc', dataType: 'BOOLEAN', isRequired: false, isFilterable: false, allowsCustom: true, sortOrder: 2, isActive: false, revision: 2, usage: null, options: [] },
  { sampleKey: 'DEMO-04', name: 'Ghi chú vật liệu', slug: 'ghi-chu-vat-lieu', dataType: 'TEXT', isRequired: false, isFilterable: false, allowsCustom: true, sortOrder: 3, isActive: true, revision: 1, usage: 2, options: [] },
];
export default function Preview() {
  const [readMode, setReadMode] = useState(false);
  const [mode, setMode] = useState<LayoutState | 'unconnected' | 'empty'>('ready');
  if (readMode) return <><button onClick={() => setReadMode(false)}>Trở về editor minh họa</button><AdminAttributeReadPreview /></>;
  return <><div style={{ padding: 12, color: '#20242b', background: '#fff', colorScheme: 'light', fontFamily: 'Segoe UI, sans-serif' }}>
    <button onClick={() => setReadMode(true)}>Xem bộ đọc API giả lập</button>{' '}
    <label>Chế độ minh họa (không gửi API): <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} style={{ color: '#20242b', background: '#fff', minHeight: 44 }}>
      <option value="ready">Dữ liệu mẫu</option><option value="unconnected">Chưa nối API</option><option value="empty">Mẫu rỗng</option><option value="loading">Đang tải</option><option value="error">Lỗi tải</option><option value="pending">Đang gửi (minh họa)</option><option value="stale">Xung đột phiên bản</option><option value="unknown">Chưa rõ kết quả ghi</option>
    </select></label>
  </div><AdminCategoryAttributesLayout examples={mode === 'unconnected' ? undefined : mode === 'empty' ? [] : examples} state={mode === 'unconnected' || mode === 'empty' ? 'ready' : mode} /></>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(import.meta.env.DEV ? <StrictMode><Preview /></StrictMode> : <p>Bản xem trước chỉ dùng trong môi trường phát triển.</p>);
