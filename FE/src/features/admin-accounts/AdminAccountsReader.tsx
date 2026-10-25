import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { ApiError, getAuthSessionVersion } from '../../services/apiClient';
import { normalizeAccountSearch } from './accountReadApi';
import type { AccountPage, AccountQuery, AccountReadApi, AccountRole } from './accountReadApi';
import styles from './AdminAccountsLayout.module.css';

interface Props { api?: AccountReadApi; pageSize?: number; embedded?: boolean; onManage?: (id: number) => void }
const roles = { USER: 'Người mua', SELLER: 'Người bán', ADMIN: 'Quản trị viên' };
const storeStatuses = { PENDING: 'Chờ duyệt', ACTIVE: 'Hoạt động', REJECTED: 'Đã từ chối', SUSPENDED: 'Tạm khóa', CLOSED: 'Đã đóng' };
export function AdminAccountsReader(props: Props) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Đang kiểm tra phiên đăng nhập…</p>;
  if (!user || !user.isActive || user.role !== 'ADMIN') return <p role="alert">Cần tài khoản Admin đang hoạt động.</p>;
  if (!Number.isInteger(props.pageSize ?? 50) || (props.pageSize ?? 50) < 1 || (props.pageSize ?? 50) > 100) return <p role="alert">Giới hạn trang không hợp lệ.</p>;
  return <AccountScreen key={`${user.id}:${getAuthSessionVersion()}`} {...props} />;
}
function AccountScreen({ api, pageSize = 50, embedded = false, onManage }: Props) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('ALL');
  const [active, setActive] = useState('ALL');
  const [applied, setApplied] = useState<AccountQuery>({});
  const [attempt, setAttempt] = useState(0);
  const [validation, setValidation] = useState('');
  const [blocked, setBlocked] = useState(false);
  const apply = () => {
    try {
      const q = normalizeAccountSearch(search);
      setValidation(''); setApplied({ ...(q ? { q } : {}), ...(role === 'ALL' ? {} : { role: role as AccountRole }), ...(active === 'ALL' ? {} : { isActive: active === 'ACTIVE' }) });
      setAttempt(previous => previous + 1);
    } catch { setValidation('Từ khóa tối đa 120 ký tự Unicode sau NFC/trim, không có ký tự điều khiển.'); }
  };
  const reset = () => { setSearch(''); setRole('ALL'); setActive('ALL'); setValidation(''); setApplied({}); setAttempt(previous => previous + 1); };
  return <section className={`${styles.layout} ${embedded ? styles.embedded : ''}`} aria-label="Accounts chỉ đọc"><div className={styles.pageContent}>
    <header className={styles.header}><div><p className={styles.eyebrow}>BCKL / ADMIN · ACCOUNTS</p>
      <h1>{onManage ? 'Quản lý tài khoản' : 'Quản lý tài khoản — chỉ đọc'}</h1><p>{onManage ? 'Xem trạng thái, lịch sử và xác nhận khóa/mở tài khoản.' : 'Danh sách, tìm kiếm và phân trang theo Backend; không thay đổi tài khoản.'}</p></div>
      <span className={styles.preparationBadge}>{onManage ? 'Có lịch sử và đối chiếu' : 'Chưa bật khóa/mở'}</span></header>
    <aside className={styles.notice}>{onManage ? 'Khóa và mở tài khoản đều yêu cầu đăng nhập lại. Thao tác không thay đổi trạng thái Store.' : 'Khóa/mở nâng cấp còn chờ API bảo vệ, lý do và audit. Trạng thái Store không phải trạng thái tài khoản.'}</aside>
    <form className={styles.filters} aria-label="Bộ lọc Accounts" onSubmit={event => { event.preventDefault(); if (api && !blocked) apply(); }}>
      <label className={styles.field}>Tìm theo tên hoặc email<input type="search" disabled={!api || blocked} value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm trên Backend, không lọc riêng trang đang thấy" /></label>
      <label className={styles.field}>Vai trò<select disabled={!api || blocked} value={role} onChange={event => setRole(event.target.value)}>
        <option value="ALL">Tất cả vai trò</option><option value="USER">Người mua</option><option value="SELLER">Người bán</option><option value="ADMIN">Quản trị viên</option></select></label>
      <label className={styles.field}>Trạng thái tài khoản<select disabled={!api || blocked} value={active} onChange={event => setActive(event.target.value)}>
        <option value="ALL">Tất cả trạng thái</option><option value="ACTIVE">Đang hoạt động</option><option value="LOCKED">Đã khóa</option></select></label>
      <div><button className={styles.secondary} type="submit" disabled={!api || blocked}>Tìm kiếm</button>{' '}
        <button className={styles.secondary} type="button" disabled={!api || blocked} onClick={reset}>Xóa bộ lọc</button></div>
    </form>
    <p>Bộ lọc chỉ được áp dụng khi bấm Tìm kiếm. Các dòng đang thấy thuộc bộ lọc đã áp dụng.</p>
    {validation && <p role="alert" className={styles.notice}>{validation}</p>}
    {!api ? <section className={styles.panel}><div className={styles.empty}><h2>Chưa kết nối API Accounts</h2><p>Chưa có dữ liệu thật; không hiển thị số 0 thay kết quả chưa tải.</p></div></section> :
      <AccountResults key={`${JSON.stringify(applied)}:${pageSize}:${attempt}`} api={api} query={{ ...applied, limit: pageSize }} onBlocked={() => setBlocked(true)} onManage={onManage} />}
  </div></section>;
}
function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return 'Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại.';
  if (error instanceof ApiError && error.status === 403) return 'Không có quyền đọc danh sách Admin.';
  if (error instanceof ApiError && error.status === 400) return 'Bộ lọc bị từ chối. Kiểm tra lại hoặc xóa bộ lọc.';
  return 'Không tải được danh sách. Hãy thử tải lại từ trang đầu.';
}
function AccountResults({ api, query, onBlocked, onManage }: { api: AccountReadApi; query: AccountQuery; onBlocked: () => void; onManage?: (id: number) => void }) {
  const [page, setPage] = useState<AccountPage>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const flight = useRef<AbortController | null>(null);
  const version = useRef(getAuthSessionVersion());
  async function load(afterId?: number) {
    if (flight.current || blocked) return;
    const controller = new AbortController(); flight.current = controller;
    setBusy(true); setError('');
    if (afterId === undefined) { setPage({ items: [], nextCursor: null }); setReady(false); }
    try {
      const response = await api.list({ ...query, ...(afterId === undefined ? {} : { afterId }) }, controller.signal);
      if (!controller.signal.aborted && version.current === getAuthSessionVersion()) {
        setPage(previous => ({ ...response, items: afterId === undefined ? response.items : [...previous.items, ...response.items] })); setReady(true);
      }
    } catch (failure) {
      if (!controller.signal.aborted && version.current === getAuthSessionVersion()) {
        setPage({ items: [], nextCursor: null }); setReady(false); setError(errorMessage(failure));
        if (failure instanceof ApiError && [401, 403].includes(failure.status ?? 0)) { setBlocked(true); onBlocked(); }
      }
    } finally { if (flight.current === controller) { flight.current = null; setBusy(false); } }
  }
  useEffect(() => {
    void load();
    return () => { flight.current?.abort(); flight.current = null; };
    // Query changes remount this component so old pages and callbacks cannot mix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  return <section className={styles.panel} aria-label="Danh sách Accounts chỉ đọc" aria-busy={busy}>
    <div className={styles.panelHeading}><h2>Kết quả tài khoản</h2>
      <button className={styles.secondary} disabled={busy || blocked} onClick={() => void load()}>Tải lại từ đầu</button></div>
    <p className={styles.footer}>Bộ lọc đã áp dụng: {query.q ? `“${query.q}”` : 'không từ khóa'} · {query.role ? roles[query.role] : 'mọi vai trò'} · {query.isActive === undefined ? 'mọi trạng thái' : query.isActive ? 'hoạt động' : 'đã khóa'}.</p>
    {busy && <p role="status" className={styles.footer}>Đang tải danh sách…</p>}
    {error && <p role="alert" className={styles.notice}>{error}</p>}
    {ready && !error && <><p role="status" className={styles.footer}>Đã tải {page.items.length} dòng{page.nextCursor === null ? ' — hết trang tại lần đọc này' : ' — còn trang tiếp theo'}. Không phải tổng toàn hệ thống.</p>
      {!page.items.length ? <div className={styles.empty}><h3>Không có tài khoản phù hợp</h3></div> :
        <table className={styles.table}><caption className={styles.srOnly}>Tài khoản từ bộ lọc Backend đã áp dụng</caption>
          <thead><tr><th scope="col">Tài khoản</th><th scope="col">Vai trò</th><th scope="col">Trạng thái tài khoản</th><th scope="col">Cửa hàng</th>{onManage && <th scope="col">Thao tác</th>}</tr></thead>
          <tbody>{page.items.map(account => <tr key={account.id}>
            <td data-label="Tài khoản"><div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{(account.fullName || account.email).slice(0, 1).toLocaleUpperCase('vi')}</span>
              <div><strong>{account.fullName || 'Chưa có tên hiển thị'}</strong><span>{account.email}</span><small>ID {account.id}</small></div></div></td>
            <td data-label="Vai trò">{roles[account.role]}</td><td data-label="Trạng thái tài khoản"><span className={account.isActive ? styles.active : styles.locked}>{account.isActive ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
            <td data-label="Cửa hàng">{account.store ? <>{account.store.name}<br /><small>Store #{account.store.id} · {storeStatuses[account.store.status]}</small></> : 'Chưa có Store'}</td>
            {onManage && <td data-label="Thao tác"><button type="button" className={styles.secondary} disabled={blocked} onClick={() => onManage(account.id)}>Quản lý tài khoản #{account.id}</button></td>}
          </tr>)}</tbody></table>}
      {page.nextCursor !== null && <div className={styles.footer}><button className={styles.secondary} disabled={busy || blocked} onClick={() => void load(page.nextCursor!)}>Tải thêm tài khoản</button></div>}
    </>}
    <footer className={styles.footer}>Thứ tự ID tăng. Mỗi trang là một lần đọc riêng; không cam kết snapshot cố định khi dữ liệu thay đổi.</footer>
  </section>;
}
