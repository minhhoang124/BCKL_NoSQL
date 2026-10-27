import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { getAuthSessionVersion } from "../../services/apiClient";
import { createEmailApi, tokenFromFragment } from "./emailClient";
import styles from "./EmailRecoveryPages.module.css";
function LocalMailNotice() {
  return import.meta.env.VITE_AUTH_EMAIL_SANDBOX === "true" ? (
    <p role="note">
      QA local: thư được giữ trong hộp thư thử nghiệm, không gửi tới Gmail hoặc
      người nhận thật.
    </p>
  ) : null;
}
export function ForgotPasswordPage() {
  const { user, loading } = useAuth();
  if (loading) return <p>Đang xác minh phiên đăng nhập…</p>;
  return (
    <RequestForm key={`${user?.id ?? "guest"}:${getAuthSessionVersion()}`} />
  );
}
function RequestForm() {
  const api = useMemo(() => createEmailApi(), []),
    flight = useRef(false),
    active = useRef(false),
    controller = useRef<AbortController | null>(null);
  const [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  async function submit() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setMessage("");
    const c = new AbortController();
    controller.current = c;
    const timer = setTimeout(() => c.abort(), 10000);
    try {
      const m = await api.request(email, c.signal);
      if (active.current) setMessage(m);
    } catch {
      if (active.current)
        setMessage(
          "Chưa rõ kết quả yêu cầu. Không tự gửi lại; kiểm tra thư hoặc thử lại sau.",
        );
    } finally {
      clearTimeout(timer);
      flight.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className={styles.panel}>
      <h1>Quên mật khẩu</h1>
      <LocalMailNotice />
      <p>
        Nhập email đăng nhập để yêu cầu liên kết một lần. Phản hồi không cho
        biết email có tài khoản hay không.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Email đăng nhập
          <input
            aria-label="Email đăng nhập"
            type="email"
            maxLength={254}
            required
            autoComplete="email"
            disabled={busy}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button disabled={busy}>
          {busy ? "Đang yêu cầu…" : "Yêu cầu liên kết đặt lại"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      <Link to="/login">Về đăng nhập</Link>
    </section>
  );
}
export function EmailConfirmationPage({ reset = false }: { reset?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <p>Đang xác minh phiên đăng nhập…</p>;
  return (
    <ConfirmationForm
      key={`${user?.id ?? "guest"}:${getAuthSessionVersion()}:${reset}`}
      reset={reset}
    />
  );
}
function ConfirmationForm({ reset = false }: { reset?: boolean }) {
  const [token] = useState(() => tokenFromFragment(window.location.hash)),
    api = useMemo(() => createEmailApi(), []),
    active = useRef(false),
    flight = useRef(false),
    controller = useRef<AbortController | null>(null);
  const [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [consent, setConsent] = useState(false),
    [locked, setLocked] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  async function submit() {
    if (flight.current || locked || !token || !consent) return;
    if (
      reset &&
      (password !== repeat ||
        [...password].length < 8 ||
        new TextEncoder().encode(password).length > 72 ||
        password.includes("\0"))
    ) {
      setError(
        "Mật khẩu nhập lại phải khớp; ít nhất 8 ký tự, tối đa 72 byte UTF-8.",
      );
      return;
    }
    flight.current = true;
    setLocked(true);
    setError("");
    const c = new AbortController();
    controller.current = c;
    const timer = setTimeout(() => c.abort(), 15000);
    try {
      await api.confirm(token, reset ? password : undefined, c.signal);
      if (active.current)
        setMessage(
          reset
            ? "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới."
            : "Email trong liên kết đã được xác minh. Có thể quay lại tài khoản để kiểm tra.",
        );
    } catch {
      if (active.current)
        setError(
          "Chưa xác nhận được kết quả hoặc liên kết không còn hiệu lực. Không tự gửi lại; hãy kiểm tra trạng thái hoặc đăng nhập bằng mật khẩu mới.",
        );
    } finally {
      clearTimeout(timer);
      setPassword("");
      setRepeat("");
    }
  }
  return (
    <section className={styles.panel}>
      <h1>{reset ? "Đặt lại mật khẩu" : "Xác minh email"}</h1>
      <LocalMailNotice />
      <p>
        Liên kết chỉ có hiệu lực 15 phút và được dùng một lần. Trang này không
        tự đăng nhập hay đổi vai trò tài khoản.
      </p>
      {!token ? (
        <p role="alert">
          Thiếu liên kết hợp lệ. Hãy mở lại thư hoặc yêu cầu liên kết mới.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {reset && (
            <>
              <label>
                Mật khẩu mới
                <input
                  aria-label="Mật khẩu mới"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={locked}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                Nhập lại mật khẩu mới
                <input
                  aria-label="Nhập lại mật khẩu mới"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={locked}
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            <input
              type="checkbox"
              disabled={locked}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Tôi xác nhận thực hiện thao tác theo liên kết email này.
          </label>
          <button disabled={locked || !consent}>
            {reset ? "Xác nhận đặt lại mật khẩu" : "Xác nhận email"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        <Link to="/login">Đăng nhập</Link> ·{" "}
        <Link to="/account">Kiểm tra tài khoản</Link> ·{" "}
        <Link to="/forgot-password">Yêu cầu liên kết đặt lại mới</Link>
      </p>
    </section>
  );
}
export function EmailVerificationSettings() {
  const { user } = useAuth();
  if (!user?.isActive) return null;
  return <VerificationSettings key={`${user.id}:${getAuthSessionVersion()}`} />;
}
function VerificationSettings() {
  const api = useMemo(() => createEmailApi(), []),
    active = useRef(false),
    generation = useRef(0),
    flight = useRef(false),
    controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<{
      email: string;
      verifiedAt: string | null;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function run(send = false) {
    if (flight.current || !active.current) return;
    flight.current = true;
    setBusy(true);
    setMessage("");
    const owner = generation.current,
      c = new AbortController();
    controller.current = c;
    const timer = setTimeout(() => c.abort(), 15000),
      valid = () => active.current && generation.current === owner;
    try {
      if (send) {
        const m = await api.request(null, c.signal);
        if (valid()) setMessage(m);
      }
      const s = await api.status(c.signal);
      if (valid()) setStatus(s);
    } catch {
      if (valid()) {
        setStatus(null);
        setMessage(
          "Không tải được trạng thái email. Tải lại để kiểm tra; không tự gửi lại thư.",
        );
      }
    } finally {
      clearTimeout(timer);
      if (controller.current === c) {
        controller.current = null;
        flight.current = false;
      }
      if (valid()) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void run();
    return () => {
      active.current = false;
      generation.current++;
      controller.current?.abort();
      flight.current = false;
    }; /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  return (
    <section className={styles.panel}>
      <h2>Xác minh email</h2>
      <LocalMailNotice />
      {status && (
        <p>
          {status.email}: {status.verifiedAt ? "Đã xác minh" : "Chưa xác minh"}
        </p>
      )}
      <button disabled={busy} onClick={() => void run()}>
        Tải trạng thái email
      </button>
      {status && !status.verifiedAt && (
        <button disabled={busy} onClick={() => void run(true)}>
          Gửi thư xác minh email
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
