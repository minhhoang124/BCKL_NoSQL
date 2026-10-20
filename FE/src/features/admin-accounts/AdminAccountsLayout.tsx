import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './AdminAccountsLayout.module.css';

/** Presentation-only sample, NOT a Backend response contract. Never pass live accounts here. */
export interface AccountLayoutExample {
  sampleId: string;
  fullName: string | null;
  email: string;
  role: 'USER' | 'SELLER';
  isActive: boolean;
}

const roleName = { USER: 'Người mua', SELLER: 'Người bán' };
const fold = (text: string) => text.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

function DecisionPreview({ account, onClose, returnFocus }: { account: AccountLayoutExample; onClose: () => void; returnFocus: HTMLButtonElement | null }) {
  const titleId = useId();
  const noteId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const action = account.isActive ? 'Khóa tài khoản' : 'Mở khóa tài khoản';

  useEffect(() => {
    cancelRef.current?.focus();
    // Capture the opener before the page becomes inert (real browsers blur it).
    return () => { if (returnFocus?.isConnected) returnFocus.focus(); };
  }, [returnFocus]);

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea');
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div className={styles.backdrop}>
    <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={noteId} onKeyDown={handleKey}>
      <p className={styles.eyebrow}>XÁC NHẬN · BẢN XEM TRƯỚC</p>
      <h2 id={titleId}>{action}</h2>
      <p><strong>{account.fullName || 'Chưa có tên hiển thị'}</strong><br />{account.email}</p>
      <p>{account.isActive ? 'Tài khoản bị khóa sẽ không được thao tác mới. Lịch sử giao dịch cần được giữ nguyên.' : 'Việc mở khóa phải tuân theo chính sách và quyền do Backend kiểm tra.'}</p>
      <label className={styles.field}>Lý do dự kiến
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Nhập lý do để xem bố cục; nội dung không được lưu" />
      </label>
      <p id={noteId} className={styles.notice}>Chưa thể lưu: đang chờ contract lý do/audit và chính sách bảo vệ Admin cuối cùng. Không gửi yêu cầu, không đổi trạng thái tài khoản.</p>
      <div className={styles.dialogActions}>
        <button ref={cancelRef} type="button" className={styles.secondary} onClick={onClose}>Hủy</button>
        <button type="button" className={styles.primary} disabled aria-describedby={noteId}>Xác nhận (chưa kết nối)</button>
      </div>
    </div>
  </div>;
}

