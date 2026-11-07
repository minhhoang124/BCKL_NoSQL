import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import {
  createApplicationApi,
  loadPending,
  positive,
  prepare,
  type Action,
  type ApplicationApi,
  type Pending,
  type Profile,
  type Scope,
  type Status,
  type Summary,
  type View,
} from "./applicationClient";
import styles from "./StoreApplicationPage.module.css";
const empty: Profile = {
  name: "",
  description: "",
  contactName: "",
  contactPhone: "",
  pickupAddress: "",
  returnAddress: "",
};
const labels: Record<Status, string> = {
  PENDING: "Chờ duyệt",
  ACTIVE: "Đã được duyệt",
  REJECTED: "Cần bổ sung hồ sơ",
  SUSPENDED: "Đang tạm khóa",
  CLOSED: "Đã đóng",
};
const message = (e: unknown) =>
  e instanceof ApiError && e.status === 412 && e.code === "EMAIL_VERIFICATION_REQUIRED"
    ? "Cần xác minh email trong Tài khoản. Hồ sơ chưa được gửi; giữ mã và dùng Đối chiếu để đóng mã cũ trước khi gửi yêu cầu mới."
    : e instanceof Error && e.name === "AbortError"
    ? "Chưa nhận được phản hồi đúng hạn. Giữ mã để đối chiếu."
    : e instanceof TypeError
      ? "Chưa nhận được kết quả từ máy chủ. Giữ mã và đối chiếu; không gửi lại."
    : e instanceof Error
      ? e.message
      : "Không nhận được phản hồi. Giữ mã để đối chiếu.";
const newWrites = () =>
  import.meta.env.VITE_SELLER_ONBOARDING_ENABLED === "true" &&
  import.meta.env.VITE_ACCOUNT_BUYER_ACCESS_ENABLED === "true";
