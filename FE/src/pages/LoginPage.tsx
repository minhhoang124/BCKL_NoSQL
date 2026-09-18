import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { fetchApi, ApiError } from '../services/apiClient';
import type { SessionResponse } from '../types/auth';
import { ErrorMessage } from '../components/ErrorMessage/ErrorMessage';
import styles from './AuthForm.module.css';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = location.state?.from?.pathname || '/';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const session = await fetchApi<SessionResponse>('/auth/login', {
        method: 'POST',
        retryOnUnauthorized: false,
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });

      login(session);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Có lỗi không xác định.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Đăng nhập</h1>
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
        <button type="submit" className={styles.submitBtn} disabled={busy}>
          {busy ? 'Đang xử lý...' : 'Đăng nhập'}
        </button>
      </form>
      <p className={styles.linkText}>
        Chưa có tài khoản? <Link to="/register">Đăng ký ngay</Link>
      </p>
    </div>
  );
}
