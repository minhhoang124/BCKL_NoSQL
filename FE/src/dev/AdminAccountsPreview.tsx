import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminAccountsLayout } from '../features/admin-accounts/AdminAccountsLayout';
import type { AccountLayoutExample } from '../features/admin-accounts/AdminAccountsLayout';
import { AdminAccountsReadPreview } from './AdminAccountsReadPreview';
import '../index.css';

// Synthetic display-only examples. No credentials or live user IDs.
const examples: readonly AccountLayoutExample[] = [
  { sampleId: 'DEMO-01', fullName: 'Nguyễn Minh An', email: 'nguoi-mua-a@example.test', role: 'USER', isActive: true },
  { sampleId: 'DEMO-02', fullName: 'Cửa hàng Minh Họa', email: 'nguoi-ban-a@example.test', role: 'SELLER', isActive: true },
  { sampleId: 'DEMO-03', fullName: 'Trần Thanh Bình', email: 'nguoi-mua-b@example.test', role: 'USER', isActive: false },
  { sampleId: 'DEMO-04', fullName: null, email: 'dia-chi-email-minh-hoa-rat-dai-de-kiem-tra-mobile@example.test', role: 'SELLER', isActive: false },
];

export default function Preview() {
  const [read, setRead] = useState(true);
  return <><div style={{ background: '#fff', color: '#20242b', padding: 12 }}>
    <button onClick={() => setRead(previous => !previous)}>{read ? 'Xem layout mẫu cũ' : 'Xem danh sách qua API giả lập'}</button>
  </div>{read ? <AdminAccountsReadPreview /> : <AdminAccountsLayout examples={examples} />}</>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(import.meta.env.DEV
  ? <StrictMode><Preview /></StrictMode>
  : <p>Bản xem trước chỉ dùng trong môi trường phát triển.</p>);