export function StoreApplicationPage({
  scope = "OWNER",
  api: override,
}: {
  scope?: Scope;
  api?: ApplicationApi;
}) {
  const { user } = useAuth(),
    location = useLocation();
  const epoch = getAuthSessionVersion();
  if (
    !user?.isActive ||
    (scope === "ADMIN"
      ? user.role !== "ADMIN"
      : !["USER", "SELLER"].includes(user.role))
  )
    return <p role="alert">Bạn không có quyền truy cập hồ sơ cửa hàng.</p>;
  const query = new URLSearchParams(location.search);
  let initialId: number | undefined;
  if (scope === "ADMIN" && query.has("storeId")) {
    const value = query.get("storeId")!;
    try {
      if (
        [...query.keys()].some((k) => k !== "storeId") ||
        query.getAll("storeId").length !== 1 ||
        !/^[1-9][0-9]*$/.test(value)
      )
        throw Error();
      initialId = positive(Number(value));
    } catch {
      return <p role="alert">Mã hồ sơ không hợp lệ.</p>;
    }
  } else if (query.size)
    return <p role="alert">Đường dẫn hồ sơ không hợp lệ.</p>;
  return (
    <Workspace
      key={`${user.id}:${scope}:${epoch}:${initialId ?? ""}`}
      actorId={user.id}
      scope={scope}
      initialId={initialId}
      epoch={epoch}
      override={override}
    />
  );
}
function Workspace({
  actorId,
  scope,
  initialId,
  epoch,
  override,
}: {
  actorId: number;
  scope: Scope;
  initialId?: number;
  epoch: number;
  override?: ApplicationApi;
}) {
  const api = useMemo(
    () => override ?? createApplicationApi(actorId, scope),
    [actorId, scope, override],
  );
  const [view, setView] = useState<View | null>(null),
    [rows, setRows] = useState<Summary[]>([]),
    [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [denied, setDenied] = useState(false),
    [legacy, setLegacy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [draft, setDraft] = useState<Profile>(empty),
    [reason, setReason] = useState("");
  const [operation, setOperation] = useState(
      scope === "OWNER" ? "submit" : "ACTIVE",
    ),
    [confirmed, setConfirmed] = useState(false),
    [recoveryConsent, setRecoveryConsent] = useState(false);
  const [journal, setJournal] = useState<{
    pending: Pending | null;
    error: string;
  }>(() => {
    try {
      return { pending: loadPending(actorId), error: "" };
    } catch {
      return {
        pending: null,
        error: "Không đọc được mã chờ. Đã khóa gửi mới; không tự xóa dữ liệu.",
      };
    }
  });
  const active = useRef(false),
    latch = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    hardDenied = useRef(false);
  const draftRef = useRef<Profile>(empty),
    reasonRef = useRef(""),
    operationRef = useRef(scope === "OWNER" ? "submit" : "ACTIVE"),
    draftVersion = useRef(0),
    confirmation = useRef<{ operation: string; version: number } | null>(null);
  const invalidate = useCallback(() => {
    draftVersion.current++;
    confirmation.current = null;
    setConfirmed(false);
  }, []);
  const install = useCallback(
    (value: View | null) => {
      setView(value);
      setLoaded(true);
      setStale(false);
      setLegacy(false);
      const fields = value
        ? {
            ...value.profile,
            name: value.store.name,
            description: value.store.description ?? "",
          }
        : { ...empty };
      draftRef.current = fields;
      setDraft(fields);
      reasonRef.current = "";
      setReason("");
      const op =
        scope === "OWNER"
          ? value
            ? "edit"
            : "submit"
          : value?.store.status === "ACTIVE"
            ? "SUSPENDED"
            : "ACTIVE";
      operationRef.current = op;
      setOperation(op);
      invalidate();
    },
    [scope, invalidate],
  );
  const fail = useCallback(
    (e: unknown) => {
      setError(message(e));
      setStale(true);
      invalidate();
      if (e instanceof ApiError && [401, 403].includes(e.status ?? 0)) {
        hardDenied.current = true;
        setDenied(true);
        setRows([]);
        setView(null);
        setLoaded(false);
        setDraft(empty);
        draftRef.current = empty;
        setReason("");
        reasonRef.current = "";
      }
      if (
        e instanceof ApiError &&
        e.code === "LEGACY_STORE_WORKFLOW_REQUIRED"
      ) {
        setLegacy(true);
        setView(null);
        setLoaded(false);
      }
    },
    [invalidate],
  );
  const read = useCallback(
    async (
      kind: "reload" | "select" | "history" | "list",
      id?: number,
      snapshot?: View,
      cursor?: number,
    ) => {
      if (latch.current || hardDenied.current) return;
      latch.current = true;
      setBusy(true);
      setError("");
      invalidate();
      const ticket = ++generation.current,
        abort = new AbortController();
      controller.current?.abort();
      controller.current = abort;
      const current = () =>
        active.current &&
        ticket === generation.current &&
        epoch === getAuthSessionVersion();
      const timer = window.setTimeout(() => abort.abort(), 15000);
      try {
        if (scope === "ADMIN" && (kind === "reload" || kind === "list")) {
          const result = await api.list(
            abort.signal,
            kind === "list" ? cursor : undefined,
          );
          if (!current() || abort.signal.aborted) return;
          setRows((previous) =>
            kind === "list"
              ? [
                  ...new Map(
                    [...previous, ...result.items].map((r) => [r.id, r]),
                  ).values(),
                ]
              : result.items,
          );
          setNext(result.nextAfterId);
          if (id === undefined) {
            setLoaded(true);
            return;
          }
        }
        const result =
          scope === "OWNER"
            ? await api.mine(
                abort.signal,
                kind === "history" ? cursor : undefined,
              )
            : await api.detail(
                positive(id ?? snapshot?.store.id),
                abort.signal,
                kind === "history" ? cursor : undefined,
              );
        if (!current() || abort.signal.aborted) return;
        if (kind === "history") {
          if (!result || !snapshot || result.revision !== snapshot.revision) {
            setStale(true);
            setError(
              "Hồ sơ đã thay đổi phiên bản. Tải lại trước khi quyết định.",
            );
            return;
          }
          setView({
            ...snapshot,
            history: [...snapshot.history, ...result.history],
            nextBeforeRevision: result.nextBeforeRevision,
          });
        } else install(result);
      } catch (e) {
        if (current()) fail(e);
      } finally {
        window.clearTimeout(timer);
        if (current()) {
          latch.current = false;
          setBusy(false);
        }
      }
    },
    [api, scope, epoch, invalidate, install, fail],
  );
  useEffect(() => {
    active.current = true;
    latch.current = false;
    const timer = window.setTimeout(() => void read("reload", initialId), 0);
    return () => {
      active.current = false;
      window.clearTimeout(timer);
      // Abort the latest request, not only the initial read; this is not a DOM ref.
      /* oxlint-disable react-hooks/exhaustive-deps */
      controller.current?.abort();
      /* oxlint-enable react-hooks/exhaustive-deps */
      generation.current++;
      latch.current = false;
    };
  }, [read, initialId]);
  function syncJournal() {
    try {
      setJournal({ pending: loadPending(actorId), error: "" });
    } catch {
      setJournal({
        pending: null,
        error: "Mã chờ không đọc được; chưa mở lại thao tác ghi.",
      });
    }
  }
  async function write(recover = false) {
    if (latch.current || hardDenied.current || journal.error) return;
    if (
      recover
        ? !journal.pending ||
          !recoveryConsent ||
          journal.pending.value.scope !== scope
        : !newWrites() ||
          !loaded ||
          stale ||
          legacy ||
          journal.pending ||
          !confirmation.current ||
          confirmation.current.operation !== operationRef.current ||
          confirmation.current.version !== draftVersion.current
    )
      return;
    latch.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    invalidate();
    setRecoveryConsent(false);
    const ticket = ++generation.current,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    const current = () =>
      active.current &&
      ticket === generation.current &&
      epoch === getAuthSessionVersion();
    const timer = window.setTimeout(() => abort.abort(), 15000);
    let savedIntent = !!journal.pending;
    try {
      let pending = journal.pending,
        body;
      if (!recover) {
        const action = (
            scope === "ADMIN" ? "review" : operationRef.current
          ) as Action,
          target = action === "submit" ? actorId : positive(view?.store.id);
        const value = {
          confirmed: true,
          reason: reasonRef.current,
          ...(action === "submit" ? {} : { expectedRevision: view!.revision }),
          ...(action === "submit" || action === "edit" ? draftRef.current : {}),
          ...(action === "review" ? { status: operationRef.current } : {}),
        };
        const candidate = await prepare(
          actorId,
          scope,
          action,
          target,
          value,
          view,
        );
        pending = candidate.pending;
        savedIntent = true;
        body = candidate.body;
        if (!current()) return;
        setJournal({ pending, error: "" });
        reasonRef.current = "";
        setReason("");
      }
      const result = recover
        ? await api.reconcile(pending!, abort.signal, true)
        : await api.execute(pending!, body!, abort.signal);
      if (!current()) return;
      syncJournal();
      setNotice(
        result.outcome === "CLOSED"
          ? "Yêu cầu chưa được thực hiện và đã được đóng. Hồ sơ cửa hàng không bị nộp, duyệt hoặc thay đổi."
          : result.receipt?.reauthenticationRequired
            ? "Đã duyệt và cấp quyền bán. Chủ tài khoản cần đăng nhập lại để tiếp tục."
            : "Server đã xác nhận thao tác và ghi lịch sử.",
      );
      setLoaded(false);
      setStale(true);
      try {
        const id = result.receipt?.storeId ?? pending!.value.targetId;
        const fresh =
          scope === "OWNER"
            ? await api.mine(abort.signal)
            : await api.detail(id, abort.signal);
        if (!current()) return;
        install(fresh);
        if (scope === "ADMIN" && fresh)
          setRows((previous) =>
            previous.map((r) =>
              r.id === fresh.store.id
                ? {
                    ...r,
                    name: fresh.store.name,
                    status: fresh.store.status,
                    revision: fresh.revision,
                  }
                : r,
            ),
          );
      } catch (e) {
        if (current()) {
          fail(e);
          setError(
            "Kết quả đã xác minh, nhưng chưa tải lại được hồ sơ. Chỉ tải lại dữ liệu; không gửi lại thao tác.",
          );
        }
      }
    } catch (e) {
      if (current()) {
        syncJournal();
        if (savedIntent) fail(e);
        else {
          setError(message(e));
          invalidate();
        }
      }
    } finally {
      window.clearTimeout(timer);
      if (current()) {
        latch.current = false;
        setBusy(false);
      }
    }
  }
  const locked =
    busy ||
    denied ||
    !!journal.pending ||
    !!journal.error ||
    !loaded ||
    stale ||
    legacy ||
    !newWrites();
  const allowed =
    scope === "OWNER"
      ? !view || ["PENDING", "REJECTED", "ACTIVE"].includes(view.store.status)
      : !!view &&
        ["PENDING", "ACTIVE", "SUSPENDED"].includes(view.store.status);
  const choices =
    scope === "OWNER"
      ? view
        ? [
            ["edit", "Lưu hồ sơ"],
            ...(view.store.status === "REJECTED"
              ? [["resubmit", "Nộp lại hồ sơ đã lưu"]]
              : []),
          ]
        : [["submit", "Gửi hồ sơ mở cửa hàng"]]
      : view?.store.status === "PENDING"
        ? [
            ["ACTIVE", "Chấp thuận mở cửa hàng"],
            ["REJECTED", "Yêu cầu bổ sung / từ chối"],
          ]
        : view?.store.status === "ACTIVE"
          ? [["SUSPENDED", "Tạm khóa cửa hàng"]]
          : [["ACTIVE", "Khôi phục cửa hàng"]];
  const fieldLabels: Record<keyof Profile, string> = {
    name: "Tên cửa hàng",
    description: "Mô tả cửa hàng",
    contactName: "Người liên hệ",
    contactPhone: "Số điện thoại liên hệ",
    pickupAddress: "Địa chỉ lấy hàng",
    returnAddress: "Địa chỉ nhận hàng trả",
  };
  return (
    <section
      className={styles.root}
      aria-label={
        scope === "ADMIN" ? "Duyệt hồ sơ cửa hàng" : "Đăng ký và hồ sơ cửa hàng"
      }
    >
      <header>
        <p className={styles.eyebrow}>
          {scope === "ADMIN" ? "QUẢN TRỊ NGƯỜI BÁN" : "BẮT ĐẦU BÁN HÀNG"}
        </p>
        <h1>{scope === "ADMIN" ? "Duyệt hồ sơ mở cửa hàng" : "Cửa hàng của bạn"}</h1>
        <p>
          Tài khoản vẫn dùng để mua hàng. Quyền bán được cấp sau khi hồ sơ được
          chấp thuận.
        </p>
      </header>
      {!newWrites() && (
        <p className={styles.callout}>
          Chưa mở gửi hồ sơ mới ở bản giao diện này. Bạn vẫn có thể đọc và đối
          chiếu mã đã lưu.
        </p>
      )}
      {notice && (
        <p role="status" className={styles.success}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error} {error.startsWith("Cần xác minh email trong Tài khoản") && <Link to="/account">Mở Tài khoản</Link>}
        </p>
      )}
      {journal.error && <p role="alert">{journal.error}</p>}
      {legacy && (
        <p>
          Cửa hàng này đang dùng quy trình cũ.{" "}
          <Link to={scope === "ADMIN" ? "/admin/stores" : "/seller"}>
            Mở quản lý cửa hàng hiện có
          </Link>
        </p>
      )}
      <button
        disabled={busy || denied}
        onClick={() => void read("reload", view?.store.id ?? initialId)}
      >
        Tải lại hồ sơ và bỏ bản nháp
      </button>
      {journal.pending && (
        <aside className={styles.callout} aria-label="Phục hồi yêu cầu cửa hàng">
          <h2>Yêu cầu trước đang chờ đối chiếu</h2>
          <p>
            Không gửi lại khi chưa rõ kết quả. Đối chiếu chỉ xác nhận đã xử lý
            hoặc đóng mã chưa chạy.
          </p>
          {journal.pending.value.scope !== scope ? (
            <Link
              to={
                journal.pending.value.scope === "ADMIN"
                  ? "/admin/store-applications"
                  : "/account/store-application"
              }
            >
              Mở đúng khu vực để đối chiếu
            </Link>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={recoveryConsent}
                  disabled={busy || denied}
                  onChange={(e) => setRecoveryConsent(e.target.checked)}
                />{" "}
                Tôi đồng ý đối chiếu mã đã lưu
              </label>
              <button
                disabled={busy || denied || !recoveryConsent}
                onClick={() => void write(true)}
              >
                Đối chiếu yêu cầu
              </button>
            </>
          )}
        </aside>
      )}
      <div className={scope === "ADMIN" ? styles.columns : styles.single}>
        {scope === "ADMIN" && (
          <aside className={styles.card}>
            <h2>Hồ sơ cần quản lý</h2>
            {rows.map((row) => (
              <button
                className={styles.row}
                key={row.id}
                disabled={busy || denied}
                onClick={() => void read("select", row.id)}
              >
                <b>{row.name}</b>
                <span>
                  #{row.id} · {labels[row.status]} · v{row.revision}
                </span>
              </button>
            ))}
            {next !== null && (
              <button
                disabled={busy || denied}
                onClick={() => void read("list", undefined, undefined, next)}
              >
                Tải thêm hồ sơ
              </button>
            )}
            {loaded && !rows.length && (
              <p>Chưa có hồ sơ thuộc quy trình mới.</p>
            )}
          </aside>
        )}
        {(scope === "OWNER" || view) && !legacy && (
          <div className={styles.card}>
            {view && (
              <div className={styles.summary}>
                <b>{labels[view.store.status]}</b>
                <span>
                  Hồ sơ cửa hàng · phiên bản {view.revision}
                </span>
                {view.grant && (
                  <p>
                    Quyền bán đã được ghi nhận. Cửa hàng tạm khóa không được tự mở
                    lại.
                  </p>
                )}
              </div>
            )}
            {scope === "ADMIN" ? (
              <dl className={styles.details}>
                {(Object.keys(fieldLabels) as Array<keyof Profile>).map(
                  (key) => (
                    <div key={key}>
                      <dt>{fieldLabels[key]}</dt>
                      <dd>{draft[key] || "—"}</dd>
                    </div>
                  ),
                )}
              </dl>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void write();
                }}
                className={styles.form}
              >
                <h2>{view ? "Thông tin đã kê khai" : "Thông tin mở cửa hàng"}</h2>
                {(Object.keys(fieldLabels) as Array<keyof Profile>).map(
                  (key) => (
                    <label key={key}>
                      {fieldLabels[key]}
                      {[
                        "description",
                        "pickupAddress",
                        "returnAddress",
                      ].includes(key) ? (
                        <textarea
                          aria-label={fieldLabels[key]}
                          rows={key === "description" ? 3 : 2}
                          disabled={locked || !allowed}
                          value={draft[key]}
                          onChange={(e) => {
                            if (latch.current) return;
                            invalidate();
                            const value = {
                              ...draftRef.current,
                              [key]: e.target.value,
                            };
                            draftRef.current = value;
                            setDraft(value);
                          }}
                        />
                      ) : (
                        <input
                          aria-label={fieldLabels[key]}
                          disabled={locked || !allowed}
                          value={draft[key]}
                          autoComplete="off"
                          onChange={(e) => {
                            if (latch.current) return;
                            invalidate();
                            const value = {
                              ...draftRef.current,
                              [key]: e.target.value,
                            };
                            draftRef.current = value;
                            setDraft(value);
                          }}
                        />
                      )}
                    </label>
                  ),
                )}
                <p>
                  Không gửi giấy tờ định danh hoặc thông tin ngân hàng vào hồ sơ
                  này.
                </p>
              </form>
            )}
            {!allowed && (
              <p className={styles.callout}>
                Trạng thái hiện tại không cho thao tác này. Cửa hàng tạm khóa chỉ
                được Admin khôi phục.
              </p>
            )}
            {allowed && (
              <div className={styles.form}>
                <label>
                  Thao tác
                  <select
                    aria-label="Thao tác"
                    disabled={locked}
                    value={operation}
                    onChange={(e) => {
                      if (latch.current) return;
                      invalidate();
                      operationRef.current = e.target.value;
                      setOperation(e.target.value);
                    }}
                  >
                    {choices.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {operation === "resubmit" && (
                  <p>
                    Nộp lại thông tin đã lưu trên server. Nếu vừa sửa các ô phía
                    trên, hãy lưu hồ sơ trước.
                  </p>
                )}
                <label>
                  Lý do / nội dung gửi duyệt
                  <textarea
                    aria-label="Lý do / nội dung gửi duyệt"
                    disabled={locked}
                    value={reason}
                    onChange={(e) => {
                      if (latch.current) return;
                      invalidate();
                      reasonRef.current = e.target.value;
                      setReason(e.target.value);
                    }}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={locked}
                    onChange={(e) => {
                      if (latch.current) return;
                      confirmation.current = e.target.checked
                        ? {
                            operation: operationRef.current,
                            version: draftVersion.current,
                          }
                        : null;
                      setConfirmed(e.target.checked);
                    }}
                  />{" "}
                  Tôi xác nhận thông tin và thao tác đang chọn
                </label>
                <button
                  disabled={
                    locked ||
                    !confirmed ||
                    [...reason.normalize("NFC").trim()].length < 10
                  }
                  onClick={() => void write()}
                >
                  {scope === "ADMIN"
                    ? "Ghi nhận quyết định"
                    : operation === "submit"
                      ? "Gửi hồ sơ"
                      : "Xác nhận thao tác"}
                </button>
              </div>
            )}
            {view && (
              <section className={styles.history}>
                <h2>Lịch sử hồ sơ</h2>
                {view.history.map((h) => (
                  <article key={h.id}>
                    <b>
                      v{h.toRevision} ·{" "}
                      {h.action === "edit" ? "Sửa hồ sơ" : labels[h.toStatus]}
                    </b>
                    <p>{h.reason}</p>
                    <small>
                      {new Date(h.createdAt).toLocaleString("vi-VN")} · người
                      thực hiện #{h.actorId}
                    </small>
                  </article>
                ))}
                {view.nextBeforeRevision !== null && (
                  <button
                    disabled={busy || denied}
                    onClick={() =>
                      void read(
                        "history",
                        view.store.id,
                        view,
                        view.nextBeforeRevision!,
                      )
                    }
                  >
                    Tải lịch sử trước
                  </button>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
