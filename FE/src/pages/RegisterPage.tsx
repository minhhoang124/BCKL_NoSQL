import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { fetchApi, ApiError } from '../services/apiClient';
import type { SessionResponse } from '../types/auth';
import { ErrorMessage } from '../components/ErrorMessage/ErrorMessage';
import styles from './AuthForm.module.css';
import { AuthLayout } from '../components/AuthLayout/AuthLayout';

export function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const session = await fetchApi<SessionResponse>('/auth/register', {
        method: 'POST',
        retryOnUnauthorized: false,
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });

      login(session);
      navigate('/', { replace: true });
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
    <AuthLayout><div className={styles.container}>
      <h1 className={styles.title}>Đăng ký</h1>
      {error && <ErrorMessage message={error} />}
      <form className={styles.form} onSubmit={submit}>
        <label>
          Họ và tên
          <input name="fullName" minLength={2} maxLength={100} required />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Mật khẩu
          <input name="password" type="password" minLength={8} maxLength={72} autoComplete="new-password" required />
        </label>
        {/* TODO: Mô hình đăng ký Seller sẽ được tách sang onboarding riêng */}
        <label>
          Loại tài khoản
          <select name="accountType" defaultValue="USER">
            <option value="USER">Người mua</option>
            <option value="SELLER">Người bán</option>
          </select>
        </label>
        <button type="submit" className={`market-button ${styles.submitBtn}`} disabled={busy}>
          {busy ? 'Đang xử lý...' : 'Tạo tài khoản'}
        </button>
      </form>
      <p className={styles.linkText}>
        Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
      </p>
    </div></AuthLayout>
  );
}
