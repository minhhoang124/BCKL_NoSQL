import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { ApiError, getAuthSessionVersion } from '../../services/apiClient';
import { brandApi, validateBrandDraft } from './brandApi';
import type { AdminBrand, BrandApi, BrandPatch } from './brandApi';
import styles from './AdminBrandEditor.module.css';

interface EditorProps {
  api?: BrandApi;
  embedded?: boolean;
  disabled?: boolean;
  reloadToken?: number;
  onLockChange?: (locked: boolean) => void;
  onSaved?: () => void;
}

export function AdminBrandEditor({ api = brandApi, ...integration }: EditorProps) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Đang xác thực…</p>;
  if (!user || user.role !== 'ADMIN' || !user.isActive) return <p role="alert">Chỉ Admin đang hoạt động được sửa thương hiệu.</p>;
  return <BrandEditorContent key={`${user.id}:${getAuthSessionVersion()}`} api={api} {...integration} />;
}

function BrandEditorContent({ api, embedded = false, disabled = false, reloadToken = 0, onLockChange, onSaved }: Omit<EditorProps, 'api'> & { api: BrandApi }) {
  const [rows, setRows] = useState<AdminBrand[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<AdminBrand | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [confirm, setConfirm] = useState<BrandPatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const sequence = useRef(0);
  const reads = useRef<AbortController | null>(null);
  const writes = useRef<AbortController | null>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const owner = useRef(getAuthSessionVersion());
  const current = useCallback(() => mounted.current && owner.current === getAuthSessionVersion(), []);
  const abortPending = useCallback(() => { ++sequence.current; reads.current?.abort(); writes.current?.abort(); }, []);

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    reads.current?.abort();
    const controller = new AbortController(); reads.current = controller;
    setPhase('loading'); setError('');
    try {
      const result = await api.list(controller.signal);
      if (!current() || ticket !== sequence.current) return;
      setRows(result); setPhase('ready');
    } catch (failure) {
      if (!current() || ticket !== sequence.current || controller.signal.aborted) return;
      setRows([]); setPhase('error');
      setError(failure instanceof ApiError ? failure.message : 'Không tải được danh sách thương hiệu.');
    }
  }, [api, current]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { mounted.current = false; window.clearTimeout(timer); abortPending(); };
  }, [load, abortPending, reloadToken]);
  useEffect(() => { if (confirm) confirmationHeading.current?.focus(); }, [confirm]);
  useEffect(() => { onLockChange?.(busy || confirm !== null || uncertain); }, [busy, confirm, uncertain, onLockChange]);
  useEffect(() => () => { onLockChange?.(false); }, [onLockChange]);

  const choose = (row: AdminBrand) => {
    if (disabled || pending.current || uncertain || phase !== 'ready') return;
    setSelected(row); setName(row.name); setSlug(row.slug); setConfirm(null); setError(''); setNotice('');
  };
  const review = () => {
    if (disabled || !selected || pending.current || uncertain || phase !== 'ready') return;
    const nextName = name.trim(); const nextSlug = slug.trim();
    const invalid = validateBrandDraft(nextName, nextSlug);
    if (invalid) { setError(invalid); return; }
    const patch: BrandPatch = { ...(nextName !== selected.name ? { name: nextName } : {}), ...(nextSlug !== selected.slug ? { slug: nextSlug } : {}) };
    if (Object.keys(patch).length === 0) { setError('Chưa có thay đổi để lưu.'); return; }
    setError(''); setConfirm(patch);
  };
  const save = async () => {
    if (disabled || !selected || !confirm || pending.current || uncertain || phase !== 'ready') return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    ++sequence.current; reads.current?.abort();
    const controller = new AbortController(); writes.current = controller;
    try {
      const result = await api.update(selected.id, confirm, controller.signal);
      if (!current()) return;
      setSelected(null); setConfirm(null);
      setNotice(`Đã lưu thương hiệu. ${result.searchReconciliation ? 'Thay đổi có thể chưa xuất hiện ngay trong kết quả tìm kiếm.' : ''}`);
      await load();
      if (current()) onSaved?.();
    } catch (failure) {
      if (!current()) return;
      setConfirm(null);
      const status = failure instanceof ApiError ? failure.status : undefined;
      if (status && [400, 409, 422, 429].includes(status)) {
        setError((failure as ApiError).message);
      } else if (status && [401, 403, 404].includes(status)) {
        setSelected(null); setRows([]); setPhase('error');
        setError((failure as ApiError).message);
      } else {
        setUncertain(true);
        setError('Chưa rõ kết quả lưu. Hãy kiểm tra thông tin đã lưu trước khi thử lại để tránh cập nhật trùng.');
        setNotice('Có thể tải lại để xem dữ liệu, nhưng GET không chứng minh yêu cầu cũ đã kết thúc. Giữ khóa thao tác ghi trong phiên màn hình này.');
      }
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const blocked = disabled || busy || uncertain || phase !== 'ready';

  return <section className={`${styles.layout} ${embedded ? styles.embedded : ''}`} aria-label="Sửa thương hiệu Admin">
    <header className={styles.header}><div><p className={styles.eyebrow}>ADMIN / CATALOG</p>{embedded ? <h2>Sửa thương hiệu</h2> : <h1>Sửa thương hiệu</h1>}
      <p>Chỉ sửa tên và slug. Không thay trạng thái bật/tắt hoặc dữ liệu sản phẩm.</p></div>
      <button type="button" disabled={disabled || busy || confirm !== null} onClick={() => { if (!disabled && !pending.current && !confirm) void load(); }}>Tải lại danh sách</button>
    </header>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {uncertain && <p className={styles.error}>Thao tác ghi đang bị khóa do kết quả chưa rõ. Không tự thử lại sau mất mạng/timeout.</p>}
    {phase === 'loading' && <p role="status">Đang tải thương hiệu…</p>}
    {phase === 'ready' && <div className={styles.columns}>
      <section className={styles.panel} aria-label="Danh sách thương hiệu"><h2>Thương hiệu đã tải ({rows.length})</h2>
        {!rows.length && <p>Chưa có thương hiệu.</p>}
        <ul className={styles.list}>{rows.map(row => <li key={row.id}><div><strong>{row.name}</strong><span>{row.slug}</span><small>{row.isActive ? 'Đang bật' : 'Đã tắt'}</small></div>
          <button type="button" disabled={blocked || confirm !== null} onClick={() => choose(row)} aria-label={`Sửa thương hiệu ${row.name}`}>Sửa</button></li>)}</ul>
      </section>
      <section className={styles.panel} aria-label="Biểu mẫu sửa thương hiệu"><h2>{selected ? `Sửa: ${selected.name}` : 'Chọn thương hiệu để sửa'}</h2>
        {selected ? <>
          <form onSubmit={(event) => { event.preventDefault(); review(); }}>
            <label>Tên thương hiệu<input value={name} disabled={blocked || !!confirm} onChange={event => setName(event.target.value)} /></label>
            <label>Slug<input value={slug} disabled={blocked || !!confirm} onChange={event => setSlug(event.target.value)} spellCheck={false} /></label>
            <p className={styles.hint}>Tên 2–120 ký tự; slug 2–140 ký tự, chữ thường/số và gạch nối. Không tự đổi slug theo tên.</p>
            <div className={styles.actions}><button type="submit" disabled={blocked || !!confirm}>Xem lại thay đổi</button>
              <button type="button" disabled={disabled || busy || uncertain} onClick={() => { setSelected(null); setConfirm(null); setError(''); }}>Hủy chỉnh sửa</button></div>
          </form>
          {confirm && <section className={styles.confirm} aria-label="Xác nhận thay đổi thương hiệu"><h3 ref={confirmationHeading} tabIndex={-1}>Xác nhận trước khi lưu</h3>
            <dl><dt>Tên</dt><dd>{confirm.name ?? selected.name}</dd><dt>Slug</dt><dd>{confirm.slug ?? selected.slug}</dd></dl>
            <p>Thông tin mới có thể cần một thời gian để xuất hiện trong kết quả tìm kiếm.</p>
            <div className={styles.actions}><button type="button" disabled={blocked} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Xác nhận lưu'}</button>
              <button type="button" disabled={disabled || busy} onClick={() => setConfirm(null)}>Quay lại sửa</button></div>
          </section>}
        </> : <p>Danh sách gồm cả thương hiệu đã tắt. Không xóa hoặc bật/tắt trong màn này.</p>}
      </section>
    </div>}
    <p className={styles.hint}>Tránh cùng sửa một thương hiệu với quản trị viên khác. Nếu mất kết nối khi lưu, kiểm tra lại thông tin trước khi thử lại.</p>
  </section>;
}
