import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { ApiError, getAuthSessionVersion } from '../../services/apiClient';
import { changePassword, updateProfile } from '../../services/accountSettingsApi';
import type { User } from '../../types/auth';
import styles from './AccountSettings.module.css';

export function AccountSettings() {
  const auth = useAuth();
  if (!auth.user || !auth.applyProfile || !auth.endSession) return null;
  return <Settings key={`${auth.user.id}:${getAuthSessionVersion()}`} user={auth.user} applyProfile={auth.applyProfile} />;
}
function Settings({ user, applyProfile }: { user: User; applyProfile: (user: User, version: number) => void }) {
  const [name, setName] = useState(user.fullName ?? '');
  const [expected, setExpected] = useState(user.fullName);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const state = useRef({ busy: false, mounted: true, controller: null as AbortController | null, version: getAuthSessionVersion() });
  const navigate = useNavigate();
  useEffect(() => {
    const owned = state.current; owned.mounted = true;
    return () => { owned.mounted = false; owned.controller?.abort(); };
  }, []);
  const owns = () => state.current.mounted && state.current.version === getAuthSessionVersion();
  async function submit(event: FormEvent, password: boolean) {
    event.preventDefault(); if (state.current.busy || locked || !owns()) return;
    if (password && (next !== confirm || [...next].length < 8 || new TextEncoder().encode(next).length > 72)) {
      setError('Mật khẩu xác nhận cần khớp; mật khẩu mới ít nhất 8 ký tự và tối đa 72 byte UTF-8.'); return;
    }
    state.current.busy = true; setBusy(true); setError(''); setMessage('');
    const controller = new AbortController(); state.current.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    try {
      if (password) {
        await changePassword(current, next, signal);
        if (!owns()) return;
        setCurrent(''); setNext(''); setConfirm('');
        navigate('/login', { replace: true, state: { accountNotice: 'password-changed', accountSessionVersion: state.current.version } });
      } else {
        const updated = await updateProfile(name, expected, user, signal);
        if (!owns()) return;
        applyProfile(updated, state.current.version); setName(updated.fullName ?? ''); setExpected(updated.fullName); setMessage('Đã lưu tên hiển thị.');
      }
    } catch (reason) {
      if (!owns()) return;
      if (reason instanceof ApiError && reason.status === 401) {
        navigate('/login', { replace: true, state: { accountNotice: 'session-expired', accountSessionVersion: state.current.version } }); return;
      }
      const definite = reason instanceof ApiError && [400, 401, 403, 409, 413, 429].includes(reason.status ?? 0);
      if (password && !definite) {
        setCurrent(''); setNext(''); setConfirm('');
        navigate('/login', { replace: true, state: { accountNotice: 'password-unknown', accountSessionVersion: state.current.version } }); return;
      }
      if (!definite || (reason instanceof ApiError && reason.status === 409)) setLocked(true);
      setError(definite ? reason.message : 'Chưa rõ kết quả. Đã khóa thao tác ghi; hãy đăng nhập lại và đối chiếu. Không tự gửi lại.');
    } finally {
      if (owns()) { state.current.busy = false; setBusy(false); state.current.controller = null; }
    }
  }
  return <section className={styles.settings} aria-label="Cài đặt tài khoản">
    <h2>Hồ sơ và bảo mật</h2>
    <p>Email, quyền và số điện thoại không chỉnh sửa tại đây. Địa chỉ nhận hàng được quản lý riêng.</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || locked}>
      <legend>Tên hiển thị</legend><form onSubmit={event => void submit(event, false)}>
        <label>Tên hiển thị<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} autoComplete="name" required /></label>
        <button className="market-button" type="submit">Lưu hồ sơ</button>
      </form>
    </fieldset>
    <fieldset disabled={busy || locked}>
      <legend>Đổi mật khẩu</legend><p>Sau khi đổi, mọi phiên đăng nhập cũ hết hiệu lực. Bạn cần đăng nhập lại.</p>
      <form onSubmit={event => void submit(event, true)}>
        <label>Mật khẩu hiện tại<input type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} maxLength={512} required /></label>
        <label>Mật khẩu mới<input type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} minLength={8} maxLength={72} required /></label>
        <label>Xác nhận mật khẩu mới<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} minLength={8} maxLength={72} required /></label>
        <button className="market-button" type="submit">Đổi mật khẩu và đăng nhập lại</button>
      </form>
    </fieldset>
    {busy && <p role="status">Đang xử lý, không gửi thêm yêu cầu…</p>}
    {locked && <a href="/login">Đăng nhập lại để đối chiếu</a>}
  </section>;
}
