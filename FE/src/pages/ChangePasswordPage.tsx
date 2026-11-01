import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { ApiError, AuthSessionChangedError, getAuthSessionVersion } from '../services/apiClient';
import { confirmPasswordChange, isOpaqueSecret, verifyPasswordChangeLink } from '../services/passwordChangeEmailApi';
import { clearBinding, loadBinding } from '../features/account-settings/passwordChangeBinding';
import styles from '../features/account-settings/AccountSettings.module.css';
import pageStyles from './AccountPage.module.css';

/** Read the emailed token from the fragment once, then remove it from the address bar and history. */
function takeTokenFromFragment(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return isOpaqueSecret(token) ? token : null;
}

type View =
  | { kind: 'missing-token' }
  | { kind: 'signed-out' }
  | { kind: 'no-binding' }
  | { kind: 'checking' }
  | { kind: 'ready'; expiresAt: string }
  | { kind: 'invalid' }
  | { kind: 'other-browser' }
  | { kind: 'error'; message: string };

/** BUY-02: second half of the email-confirmed password change. Public route; the API requires login. */
export function ChangePasswordPage() {
  const { user, loading } = useAuth();
  const token = useRef<string | null | undefined>(undefined);
  if (token.current === undefined) token.current = takeTokenFromFragment();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const navigate = useNavigate();
  const version = useRef(getAuthSessionVersion());
  // Result of the server check, tied to the user/session it was made for.
  const key = user ? `${user.id}:${getAuthSessionVersion()}` : '';
  const [checked, setChecked] = useState<{ key: string; view: View } | null>(null);
  const setView = (view: View) => setChecked({ key, view });
  const binding = user && token.current ? loadBinding(user.id) : null;
  const view: View = !token.current ? { kind: 'missing-token' }
    : !user ? { kind: 'signed-out' }
    : checked?.key === key ? checked.view
    : !binding ? { kind: 'no-binding' }
    : { kind: 'checking' };
  const needsCheck = !loading && Boolean(user && token.current && binding) && checked?.key !== key;
  // Survive the StrictMode remount: refs persist, so one key starts at most one verify.
  const started = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // A late response may only touch this page while it is mounted for the same session.
  const live = (sessionVersion: number) => mounted.current && sessionVersion === getAuthSessionVersion();

  useEffect(() => {
    if (!needsCheck || !user || !token.current || !binding || started.current === key) return;
    started.current = key;
    version.current = getAuthSessionVersion();
    const owner = key, sessionVersion = version.current;
    verifyPasswordChangeLink(token.current, binding, AbortSignal.timeout(15000))
      .then(result => { if (live(sessionVersion)) setChecked({ key: owner, view: { kind: 'ready', expiresAt: result.expiresAt } }); })
      .catch(reason => { if (live(sessionVersion)) setChecked({ key: owner, view: classify(reason) }); });
    // `binding` is re-read each render; the check only depends on who is signed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCheck, key]);

  /**
   * Never clears the stored binding: a failure may belong to an older emailed link while a
   * newer request (same binding slot) is still valid. The binding expires on its own and is
   * removed after a successful change.
   */
  function classify(reason: unknown): View {
    if (reason instanceof ApiError && reason.status === 401) return { kind: 'signed-out' };
    if (reason instanceof ApiError && reason.code === 'EMAIL_TOKEN_INVALID') return { kind: 'invalid' };
    if (reason instanceof ApiError && reason.code === 'PASSWORD_CHANGE_OTHER_BROWSER') return { kind: 'other-browser' };
    if (reason instanceof ApiError && reason.status === 400) return { kind: 'invalid' };
    return { kind: 'error', message: 'Không kiểm tra được liên kết lúc này. Hãy mở lại liên kết trong thư để thử lại; liên kết chưa bị sử dụng.' };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (flight.current || !user || !token.current) return;
    if (next !== confirm || [...next].length < 8 || new TextEncoder().encode(next).length > 72) {
      setError('Mật khẩu xác nhận cần khớp; mật khẩu mới ít nhất 8 ký tự và tối đa 72 byte UTF-8.');
      return;
    }
    const binding = loadBinding(user.id);
    if (!binding) { setView({ kind: 'no-binding' }); return; }
    flight.current = true; setBusy(true); setError('');
    const sessionVersion = version.current, userId = user.id;
    try {
      await confirmPasswordChange(token.current, binding, next, AbortSignal.timeout(15000));
      clearBinding(userId, binding);
      if (!live(sessionVersion)) return;
      token.current = null; setNext(''); setConfirm('');
      navigate('/login', { replace: true, state: { accountNotice: 'password-changed', accountSessionVersion: sessionVersion } });
    } catch (reason) {
      // Left the page or switched account while waiting: do not act on the new session.
      if (!live(sessionVersion) || reason instanceof AuthSessionChangedError) return;
      const code = reason instanceof ApiError ? reason.code : undefined;
      if (reason instanceof ApiError && reason.status === 401) {
        navigate('/login', { replace: true, state: { accountNotice: 'session-expired', accountSessionVersion: version.current } });
        return;
      }
      if (code === 'PASSWORD_UNCHANGED') { setError('Mật khẩu mới cần khác mật khẩu hiện tại.'); return; }
      if (code === 'PASSWORD_POLICY') { setError(reason instanceof ApiError ? reason.message : 'Mật khẩu chưa đạt yêu cầu.'); return; }
      if (reason instanceof ApiError && reason.status === 429) { setError('Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.'); return; }
      if (reason instanceof ApiError && (reason.status === 400 || reason.status === 409)) { setView(classify(reason)); return; }
      // 503 / timeout / malformed: the change may or may not have committed. Never resend.
      token.current = null; setNext(''); setConfirm('');
      navigate('/login', { replace: true, state: { accountNotice: 'password-unknown', accountSessionVersion: sessionVersion } });
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const body = (() => {
    switch (view.kind) {
      case 'checking': return <p role="status">Đang kiểm tra liên kết…</p>;
      case 'missing-token': return <p role="alert">Liên kết đổi mật khẩu không đầy đủ. Hãy mở lại đúng liên kết trong thư, hoặc gửi yêu cầu mới tại <Link to="/account">Tài khoản</Link>.</p>;
      case 'signed-out': return <p role="alert">Hãy <Link to="/login">đăng nhập</Link> đúng tài khoản đã yêu cầu, rồi mở lại liên kết trong thư. Liên kết vẫn còn hiệu lực trong thời hạn ghi trong thư.</p>;
      // Without the browser-held binding we cannot ask the server, so cover both causes.
      case 'no-binding': return <p role="alert">Không dùng được liên kết này trên trình duyệt hiện tại. Liên kết chỉ dùng một lần và chỉ mở được trên đúng trình duyệt đã gửi yêu cầu. Nếu bạn đã đổi mật khẩu bằng liên kết này, hãy đăng nhập bằng mật khẩu mới; nếu đang dùng thiết bị khác, hãy gửi yêu cầu mới tại <Link to="/account">Tài khoản</Link>.</p>;
      case 'other-browser': return <p role="alert">Liên kết này cần được mở trên đúng trình duyệt đã gửi yêu cầu đổi mật khẩu. Nếu bạn đang dùng thiết bị hoặc trình duyệt khác, hãy gửi yêu cầu mới tại <Link to="/account">Tài khoản</Link>.</p>;
      case 'invalid': return <p role="alert">Liên kết không hợp lệ, đã được dùng hoặc đã hết hạn. Hãy gửi yêu cầu mới tại <Link to="/account">Tài khoản</Link>.</p>;
      case 'error': return <p role="alert">{view.message}</p>;
      case 'ready': return <form onSubmit={event => void submit(event)}>
        <fieldset disabled={busy}>
          <legend>Đặt mật khẩu mới</legend>
          <p>Liên kết còn hiệu lực đến {new Date(view.expiresAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}. Sau khi đổi, mọi phiên đăng nhập cũ hết hiệu lực.</p>
          <label>Mật khẩu mới<input type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} minLength={8} maxLength={72} required /></label>
          <label>Xác nhận mật khẩu mới<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} minLength={8} maxLength={72} required /></label>
          <button className="market-button" type="submit">{busy ? 'Đang đổi mật khẩu…' : 'Đổi mật khẩu và đăng nhập lại'}</button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>;
    }
  })();

  return <div className={pageStyles.container}>
    <section className={styles.settings} aria-label="Đổi mật khẩu">
      <h2>Đổi mật khẩu</h2>
      {loading ? <p role="status">Đang kiểm tra phiên đăng nhập…</p> : body}
    </section>
  </div>;
}
