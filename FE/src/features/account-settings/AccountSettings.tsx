import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { ApiError, getAuthSessionVersion } from '../../services/apiClient';
import { changePassword, updateProfile } from '../../services/accountSettingsApi';
import { passwordChangeMode, requestPasswordChangeEmail } from '../../services/passwordChangeEmailApi';
import { saveBinding } from './passwordChangeBinding';
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
    {passwordChangeMode() === 'EMAIL' ? <EmailPasswordChange user={user} disabled={busy || locked} /> : <fieldset disabled={busy || locked}>
      <legend>Đổi mật khẩu</legend><p>Sau khi đổi, mọi phiên đăng nhập cũ hết hiệu lực. Bạn cần đăng nhập lại.</p>
      <form onSubmit={event => void submit(event, true)}>
        <label>Mật khẩu hiện tại<input type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} maxLength={512} required /></label>
        <label>Mật khẩu mới<input type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} minLength={8} maxLength={72} required /></label>
        <label>Xác nhận mật khẩu mới<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} minLength={8} maxLength={72} required /></label>
        <button className="market-button" type="submit">Đổi mật khẩu và đăng nhập lại</button>
      </form>
    </fieldset>}
    {busy && <p role="status">Đang xử lý, không gửi thêm yêu cầu…</p>}
    {locked && <a href="/login">Đăng nhập lại để đối chiếu</a>}
  </section>;
}

/** BUY-02: re-authenticate, then confirm through a one-time link sent to the verified email. */
function EmailPasswordChange({ user, disabled }: { user: User; disabled: boolean }) {
  const [current, setCurrent] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ email: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const navigate = useNavigate();
  const version = useRef(getAuthSessionVersion());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (flight.current || !consent) return;
    flight.current = true; setBusy(true); setError('');
    try {
      const result = await requestPasswordChangeEmail(current, AbortSignal.timeout(15000));
      setCurrent('');
      if (version.current !== getAuthSessionVersion()) return;
      // The browser must hold the binding before we tell the user to open the email.
      if (!saveBinding(user.id, { bindingSecret: result.bindingSecret, expiresAt: result.expiresAt })) {
        setError('Trình duyệt đang chặn lưu dữ liệu nên không thể xác nhận liên kết trong email. Hãy bật lưu trữ cho trang này rồi gửi yêu cầu mới.');
        return;
      }
      setSent({ email: result.email, expiresAt: result.expiresAt });
    } catch (reason) {
      setCurrent('');
      if (reason instanceof ApiError && reason.status === 401) {
        navigate('/login', { replace: true, state: { accountNotice: 'session-expired', accountSessionVersion: version.current } });
        return;
      }
      const code = reason instanceof ApiError ? reason.code : undefined;
      setError(
        code === 'CURRENT_PASSWORD_INVALID' ? 'Mật khẩu hiện tại không đúng.'
          : code === 'EMAIL_NOT_VERIFIED' ? 'Email của bạn chưa được xác minh. Hãy xác minh email ở mục bên dưới trước khi đổi mật khẩu.'
          : code === 'PASSWORD_CHANGE_RATE_LIMITED' || (reason instanceof ApiError && reason.status === 429) ? 'Bạn đã gửi quá nhiều yêu cầu. Hãy thử lại sau ít phút.'
          : reason instanceof ApiError && reason.status === 400 ? reason.message
          : 'Chưa rõ yêu cầu đã được ghi nhận hay chưa. Hãy kiểm tra hộp thư trước khi gửi lại; mỗi lần gửi mới sẽ làm liên kết cũ hết hiệu lực.',
      );
    } finally {
      flight.current = false; setBusy(false);
    }
  }
  return <fieldset disabled={disabled || busy}>
    <legend>Đổi mật khẩu</legend>
    <p>Để bảo vệ tài khoản, bạn xác nhận việc đổi mật khẩu qua email. Sau khi đổi, mọi phiên đăng nhập cũ hết hiệu lực.</p>
    {sent ? <div role="status">
      <p>Đã tiếp nhận yêu cầu. Thư xác nhận sẽ được gửi tới <strong>{sent.email}</strong>.</p>
      <p>Mở liên kết trong thư <strong>trên trình duyệt này</strong> trước {new Date(sent.expiresAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}. Nếu không nhận được thư sau vài phút, bạn có thể gửi yêu cầu mới; liên kết cũ sẽ hết hiệu lực.</p>
      <button type="button" className="market-button" onClick={() => { setSent(null); setConsent(false); }}>Gửi yêu cầu mới</button>
    </div> : <form onSubmit={event => void submit(event)}>
      <label>Mật khẩu hiện tại<input type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} maxLength={72} required /></label>
      <label className={styles.consent}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> Gửi thư xác nhận đổi mật khẩu tới email của tôi</label>
      <button className="market-button" type="submit" disabled={!consent}>Gửi email xác nhận</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
