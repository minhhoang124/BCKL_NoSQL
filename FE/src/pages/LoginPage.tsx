import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { fetchApi, ApiError, getAuthSessionVersion } from '../services/apiClient';
import type { SessionResponse } from '../types/auth';
import { ErrorMessage } from '../components/ErrorMessage/ErrorMessage';
import styles from './AuthForm.module.css';
import { GoogleLogin } from '../features/auth-google/GoogleAuth';
import { AuthLayout } from '../components/AuthLayout/AuthLayout';

export function LoginPage() {
  const { login, endSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const flight = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flight.current?.abort();
      flight.current = null;
    };
  }, []);
  useEffect(() => {
    const state = location.state;
    if (['password-changed', 'password-unknown', 'session-expired'].includes(state?.accountNotice) && Number.isSafeInteger(state?.accountSessionVersion)) {
      // Clear only after the Login route has committed. Clearing inside the
      // protected Account route races its redirect and can lose the notice.
      endSession?.(state.accountSessionVersion);
    }
  }, [endSession, location.key, location.state]);

  const from = location.state?.from?.pathname || '/';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React state alone does not serialize two submits in the same tick.
    if (!mounted.current || flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    const version = getAuthSessionVersion();
    const ownsResponse = () => mounted.current && flight.current === controller
      && !controller.signal.aborted && getAuthSessionVersion() === version;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const session = await fetchApi<SessionResponse>('/auth/login', {
        method: 'POST',
        retryOnUnauthorized: false,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });

      if (!ownsResponse()) return;
      login(session);
      navigate(from, { replace: true });
    } catch (err) {
      if (!ownsResponse()) return;
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Có lỗi không xác định.');
      }
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  return (
    <AuthLayout><div className={styles.container}>
      <div className={styles.cardTopMeta}>
        <span className={styles.festiveChip}>🎅 Phiên bản Noel 2026</span>
        <span className={styles.qrBadge}>▦ Bảo mật phiên &amp; OAuth 2.0</span>
      </div>
      <h1 className={styles.title}>Đăng nhập</h1>
      <p className={styles.subtitle}>Chào mừng bạn trở lại với BCKL · Chợ hiện đại.</p>
      {new URLSearchParams(location.search).get('google') === 'collision' && <p role="alert">Email đã có tài khoản BCKL. Hãy đăng nhập bằng mật khẩu rồi vào Tài khoản để chủ động liên kết Google.</p>}
      {new URLSearchParams(location.search).get('google') === 'linked' && <p role="status">Đã liên kết Google và thu hồi các phiên cũ. Hãy đăng nhập lại.</p>}
      {new URLSearchParams(location.search).get('google') === 'failed' && <p role="alert">Đăng nhập Google chưa hoàn tất hoặc đã hết hạn. Bạn có thể chủ động bắt đầu lại.</p>}
      {location.state?.accountNotice === 'password-changed' && <p role="status">Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.</p>}
      {location.state?.accountNotice === 'session-expired' && <p role="alert">Phiên đăng nhập đã hết hiệu lực. Hãy đăng nhập lại.</p>}
      {location.state?.accountNotice === 'password-unknown' && <p role="alert">Chưa rõ kết quả đổi mật khẩu. Không gửi lại tự động; hãy thử đăng nhập bằng mật khẩu mới, hoặc mật khẩu cũ nếu chưa được đổi.</p>}
      {error && <ErrorMessage message={error} />}
      <form className={styles.form} onSubmit={submit}>
        <label>
          Email
          <input name="email" type="email" placeholder="Nhập địa chỉ email của bạn..." autoComplete="email" required />
        </label>
        <label>
          Mật khẩu
          <input name="password" type="password" placeholder="Nhập mật khẩu (tối thiểu 8 ký tự)..." minLength={8} maxLength={72} autoComplete="current-password" required />
        </label>
        <button type="submit" className={`market-button ${styles.submitBtn}`} disabled={busy}>
          {busy ? 'Đang xử lý...' : 'Đăng nhập'}
        </button>
      </form>
      <GoogleLogin />
      <p className={styles.linkText}>
        {import.meta.env.VITE_AUTH_EMAIL_ENABLED === 'true' && <><Link to="/forgot-password">Quên mật khẩu?</Link><br /></>}
        Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link>
      </p>
    </div></AuthLayout>
  );
}
