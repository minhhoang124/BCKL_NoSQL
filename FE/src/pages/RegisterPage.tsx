import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import { fetchApi, ApiError } from "../services/apiClient";
import type { SessionResponse } from "../types/auth";
import { ErrorMessage } from "../components/ErrorMessage/ErrorMessage";
import styles from "./AuthForm.module.css";
import { AuthLayout } from "../components/AuthLayout/AuthLayout";

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
      const session = await fetchApi<SessionResponse>("/auth/register", {
        method: "POST",
        retryOnUnauthorized: false,
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });

      login(session);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Có lỗi không xác định.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className={styles.container}>
        <div className={styles.cardTopMeta}>
          <span className={styles.festiveChip}>🎅 Mùa lễ hội Noel 2026</span>
          <span className={styles.qrBadge}>🎁 Ưu đãi thành viên mới</span>
        </div>
        <h1 className={styles.title}>Đăng ký</h1>
        <p className={styles.subtitle}>Tạo tài khoản mua sắm và nhận ngay ưu đãi mùa Giáng Sinh.</p>
        {error && <ErrorMessage message={error} />}
        <form className={styles.form} onSubmit={submit}>
          <label>
            Họ và tên
            <input name="fullName" minLength={2} maxLength={100} placeholder="Nhập họ và tên đầy đủ..." required />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" placeholder="Nhập địa chỉ email của bạn..." required />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="Tạo mật khẩu (tối thiểu 8 ký tự)..."
              required
            />
          </label>
          {import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === "true" ? (
            <>
              <input type="hidden" name="accountType" value="USER" />
              <p>
                Tạo tài khoản để mua hàng. Nếu muốn bán, bạn nộp hồ sơ mở Store
                sau khi đăng nhập; quyền bán được cấp khi hồ sơ được duyệt.
              </p>
            </>
          ) : (
            <label>
              Loại tài khoản
              <select name="accountType" defaultValue="USER">
                <option value="USER">Người mua</option>
                <option value="SELLER">Người bán</option>
              </select>
            </label>
          )}
          <button
            type="submit"
            className={`market-button ${styles.submitBtn}`}
            disabled={busy}
          >
            {busy ? "Đang xử lý..." : "Tạo tài khoản"}
          </button>
        </form>
        <p className={styles.linkText}>
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
