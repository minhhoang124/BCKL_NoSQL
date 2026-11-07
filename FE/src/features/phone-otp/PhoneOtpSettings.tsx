import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import {
  createPhoneOtpClient,
  loadPhoneJournal,
  type PhoneStatus,
} from "./phoneOtpClient";
import styles from "./PhoneOtp.module.css";
function PhoneOtpInner({ userId }: { userId: number }) {
  const epoch = getAuthSessionVersion(),
    api = useMemo(() => createPhoneOtpClient(userId), [userId]);
  const [status, setStatus] = useState<PhoneStatus | null>(null),
    [pending, setPending] = useState<string | null>(null),
    [storageError, setStorageError] = useState(""),
    [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [demo, setDemo] = useState(""),
    [consent, setConsent] = useState(false),
    [recoveryConsent, setRecoveryConsent] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = useRef(true),
    latch = useRef(false),
    generation = useRef(0),
    flight = useRef<AbortController | null>(null);
  const current = (ticket: number) =>
    active.current &&
    ticket === generation.current &&
    epoch === getAuthSessionVersion();
  function sync() {
    try {
      setPending(loadPhoneJournal(userId)?.challengeId ?? null);
      setStorageError("");
    } catch {
      setStorageError(
        "Không đọc hoặc lưu được mã chờ trong tab. Chưa cho phép gửi/xác nhận; kiểm tra quyền lưu trữ hoặc mở tab mới.",
      );
    }
  }
  async function read(signal: AbortSignal, ticket: number) {
    const fresh = await api.status(signal);
    if (!current(ticket)) return;
    if (fresh.pending && !loadPhoneJournal(userId))
      api.adopt(fresh.pending.challengeId);
    if (!current(ticket)) return;
    setStatus(fresh);
    sync();
    if (!fresh.pending) setDemo("");
  }
  useEffect(() => {
    active.current = true;
    const c = new AbortController(),
      ticket = ++generation.current;
    flight.current = c;
    sync();
    void read(c.signal, ticket)
      .catch(() => {
        if (current(ticket))
          setError(
            "Chưa tải được trạng thái OTP; chỉ tải lại, chưa gửi mã mới.",
          );
      })
      .finally(() => {
        if (current(ticket)) setBusy(false);
      });
    return () => {
      active.current = false;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- This is the owned asynchronous ticket, not a mounted DOM reference.
      generation.current++;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Cancel the latest owned request, not a DOM ref captured at mount.
      flight.current?.abort();
    };
    // api is bound to this actor/session and the parent is keyed by actor+epoch.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  async function run(action: "read" | "request" | "confirm" | "reconcile") {
    if (latch.current || busy || storageError) return;
    if (action === "request" && (!status || pending || !consent)) return;
    if (
      action === "confirm" &&
      (!pending ||
        status?.pending?.challengeId !== pending ||
        !/^[0-9]{6}$/.test(code))
    )
      return;
    if (action === "reconcile" && (!pending || !recoveryConsent)) return;
    latch.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const c = new AbortController(),
      ticket = ++generation.current;
    flight.current?.abort();
    flight.current = c;
    const typedCode = code;
    let issued = false;
    setCode("");
    setConsent(false);
    setRecoveryConsent(false);
    try {
      if (action === "request") {
        const result = await api.request(phone, status!.version, c.signal);
        if (!current(ticket)) return;
        issued = true;
        setDemo(result.demoCode);
        sync();
      }
      if (action === "confirm" || action === "reconcile") {
        const r =
          action === "confirm"
            ? await api.confirm(pending!, typedCode, c.signal)
            : await api.reconcile(pending!, true, c.signal);
        if (!current(ticket)) return;
        sync();
        setDemo("");
        setNotice(
          r.outcome === "CLOSED"
            ? "Đã đóng mã chưa dùng. Số liên hệ không thay đổi."
            : "Server đã xác nhận yêu cầu này; đang đọc số liên hệ hiện tại.",
        );
      }
      if (current(ticket)) setStatus(null);
      await read(c.signal, ticket);
    } catch (e) {
      if (!current(ticket)) return;
      sync();
      setError(
        e instanceof ApiError && e.status === 429
          ? "Chưa đến lượt gửi mã mới hoặc đã đạt giới hạn. Tải lại trạng thái và thử sau."
          : e instanceof ApiError && e.status === 400
            ? "Mã không hợp lệ, đã hết hạn hoặc đã khóa. Tải lại trạng thái để xem số lượt còn lại."
            : "Chưa xác định được kết quả. Giữ mã chờ; tải trạng thái hoặc chủ động đối chiếu, không gửi lại tự động.",
      );
      setStatus(null);
      if (action === "request" && !issued) setDemo("");
    } finally {
      if (current(ticket)) {
        latch.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className={styles.panel} aria-label="OTP điện thoại sandbox">
      <h2>OTP điện thoại — mô phỏng</h2>
      <p role="note">
        <strong>SANDBOX: không gửi SMS thật.</strong> Mã hiển thị tại đây chỉ để
        kiểm thử, không chứng minh quyền sở hữu số điện thoại và không dùng cho
        đăng nhập, khôi phục mật khẩu hoặc cấp quyền.
      </p>
      {busy && <p role="status">Đang kiểm tra OTP…</p>}
      {error && <p role="alert">{error}</p>}
      {storageError && <p role="alert">{storageError}</p>}
      {notice && <p role="status">{notice}</p>}
      {status && (
        <p>
          {status.contact
            ? `Liên hệ mô phỏng hiện tại: ${status.contact.phoneNumber} · phiên bản ${status.version}`
            : "Chưa có số liên hệ mô phỏng."}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !!storageError}
        onClick={() => void run("read")}
      >
        Tải lại trạng thái OTP
      </button>
      {pending ? (
        <>
          <p>
            Có mã yêu cầu đang chờ. Tải lại trang không tự xác nhận hay gửi SMS.
          </p>
          {status?.pending?.challengeId === pending && (
            <>
              <p>
                Số đang kiểm thử: {status.pending.phoneNumber}. Còn{" "}
                {status.pending.attemptsRemaining} lượt nhập; hạn{" "}
                {new Date(status.pending.expiresAt).toLocaleString("vi-VN")}.
              </p>
              {demo ? (
                <p>
                  Mã QA mô phỏng: <strong>{demo}</strong>
                </p>
              ) : (
                <p>
                  Mã QA chỉ hiển thị lúc yêu cầu. Nếu đã mất mã, đối chiếu để
                  đóng mã trước khi yêu cầu mới.
                </p>
              )}
              <label>
                Mã OTP
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                disabled={busy || !/^[0-9]{6}$/.test(code)}
                onClick={() => void run("confirm")}
              >
                Xác nhận mã mô phỏng
              </button>
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={recoveryConsent}
              onChange={(e) => setRecoveryConsent(e.target.checked)}
              disabled={busy}
            />
            Tôi đồng ý đối chiếu; nếu mã chưa dùng thì đóng mã, không đổi số
            liên hệ.
          </label>
          <button
            type="button"
            disabled={busy || !recoveryConsent}
            onClick={() => void run("reconcile")}
          >
            Đối chiếu yêu cầu OTP
          </button>
        </>
      ) : (
        <>
          <label>
            Số điện thoại định dạng quốc tế
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+84900000001"
              disabled={busy || !status}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={busy || !status}
            />
            Tôi đồng ý thử luồng OTP sandbox cho số này.
          </label>
          <button
            type="button"
            disabled={
              busy || !status || !consent || !/^\+[1-9][0-9]{7,14}$/.test(phone)
            }
            onClick={() => void run("request")}
          >
            Yêu cầu mã OTP mô phỏng
          </button>
        </>
      )}
      {status && (
        <p>
          Có thể yêu cầu mã mới sau{" "}
          {new Date(status.resendAfter).toLocaleString("vi-VN")}; server kiểm
          giới hạn gửi lại.
        </p>
      )}
    </section>
  );
}
export function PhoneOtpSettings() {
  const { user, loading } = useAuth();
  return !loading &&
    user &&
    import.meta.env.VITE_AUTH_PHONE_OTP_ENABLED === "true" ? (
    <PhoneOtpInner
      key={`${user.id}:${getAuthSessionVersion()}`}
      userId={user.id}
    />
  ) : null;
}
