import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { ApiError, fetchApi, getAuthSessionVersion } from "../../services/apiClient";
import styles from "./GoogleAuth.module.css";

export function checkedGoogleUrl(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("authorizationUrl" in value) ||
    typeof value.authorizationUrl !== "string"
  )
    throw Error("Phản hồi Google không hợp lệ.");
  const u = new URL(value.authorizationUrl);
  if (
    u.origin !== "https://accounts.google.com" ||
    u.pathname !== "/o/oauth2/v2/auth" ||
    u.hash ||
    u.username ||
    u.password ||
    u.searchParams.get("response_type") !== "code" ||
    u.searchParams.get("code_challenge_method") !== "S256"
  )
    throw Error("Địa chỉ Google không hợp lệ.");
  return u.toString();
}
function GoogleAction({
  link = false,
  navigate = (url: string) => window.location.assign(url),
}: {
  link?: boolean;
  navigate?: (url: string) => void;
}) {
  const { user, loading } = useAuth(),
    [password, setPassword] = useState(""),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState<{
      linked: boolean;
      email: string | null;
    } | null>(null);
  const latch = useRef(false),
    active = useRef(true),
    controller = useRef<AbortController | null>(null),
    epoch = getAuthSessionVersion();
  useEffect(() => {
    active.current = true;
    const c = new AbortController();
    if (link && user)
      void fetchApi<{ linked: boolean; email: string | null }>(
        "/auth/google/status",
        { signal: c.signal, cache: "no-store" },
      )
        .then((r) => {
          if (
            !active.current ||
            c.signal.aborted ||
            epoch !== getAuthSessionVersion()
          )
            return;
          if (
            typeof r.linked !== "boolean" ||
            (r.linked ? typeof r.email !== "string" : r.email !== null)
          )
            throw Error("Không đọc được liên kết Google.");
          setStatus(r);
        })
        .catch(() => {
          if (!c.signal.aborted && active.current)
            setError(
              "Chưa đọc được trạng thái Google. Tải lại trang trước khi liên kết.",
            );
        });
    return () => {
      active.current = false;
      c.abort();
      controller.current?.abort();
    };
  }, [epoch, link, user]);
  async function start() {
    if (
      latch.current ||
      loading ||
      (link
        ? !user || !status || status.linked || !password || !consent
        : !!user)
    )
      return;
    latch.current = true;
    setBusy(true);
    setError("");
    const c = new AbortController();
    controller.current = c;
    const body = link
      ? { confirmed: true, currentPassword: password }
      : { confirmed: true };
    setPassword("");
    setConsent(false);
    try {
      const r = await fetchApi("/auth/google/" + (link ? "link" : "start"), {
        method: "POST",
        body: JSON.stringify(body),
        retryOnUnauthorized: false,
        signal: AbortSignal.any([c.signal, AbortSignal.timeout(15000)]),
      });
      if (
        active.current &&
        !c.signal.aborted &&
        epoch === getAuthSessionVersion()
      )
        navigate(checkedGoogleUrl(r));
    } catch (e) {
      if (
        active.current &&
        !c.signal.aborted &&
        epoch === getAuthSessionVersion()
      )
        setError(e instanceof ApiError && e.status === 409 && e.code === 'GOOGLE_ALREADY_LINKED'
          ? 'Tài khoản đã có liên kết Google. Tải lại trang để kiểm tra trạng thái hiện tại.'
          : e instanceof ApiError && e.status === 401
            ? 'Không xác thực được mật khẩu hoặc phiên đăng nhập. Đăng nhập lại và kiểm tra mật khẩu hiện tại.'
            : 'Chưa mở được Google. Không tự gửi lại; tải lại trang để kiểm tra phiên và trạng thái liên kết.');
    } finally {
      if (active.current && epoch === getAuthSessionVersion()) {
        latch.current = false;
        setBusy(false);
      }
    }
  }
  if (loading || (!link && user)) return null;
  return (
    <section className={styles.panel} aria-label={link ? "Liên kết Google" : "Đăng nhập Google"}>
      {link && (
        <>
          <h2>Liên kết Google</h2>
          {!status ? (
            <p>{error ? 'Chưa đọc được trạng thái liên kết.' : 'Đang kiểm tra liên kết…'}</p>
          ) : status.linked ? (
            <p>Đã liên kết Google: {status.email}</p>
          ) : (
            <>
              <p>
                Liên kết chỉ thêm cách đăng nhập; không đổi email, vai trò hoặc
                quyền bán hiện tại.
              </p>
              <label>
                Mật khẩu hiện tại
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Tôi đồng ý liên kết tài khoản Google được chọn và đăng nhập lại
                sau khi hoàn tất.
              </label>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {(!link || (status && !status.linked)) && (
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || (link && (!status || !password || !consent))}
        >
          {busy
            ? "Đang mở Google…"
            : link
              ? "Xác nhận và chọn Google"
              : "Đăng nhập bằng Google"}
        </button>
      )}
    </section>
  );
}
export function GoogleLogin() {
  return import.meta.env.VITE_AUTH_GOOGLE_ENABLED === "true" ? (
    <GoogleAction />
  ) : null;
}
export function GoogleLink() {
  const { user } = useAuth();
  return import.meta.env.VITE_AUTH_GOOGLE_ENABLED === "true" && user ? (
    <GoogleAction key={`${user.id}:${getAuthSessionVersion()}`} link />
  ) : null;
}
export { GoogleAction };
