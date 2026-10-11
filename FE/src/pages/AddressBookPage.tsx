import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { ApiError } from '../services/apiClient';
import { addressApi } from '../services/addressApi';
import { AddressCard } from '../components/Address/AddressCard';
import { AddressForm } from '../components/Address/AddressForm';
import type { Address, AddressInput } from '../types/address';
import type { User } from '../types/auth';
import styles from './AddressBookPage.module.css';

function messageFor(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Bạn không có quyền quản lý địa chỉ bằng tài khoản này.';
    if (error.status === 404) return 'Địa chỉ không còn tồn tại. Hãy tải lại danh sách.';
    return error.message;
  }
  return 'Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.';
}

export function AddressBookPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'USER' || !user.isActive) return <p role="alert">Chỉ tài khoản người mua đang hoạt động được quản lý địa chỉ.</p>;
  // A session change remounts the page and clears all personal data and draft state.
  return <AddressBookContent key={user.id} user={user} />;
}

function AddressBookContent({ user }: { user: User }) {
  const [items, setItems] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<{ address: Address | null } | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const formHeading = useRef<HTMLDivElement>(null);

  const cancelReads = useCallback(() => {
    ++request.current;
    controller.current?.abort();
  }, []);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true); setReady(false);
    try {
      const result = await addressApi.list(current.signal);
      if (!mounted.current || sequence !== request.current) return;
      setItems(result.items); setReady(true);
    } catch (failure) {
      if (mounted.current && sequence === request.current && !current.signal.aborted) {
        setError(messageFor(failure));
      }
    } finally {
      if (mounted.current && sequence === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { mounted.current = false; window.clearTimeout(timer); cancelReads(); };
  }, [load, cancelReads]);

  useEffect(() => {
    if (form) formHeading.current?.focus();
  }, [form]);

  const run = async (work: () => Promise<unknown>, success: string) => {
    if (pending.current || !ready) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    // Invalidate any earlier reads before a write so they cannot overwrite the new list.
    cancelReads();
    try {
      await work();
      if (!mounted.current) return;
      setForm(null); setDeleting(null); setNotice(success);
      await load();
    } catch (failure) {
      if (!mounted.current) return;
      setError(messageFor(failure));
      if (!(failure instanceof ApiError) || failure.status === 404 || failure.status === 409 || (failure.status ?? 0) >= 500) {
        setReady(false);
        setNotice('Hãy tải lại danh sách và kiểm tra kết quả trước khi gửi tiếp thao tác. Nội dung form vẫn được giữ.');
      }
    } finally {
      if (mounted.current) { pending.current = false; setBusy(false); }
    }
  };

  const save = (body: AddressInput) => {
    if (!form) return;
    const address = form.address;
    void run(() => address ? addressApi.update(address.id, body) : addressApi.create(body), address ? 'Đã cập nhật địa chỉ.' : 'Đã thêm địa chỉ.');
  };
  const disabled = busy || loading || !ready;

  return <div className={styles.page}>
    <aside className={styles.sidebar} aria-label="Tài khoản">
      <h2>Tài khoản</h2><strong>{user.fullName || 'Người mua'}</strong><p>{user.email}</p>
      <nav><Link to="/account">Hồ sơ của tôi</Link><Link to="/account/addresses" aria-current="page">Sổ địa chỉ</Link></nav>
    </aside>
    <div className={styles.content}>
      <header className={styles.heading}>
        <div><h1>Sổ địa chỉ</h1><p>Quản lý địa chỉ nhận hàng của bạn.</p></div>
        <button type="button" className={styles.primary} disabled={disabled} onClick={() => { setForm({ address: null }); setDeleting(null); setError(''); setNotice(''); }}>+ Thêm địa chỉ mới</button>
      </header>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.toolbar}>
        <span>{ready ? `${items.length} địa chỉ` : 'Danh sách cần được cập nhật'}</span>
        <button type="button" disabled={busy || loading} onClick={() => { setError(''); setNotice(''); void load(); }}>Tải lại danh sách</button>
      </div>
      <section className={styles.list} aria-label="Danh sách địa chỉ" aria-busy={loading}>
        {loading ? <p className={styles.empty} role="status">Đang tải địa chỉ...</p> : !ready ?
          <p className={styles.empty}>Tải lại danh sách để kiểm tra địa chỉ hiện tại và tiếp tục.</p> :
          items.length === 0 ? <div className={styles.empty}><h2>Bạn chưa có địa chỉ nhận hàng</h2><p>Thêm địa chỉ đầu tiên để chuẩn bị mua hàng. Địa chỉ đầu tiên sẽ được đặt làm mặc định.</p></div> :
            items.map((address) => <AddressCard key={address.id} address={address} disabled={disabled}
              onEdit={() => { setForm({ address }); setDeleting(null); setError(''); setNotice(''); }}
              onDelete={() => { setDeleting(address); setForm(null); setError(''); setNotice(''); }}
              onDefault={() => void run(() => addressApi.setDefault(address.id), 'Đã đổi địa chỉ mặc định.')} />)}
      </section>
      {deleting && <section className={styles.confirm} aria-labelledby="delete-address-title">
        <h2 id="delete-address-title">Xóa địa chỉ này?</h2>
        <p>{deleting.recipientName} · {deleting.addressLine}</p>
        <p>{deleting.isDefault ? 'Nếu còn địa chỉ khác, hệ thống sẽ tự chọn một địa chỉ mặc định thay thế.' : 'Địa chỉ sẽ bị xóa khỏi sổ địa chỉ của bạn.'}</p>
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => setDeleting(null)}>Giữ địa chỉ</button>
          <button type="button" className={styles.danger} disabled={disabled} onClick={() => void run(() => addressApi.remove(deleting.id), 'Đã xóa địa chỉ.')}>{busy ? 'Đang xóa...' : 'Xác nhận xóa'}</button>
        </div>
      </section>}
      {form && <div ref={formHeading} tabIndex={-1} className={styles.formFocus}>
        <AddressForm key={form.address?.id ?? 'new'} address={form.address} disabled={disabled} saving={busy} onSave={save} onCancel={() => setForm(null)} />
      </div>}
    </div>
  </div>;
}
