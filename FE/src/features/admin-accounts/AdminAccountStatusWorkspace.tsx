import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import { AdminAccountsReader } from "./AdminAccountsReader";
import { createAccountReadApi, type AccountReadApi } from "./accountReadApi";
import {
  accountStatusApi,
  normalizeStatusReason,
  type AccountStatusApi,
  type StatusHistory,
} from "./accountStatusApi";
import {
  clearStatusPending,
  loadStatusPending,
  prepareStatusPending,
} from "./accountStatusPending";
import styles from "./AdminAccountsLayout.module.css";
const readApi = createAccountReadApi();
type Pending = ReturnType<typeof loadStatusPending>;
export function AdminAccountStatusWorkspace({
  api = accountStatusApi,
  listApi = readApi,
  embedded = false,
}: {
  api?: AccountStatusApi;
  listApi?: AccountReadApi;
  embedded?: boolean;
}) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Đang kiểm tra phiên đăng nhập…</p>;
  if (!user?.isActive || user.role !== "ADMIN")
    return <p role="alert">Cần tài khoản Admin đang hoạt động.</p>;
  return (
    <Workspace
      key={`${user.id}:${getAuthSessionVersion()}`}
      actorId={user.id}
      api={api}
      listApi={listApi}
      embedded={embedded}
    />
  );
}
function Workspace({
  actorId,
  api,
  listApi,
  embedded,
}: {
  actorId: number;
  api: AccountStatusApi;
  listApi: AccountReadApi;
  embedded: boolean;
}) {
  const [listEpoch, setListEpoch] = useState(0);
  const [initial] = useState(() => {
    try {
      return { pending: loadStatusPending(actorId), error: "" };
    } catch (e) {
      return {
        pending: null,
        error: e instanceof Error ? e.message : "Không đọc được mã chờ.",
      };
    }
  });
  const [pending, setPending] = useState<Pending>(initial.pending),
    [storageError, setStorageError] = useState(initial.error),
    [selected, setSelected] = useState<number | null>(null),
    [notice, setNotice] = useState("");
  const refreshPending = () => {
    try {
      setPending(loadStatusPending(actorId));
      setStorageError("");
    } catch (e) {
      setStorageError(
        e instanceof Error ? e.message : "Không đọc được mã chờ.",
      );
    }
  };
  const manage = (id: number) => {
    if (storageError) return;
    try {
      const current = loadStatusPending(actorId);
      setPending(current);
      if (current && current.value.targetId !== id) {
        setNotice(
          `Cần đối chiếu yêu cầu tài khoản #${current.value.targetId} trước.`,
        );
        return;
      }
      setNotice("");
      setSelected(id);
    } catch (e) {
      setStorageError(
        e instanceof Error ? e.message : "Không đọc được mã chờ.",
      );
    }
  };
  return (
    <>
      {storageError && (
        <p role="alert" className={styles.notice}>
          {storageError}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <aside className={styles.notice}>
          <p>
            Có yêu cầu tài khoản #{pending.value.targetId} cần đối chiếu. Chưa
            gửi thao tác mới.
          </p>
          <button onClick={() => manage(pending.value.targetId)}>
            Đối chiếu yêu cầu đang chờ
          </button>
        </aside>
      )}
      <AdminAccountsReader
        key={listEpoch}
        api={listApi}
        embedded={embedded}
        onManage={manage}
      />
      {selected !== null && !storageError && (
        <AccountStatusDialog
          key={selected}
          actorId={actorId}
          targetId={selected}
          api={api}
          pending={pending}
          onPendingChange={refreshPending}
          onSettled={() => setListEpoch((value) => value + 1)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
export function AccountStatusDialog({
  actorId,
  targetId,
  api = accountStatusApi,
  pending,
  onPendingChange,
  onClose,
  onSettled,
}: {
  actorId: number;
  targetId: number;
  api?: AccountStatusApi;
  pending: Pending;
  onPendingChange: () => void;
  onClose: () => void;
  onSettled?: () => void;
}) {
  const titleId = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    epoch = useRef(0),
    busyRef = useRef(false),
    session = useRef(getAuthSessionVersion());
  const [page, setPage] = useState<StatusHistory | null>(null),
    [busy, setBusy] = useState(true),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const current = (generation: number) =>
    generation === epoch.current && session.current === getAuthSessionVersion();
  const failed = (e: unknown) => {
    if (e instanceof ApiError && [401, 403].includes(e.status ?? 0))
      setBlocked(true);
  };
  async function load(before?: number, generation = epoch.current) {
    if (busyRef.current || blocked) return;
    const minimumRevision = page?.account.statusRevision ?? 1;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setConfirmed(false);
    if (before === undefined) setPage(null);
    try {
      const result = await api.history(targetId, before);
      if (result.account.statusRevision < minimumRevision)
        throw new ApiError("Trạng thái đọc bị lùi phiên bản.", 502);
      if (current(generation)) {
        if (page && result.account.isActive !== page.account.isActive)
          setReason("");
        setPage((previous) => ({
          ...result,
          items:
            before === undefined
              ? result.items
              : [...(previous?.items ?? []), ...result.items],
        }));
      }
    } catch (e) {
      if (current(generation)) {
        setError(
          "Không tải được trạng thái/lịch sử. Hãy đọc lại trước khi xác nhận.",
        );
        failed(e);
      }
    } finally {
      if (current(generation)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    const generation = ++epoch.current,
      opener = document.activeElement,
      element = dialog.current;
    const valid = () =>
      generation === epoch.current &&
      session.current === getAuthSessionVersion();
    element?.showModal();
    busyRef.current = true;
    void api
      .history(targetId)
      .then((result) => {
        if (valid()) {
          setPage(result);
          setConfirmed(false);
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (valid()) {
          setError(
            "Không tải được trạng thái/lịch sử. Hãy đọc lại trước khi xác nhận.",
          );
          if (e instanceof ApiError && [401, 403].includes(e.status ?? 0))
            setBlocked(true);
        }
      })
      .finally(() => {
        if (valid()) {
          busyRef.current = false;
          setBusy(false);
        }
      });
    return () => {
      epoch.current = generation + 1;
      busyRef.current = false;
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [targetId, api]);
  async function submit() {
    if (
      busyRef.current ||
      blocked ||
      pending ||
      !page ||
      !confirmed ||
      actorId === targetId
    )
      return;
    let normalized: string;
    try {
      normalized = normalizeStatusReason(reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lý do không hợp lệ.");
      return;
    }
    const generation = epoch.current,
      account = { ...page.account };
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let known = false;
    try {
      const candidate = await prepareStatusPending(
        actorId,
        account,
        !account.isActive,
        normalized,
      );
      if (!current(generation)) return;
      onPendingChange();
      const processed = await api.write(candidate.value, candidate.reason);
      if (!current(generation)) return;
      known = true;
      clearStatusPending(actorId, candidate.raw);
      onPendingChange();
      onSettled?.();
      setConfirmed(false);
      setReason("");
      setPage(null);
      setMessage("Yêu cầu đã được ghi nhận. Đang tải trạng thái hiện tại.");
      const result = await api.history(targetId);
      if (result.account.statusRevision < processed.account.statusRevision)
        throw new ApiError("Trạng thái đọc bị lùi phiên bản.", 502);
      if (current(generation)) {
        setPage(result);
        setMessage(
          "Yêu cầu đã được ghi nhận; bên dưới là trạng thái tại lần đọc mới nhất.",
        );
      }
    } catch (e) {
      if (current(generation)) {
        setConfirmed(false);
        onPendingChange();
        setError(
          known
            ? "Yêu cầu đã được ghi nhận nhưng chưa tải lại được trạng thái. Không gửi lại; hãy đọc lại."
            : "Chưa xác định kết quả. Hãy đối chiếu yêu cầu đang chờ; không gửi lại.",
        );
        failed(e);
      }
    } finally {
      if (current(generation)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function reconcile() {
    if (
      busyRef.current ||
      blocked ||
      !pending ||
      pending.value.actorId !== actorId ||
      pending.value.targetId !== targetId
    )
      return;
    const generation = epoch.current,
      candidate = {
        value: Object.freeze({ ...pending.value }),
        raw: pending.raw,
      };
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setConfirmed(false);
    let settled = false;
    try {
      const result = await api.reconcile(candidate.value);
      if (!current(generation)) return;
      settled = true;
      clearStatusPending(actorId, candidate.raw);
      onPendingChange();
      onSettled?.();
      setReason("");
      setPage({ account: result.current, items: [], nextBeforeRevision: null });
      setMessage(
        result.outcome === "CLOSED"
          ? "Mã yêu cầu đã đóng; thao tác cũ sẽ không thay đổi tài khoản. Nếu vẫn cần, hãy xác nhận một thao tác mới."
          : "Yêu cầu trước đã được ghi nhận. Trạng thái hiện tại có thể đã thay đổi bởi thao tác khác.",
      );
      const history = await api.history(targetId);
      if (history.account.statusRevision < result.current.statusRevision)
        throw new ApiError("Trạng thái đọc bị lùi phiên bản.", 502);
      if (current(generation)) setPage(history);
    } catch (e) {
      if (current(generation)) {
        onPendingChange();
        setError(
          settled
            ? "Đối chiếu đã có kết quả nhưng chưa tải lại được lịch sử. Hãy đọc lại."
            : "Chưa đối chiếu được. Giữ nguyên mã chờ và thử đối chiếu lại khi kết nối ổn định.",
        );
        failed(e);
      }
    } finally {
      if (current(generation)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <dialog
      ref={dialog}
      className={`${styles.layout} ${styles.dialog}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busyRef.current) onClose();
      }}
    >
      <h2 id={titleId}>Trạng thái tài khoản #{targetId}</h2>
      <p>
        Khóa/mở không thay đổi trạng thái Store. Các phiên cũ phải đăng nhập lại
        sau thao tác.
      </p>
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      )}
      {blocked && (
        <p role="alert">
          Phiên hoặc quyền quản trị không còn hợp lệ. Hãy đăng nhập lại.
        </p>
      )}
      {busy && <p role="status">Đang xử lý…</p>}
      {pending && (
        <section>
          <p>
            Có yêu cầu cần đối chiếu. Mã được giữ qua tải lại trang; không gửi
            lại thao tác khóa/mở.
          </p>
          <button disabled={busy || blocked} onClick={() => void reconcile()}>
            Đối chiếu kết quả
          </button>
        </section>
      )}
      {page && (
        <>
          <p>
            Trạng thái tại lần đọc này:{" "}
            <strong>
              {page.account.isActive ? "Đang hoạt động" : "Đã khóa"}
            </strong>{" "}
            · phiên bản {page.account.statusRevision}
          </p>
          {actorId === targetId ? (
            <p>Không thể tự khóa tài khoản quản trị đang sử dụng.</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className={styles.field}>
                Lý do {page.account.isActive ? "khóa" : "mở khóa"}
                <textarea
                  value={reason}
                  disabled={busy || blocked || !!pending}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || blocked || !!pending}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                Tôi xác nhận {page.account.isActive ? "khóa" : "mở khóa"} tài
                khoản #{targetId}
              </label>
              <div className={styles.dialogActions}>
                <button
                  className={styles.primary}
                  type="submit"
                  disabled={busy || blocked || !!pending || !confirmed}
                >
                  {page.account.isActive
                    ? "Khóa tài khoản"
                    : "Mở khóa tài khoản"}
                </button>
              </div>
            </form>
          )}
          <h3>Lịch sử khóa/mở</h3>
          {!page.items.length ? (
            <p>Chưa có lịch sử tại lần đọc này.</p>
          ) : (
            <ol>
              {page.items.map((row) => (
                <li key={row.id}>
                  <strong>{row.afterActive ? "Mở khóa" : "Khóa"}</strong> ·
                  Admin #{row.actorId} · phiên bản {row.fromRevision}→
                  {row.toRevision}
                  <p>{row.reason}</p>
                  <time dateTime={row.createdAt}>
                    {new Date(row.createdAt).toLocaleString("vi-VN")}
                  </time>
                </li>
              ))}
            </ol>
          )}
          {page.nextBeforeRevision !== null && (
            <button
              disabled={busy || blocked}
              onClick={() => void load(page.nextBeforeRevision!)}
            >
              Tải thêm lịch sử
            </button>
          )}
        </>
      )}
      <div className={styles.dialogActions}>
        <button disabled={busy || blocked} onClick={() => void load()}>
          Đọc lại trạng thái và lịch sử
        </button>
        <button disabled={busy} onClick={onClose}>
          Đóng
        </button>
      </div>
    </dialog>
  );
}
