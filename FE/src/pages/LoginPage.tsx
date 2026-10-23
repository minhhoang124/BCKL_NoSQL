import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { fetchApi, ApiError, getAuthSessionVersion } from '../services/apiClient';
import type { SessionResponse } from '../types/auth';
import { ErrorMessage } from '../components/ErrorMessage/ErrorMessage';
import styles from './AuthForm.module.css';
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
      <h1 className={styles.title}>Đăng nhập</h1>
      <p className={styles.subtitle}>Chào mừng bạn trở lại với BCKL.</p>
      {location.state?.accountNotice === 'password-changed' && <p role="status">Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.</p>}
      {location.state?.accountNotice === 'session-expired' && <p role="alert">Phiên đăng nhập đã hết hiệu lực. Hãy đăng nhập lại.</p>}
      {location.state?.accountNotice === 'password-unknown' && <p role="alert">Chưa rõ kết quả đổi mật khẩu. Không gửi lại tự động; hãy thử đăng nhập bằng mật khẩu mới, hoặc mật khẩu cũ nếu chưa được đổi.</p>}
      {error && <ErrorMessage message={error} />}
      <form className={styles.form} onSubmit={submit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Mật khẩu
          <input name="password" type="password" minLength={8} maxLength={72} autoComplete="current-password" required />
        </label>
        <button type="submit" className={`market-button ${styles.submitBtn}`} disabled={busy}>
          {busy ? 'Đang xử lý...' : 'Đăng nhập'}
        </button>
      </form>
      <p className={styles.linkText}>
        Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link>
      </p>
    </div></AuthLayout>
  );
}