/** Standalone layout preparation. No API, auth, persistence, or live mutation. */
export function AdminAccountsLayout({ examples }: { examples?: readonly AccountLayoutExample[] }) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [selected, setSelected] = useState<{ account: AccountLayoutExample; opener: HTMLButtonElement } | null>(null);
  const headingId = useId();
  const visible = (examples ?? []).filter((account) =>
    (role === 'ALL' || account.role === role) &&
    (status === 'ALL' || account.isActive === (status === 'ACTIVE')) &&
    fold(`${account.sampleId} ${account.fullName ?? ''} ${account.email}`).includes(fold(query)),
  );
  const reset = () => { setQuery(''); setRole('ALL'); setStatus('ALL'); };

  return <section className={styles.layout} aria-labelledby={headingId}>
    <div className={styles.pageContent} inert={selected !== null}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>BCKL / ADMIN · CHUẨN BỊ GIAO DIỆN</p>
          <h1 id={headingId}>Quản lý tài khoản</h1>
          <p>Danh sách người mua, người bán và thao tác quản lý trạng thái.</p>
        </div>
        <span className={styles.preparationBadge}>Chưa nối Backend</span>
      </header>

      <aside className={styles.notice} aria-label="Giới hạn bản xem trước">
        <strong>{examples === undefined ? 'Chưa có API danh sách tài khoản.' : 'Dữ liệu minh họa — không phải tài khoản thật.'}</strong>
        <p>Đây chỉ là bố cục chuẩn bị. Bộ lọc chỉ áp dụng cho các dòng minh họa; không tìm trên toàn hệ thống. Không khóa/mở tài khoản và không lưu dữ liệu.</p>
      </aside>

      <form className={styles.filters} aria-label="Lọc tài khoản minh họa" onSubmit={(event) => event.preventDefault()}>
        <label className={styles.field}>Tìm trong dữ liệu minh họa
          <input type="search" value={query} disabled={examples === undefined} onChange={(event) => setQuery(event.target.value)} placeholder="Tên, email hoặc mã minh họa" />
        </label>
        <label className={styles.field}>Vai trò
          <select value={role} disabled={examples === undefined} onChange={(event) => setRole(event.target.value)}>
            <option value="ALL">Tất cả vai trò</option><option value="USER">Người mua</option><option value="SELLER">Người bán</option>
          </select>
        </label>
        <label className={styles.field}>Trạng thái
          <select value={status} disabled={examples === undefined} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">Tất cả trạng thái</option><option value="ACTIVE">Đang hoạt động</option><option value="LOCKED">Đã khóa</option>
          </select>
        </label>
        <button type="button" className={styles.secondary} disabled={examples === undefined} onClick={reset}>Xóa bộ lọc</button>
      </form>

      <section className={styles.panel} aria-label="Danh sách tài khoản">
        <div className={styles.panelHeading}><h2>Người mua &amp; người bán</h2>
          <span role="status">{examples === undefined ? 'Chưa có dữ liệu từ Backend' : `${visible.length} / ${examples.length} dòng minh họa`}</span>
        </div>
        {examples === undefined ? <div className={styles.empty}>
          <h3>Chờ kết nối dữ liệu thật</h3><p>Không hiển thị số 0 thay cho dữ liệu chưa được tải. Cần API danh sách và phân trang được Hoàng chốt.</p>
        </div> : visible.length === 0 ? <div className={styles.empty}>
          <h3>{examples.length === 0 ? 'Không có dòng minh họa' : 'Không có dòng minh họa phù hợp'}</h3>
          <p>Đây không phải kết quả truy vấn tài khoản thật.</p>
          {examples.length > 0 && <button type="button" className={styles.secondary} onClick={reset}>Đặt lại bộ lọc</button>}
        </div> : <table className={styles.table}>
          <caption className={styles.srOnly}>Tài khoản minh họa, không phải dữ liệu hệ thống</caption>
          <thead><tr><th scope="col">Tài khoản</th><th scope="col">Vai trò</th><th scope="col">Trạng thái</th><th scope="col">Thao tác xem trước</th></tr></thead>
          <tbody>{visible.map((account) => <tr key={account.sampleId}>
            <td data-label="Tài khoản"><div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{(account.fullName || account.email).slice(0, 1).toLocaleUpperCase('vi')}</span>
              <div><strong>{account.fullName || 'Chưa có tên hiển thị'}</strong><span>{account.email}</span><small>{account.sampleId} · Minh họa</small></div>
            </div></td>
            <td data-label="Vai trò">{roleName[account.role]}</td>
            <td data-label="Trạng thái"><span className={account.isActive ? styles.active : styles.locked}>{account.isActive ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
            <td data-label="Thao tác"><button type="button" className={styles.secondary} onClick={(event) => setSelected({ account, opener: event.currentTarget })} aria-label={`Xem trước ${account.isActive ? 'khóa' : 'mở khóa'} ${account.email}`}>
              Xem trước {account.isActive ? 'khóa' : 'mở khóa'}
            </button></td>
          </tr>)}</tbody>
        </table>}
        <footer className={styles.footer}>Chưa có phân trang hoặc tổng số tài khoản thật. Chính sách khóa/mở và lịch sử thao tác còn chờ contract.</footer>
      </section>
    </div>
    {selected && <DecisionPreview key={selected.account.sampleId} account={selected.account} returnFocus={selected.opener} onClose={() => setSelected(null)} />}
  </section>;
}
