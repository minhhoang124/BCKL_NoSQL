import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import {
  createReviewApi,
  loadPending,
  prepare,
  type Pending,
  type Review,
  type Scope,
  type Summary,
  type View,
} from "./reviewClient";
import styles from "./ReviewPage.module.css";
const labels = {
  BUYER: "Đánh giá mặt hàng đã mua",
  SELLER: "Phản hồi đánh giá",
  ADMIN: "Kiểm duyệt đánh giá",
};
const path = (scope: Scope, itemId: number) =>
  scope === "BUYER"
    ? `/account/reviews?itemId=${itemId}`
    : scope === "SELLER"
      ? "/seller/reviews"
      : "/admin/reviews";
const date = (v: string) => new Date(v).toLocaleString("vi-VN");
export function ReviewPage({ scope }: { scope: Scope }) {
  const { user, loading } = useAuth(),
    [params] = useSearchParams();
  if (loading) return <p>Đang kiểm tra phiên…</p>;
  if (
    !user?.isActive ||
    (scope === "ADMIN"
      ? user.role !== "ADMIN"
      : scope === "SELLER"
        ? user.role !== "SELLER"
        : !["USER", "SELLER"].includes(user.role))
  )
    return <p role="alert">Bạn không có quyền truy cập đánh giá này.</p>;
  const raw = params.get("itemId"),
    itemId =
      raw && /^[1-9][0-9]*$/.test(raw) && Number(raw) <= 2147483647
        ? Number(raw)
        : null;
  if (
    [...params.keys()].some((k) => k !== "itemId") ||
    params.getAll("itemId").length > 1 ||
    (raw !== null && !itemId)
  )
    return <p role="alert">Mã mặt hàng không hợp lệ.</p>;
  return (
    <Workspace
      key={`${user.id}:${scope}:${getAuthSessionVersion()}:${itemId}`}
      actorId={user.id}
      scope={scope}
      initialItem={itemId}
    />
  );
}
function Workspace({
  actorId,
  scope,
  initialItem,
}: {
  actorId: number;
  scope: Scope;
  initialItem: number | null;
}) {
  const api = useMemo(() => createReviewApi(actorId, scope), [actorId, scope]),
    epoch = getAuthSessionVersion();
  const [view, setView] = useState<View | null>(null),
    [selected, setSelected] = useState<Review | null>(null),
    [rows, setRows] = useState<Summary[]>([]),
    [next, setNext] = useState<number | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [journalError, setJournalError] = useState(""),
    [draft, setDraft] = useState(""),
    [score, setScore] = useState(5),
    [confirmed, setConfirmed] = useState(false),
    [consent, setConsent] = useState(false);
  const latch = useRef(false),
    alive = useRef(false),
    controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    item = useRef<number | null>(initialItem),
    current = useRef<Review | null>(null),
    draftRef = useRef(""),
    scoreRef = useRef(5),
    version = useRef(0),
    confirmedVersion = useRef<number | null>(null),
    recoveryConsent = useRef(false);
  const live = useCallback(
    () => alive.current && getAuthSessionVersion() === epoch,
    [epoch],
  );
  const invalidate = () => {
    version.current++;
    confirmedVersion.current = null;
    setConfirmed(false);
  };
  const sync = useCallback(() => {
    try {
      setPending(loadPending(actorId));
      setJournalError("");
    } catch {
      setJournalError(
        "Không đọc được mã đánh giá đang chờ. Chưa gửi thêm yêu cầu; cần kiểm tra dữ liệu lưu trong phiên.",
      );
    }
  }, [actorId]);
  const install = (r: Review | null, v: View | null) => {
    current.current = r;
    setSelected(r);
    setView(v);
    const value = scope === "BUYER" ? (r?.body ?? "") : "";
    draftRef.current = value;
    scoreRef.current = r?.rating ?? 5;
    setDraft(value);
    setScore(scoreRef.current);
    invalidate();
    setReady(true);
  };
  async function fetchState(
    signal: AbortSignal,
    target: number | null,
    before?: number,
  ) {
    if (scope === "BUYER") {
      if (!target) {
        setReady(false);
        return;
      }
      const v = await api.detail(target, signal);
      if (!live()) return;
      install(v.review, v);
    } else {
      const page = await api.list(signal, before ?? undefined);
      if (!live()) return;
      setRows((old) =>
        before
          ? [
              ...old,
              ...page.items.filter((x) => !old.some((r) => r.id === x.id)),
            ]
          : page.items,
      );
      setNext(page.nextBeforeId);
      if (!before) {
        install(null, null);
        item.current = null;
      }
      if (target) {
        if (scope === "ADMIN") {
          const v = await api.detail(target, signal);
          if (!live()) return;
          item.current = target;
          install(v.review, v);
        } else {
          const row = page.items.find((r) => r.orderItemId === target);
          if (row) {
            item.current = target;
            install(row, null);
          }
        }
      }
    }
  }
  async function load(target = item.current, before?: number) {
    if (latch.current || !live()) return;
    latch.current = true;
    setBusy(true);
    setError("");
    const turn = ++generation.current,
      ctl = new AbortController();
    controller.current = ctl;
    try {
      await fetchState(
        AbortSignal.any([ctl.signal, AbortSignal.timeout(15000)]),
        target,
        before,
      );
      if (live()) sync();
    } catch (e) {
      if (live() && turn === generation.current) {
        setReady(false);
        setError(e instanceof Error ? e.message : "Không tải được đánh giá.");
        if (e instanceof ApiError && [401, 403].includes(e.status ?? 0)) {
          setRows([]);
          setView(null);
          setSelected(null);
          current.current = null;
          setDraft("");
          draftRef.current = "";
        }
      }
    } finally {
      if (live() && turn === generation.current) {
        latch.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    const t = window.setTimeout(() => {
      sync();
      void load(initialItem);
    }, 0);
    return () => {
      alive.current = false;
      window.clearTimeout(t);
      controller.current?.abort();
      generation.current++;
      latch.current = false;
    };
    // Workspace is keyed by actor, scope, session and item; every request checks that epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, initialItem]);
  async function select(row: Summary) {
    if (latch.current || pending || journalError || !ready) return;
    item.current = row.orderItemId;
    if (scope === "ADMIN") await load(row.orderItemId);
    else install(row, null);
  }
  const enabled = import.meta.env.VITE_PRODUCT_REVIEWS_ENABLED === "true";
  const permitted =
    scope === "BUYER"
      ? view?.canCreate || view?.canEdit
      : !!selected && (scope === "SELLER" ? !selected.reply : !selected.hidden);
  const locked = busy || !!pending || !!journalError || !ready || !enabled;
  async function write() {
    if (
      latch.current ||
      locked ||
      !permitted ||
      !item.current ||
      confirmedVersion.current !== version.current
    )
      return;
    latch.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const target = item.current,
      turn = ++generation.current,
      ctl = new AbortController();
    controller.current = ctl;
    let saved = false;
    try {
      const action =
        scope === "BUYER"
          ? current.current
            ? "edit"
            : "create"
          : scope === "SELLER"
            ? "reply"
            : "hide";
      const body = {
        confirmed: true,
        ...(action === "create"
          ? {}
          : { expectedRevision: current.current!.revision }),
        ...(scope === "BUYER"
          ? { rating: scoreRef.current, body: draftRef.current }
          : scope === "SELLER"
            ? { body: draftRef.current }
            : { reason: draftRef.current }),
      };
      const command = await prepare(
        actorId,
        scope,
        action,
        target,
        body,
        current.current,
      );
      saved = true;
      if (!live() || ctl.signal.aborted) return;
      sync();
      await api.execute(
        command.pending,
        command.body,
        AbortSignal.any([ctl.signal, AbortSignal.timeout(15000)]),
      );
      if (!live()) return;
      sync();
      invalidate();
      setMessage("Server đã ghi nhận và xác minh đánh giá.");
      setReady(false);
      await fetchState(
        AbortSignal.any([ctl.signal, AbortSignal.timeout(15000)]),
        target,
      );
    } catch (e) {
      if (live() && turn === generation.current) {
        sync();
        setError(
          e instanceof Error ? e.message : "Chưa xác minh được kết quả.",
        );
        if (saved) setReady(false);
        if (e instanceof ApiError && [401, 403].includes(e.status ?? 0)) {
          setRows([]);
          setView(null);
          setSelected(null);
          current.current = null;
          setDraft("");
          draftRef.current = "";
          setReady(false);
        }
      }
    } finally {
      if (live() && turn === generation.current) {
        latch.current = false;
        setBusy(false);
      }
    }
  }
  async function recover() {
    if (
      latch.current ||
      !pending ||
      pending.value.scope !== scope ||
      !recoveryConsent.current ||
      !live()
    )
      return;
    latch.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const target = pending.value.orderItemId,
      turn = ++generation.current,
      ctl = new AbortController();
    controller.current = ctl;
    try {
      const outcome = await api.reconcile(
        pending,
        AbortSignal.any([ctl.signal, AbortSignal.timeout(15000)]),
        true,
      );
      if (!live()) return;
      sync();
      recoveryConsent.current = false;
      setConsent(false);
      invalidate();
      setMessage(
        outcome === "APPLIED"
          ? "Server đã xử lý yêu cầu trước đó; không gửi lại."
          : "Mã cũ đã đóng an toàn; không thực hiện đánh giá thay bạn.",
      );
      setReady(false);
      item.current = target;
      await fetchState(
        AbortSignal.any([ctl.signal, AbortSignal.timeout(15000)]),
        target,
      );
    } catch (e) {
      if (live() && turn === generation.current) {
        sync();
        setReady(false);
        setError(
          e instanceof Error ? e.message : "Chưa đối chiếu được yêu cầu.",
        );
        if (e instanceof ApiError && [401, 403].includes(e.status ?? 0)) {
          setRows([]);
          setView(null);
          setSelected(null);
          current.current = null;
          setDraft("");
          draftRef.current = "";
        }
      }
    } finally {
      if (live() && turn === generation.current) {
        latch.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section
      className={styles.page}
      aria-label={labels[scope]}
      aria-busy={busy}
    >
      <header>
        <p className={styles.eyebrow}>ĐÁNH GIÁ SAU GIAO DỊCH</p>
        <h1>{labels[scope]}</h1>
        <p>
          Đánh giá dựa trên mặt hàng trong đơn đã hoàn tất. Hoàn tiền không tự
          xóa nhận xét.
        </p>
      </header>
      <div className={styles.toolbar}>
        <button disabled={busy} onClick={() => void load()}>
          Tải lại đánh giá
        </button>
        {scope === "BUYER" && <Link to="/account/orders">Về đơn mua</Link>}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message} Nếu dữ liệu chưa tải được, chỉ tải lại; không gửi lại thao
          tác.
        </p>
      )}
      {journalError && (
        <p role="alert" className={styles.error}>
          {journalError}
        </p>
      )}
      {pending && (
        <aside
          className={styles.pending}
          aria-label="Yêu cầu đánh giá chờ đối chiếu"
        >
          <h2>Còn một yêu cầu cần đối chiếu</h2>
          <p>
            Mặt hàng #{pending.value.orderItemId} · {pending.value.action}.
            Không gửi lại khi chưa rõ kết quả.
          </p>
          {pending.value.scope !== scope ? (
            <Link to={path(pending.value.scope, pending.value.orderItemId)}>
              Về đúng màn hình để đối chiếu
            </Link>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => {
                    if (latch.current) return;
                    recoveryConsent.current = e.target.checked;
                    setConsent(e.target.checked);
                  }}
                />{" "}
                Tôi đồng ý kiểm tra kết quả hoặc đóng mã chưa được xử lý, không
                tự gửi lại nội dung.
              </label>
              <button
                disabled={busy || !consent}
                onClick={() => void recover()}
              >
                Đối chiếu yêu cầu cũ
              </button>
            </>
          )}
        </aside>
      )}
      {!enabled && (
        <p className={styles.notice}>
          Chưa bật thao tác đánh giá trên Web. Mã đang chờ vẫn có thể được đối
          chiếu khi Backend sẵn sàng.
        </p>
      )}
      {scope === "BUYER" && !initialItem && !pending && (
        <p>Chọn một mặt hàng từ chi tiết đơn đã hoàn tất để đánh giá.</p>
      )}
      <div className={scope === "BUYER" ? styles.single : styles.columns}>
        {scope !== "BUYER" && (
          <aside className={styles.panel}>
            <h2>
              {scope === "ADMIN"
                ? "Danh sách kiểm duyệt"
                : "Đánh giá của cửa hàng"}
            </h2>
            {ready && !rows.length && <p>Chưa có đánh giá.</p>}
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    disabled={busy || !!pending || !!journalError || !ready}
                    onClick={() => void select(row)}
                    aria-pressed={selected?.id === row.id}
                  >
                    {row.productName}
                    <span>
                      {row.rating}/5 · {row.hidden ? "Đã ẩn" : "Hiển thị"} · v
                      {row.revision}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {next && (
              <button
                disabled={busy || !!pending || !ready}
                onClick={() => void load(null, next)}
              >
                Tải thêm đánh giá
              </button>
            )}
          </aside>
        )}
        {ready && (scope === "BUYER" ? !!view : !!selected) && (
          <article className={styles.panel}>
            <h2>
              {view?.productName ??
                rows.find((x) => x.id === selected?.id)?.productName ??
                "Mặt hàng đã mua"}
            </h2>
            {selected ? (
              <>
                <p className={styles.score}>
                  {selected.rating}/5 · phiên bản {selected.revision}
                </p>
                <p className={styles.body}>{selected.body}</p>
                <p>
                  {selected.hidden
                    ? "Đánh giá đã bị ẩn khỏi danh sách công khai."
                    : "Đánh giá đang hiển thị."}{" "}
                  {selected.isRefunded ? "Giao dịch đã có hoàn tiền." : ""}
                </p>
                {selected.reply && (
                  <blockquote>
                    <strong>Phản hồi từ cửa hàng</strong>
                    <p className={styles.body}>{selected.reply.body}</p>
                    <time>{date(selected.reply.createdAt)}</time>
                  </blockquote>
                )}
              </>
            ) : (
              <p>Bạn chưa đánh giá mặt hàng này.</p>
            )}
            {view?.deadline && (
              <p>
                Hạn tạo/sửa: <time>{date(view.deadline)}</time>
              </p>
            )}
            {permitted ? (
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void write();
                }}
              >
                {scope === "BUYER" && (
                  <label>
                    Điểm đánh giá
                    <select
                      aria-label="Điểm đánh giá"
                      value={score}
                      disabled={locked}
                      onChange={(e) => {
                        if (latch.current) return;
                        invalidate();
                        scoreRef.current = Number(e.target.value);
                        setScore(scoreRef.current);
                      }}
                    >
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} sao
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {scope === "BUYER"
                    ? "Nhận xét của bạn"
                    : scope === "SELLER"
                      ? "Phản hồi của cửa hàng"
                      : "Lý do ẩn (chỉ Admin)"}
                  <textarea
                    aria-label={
                      scope === "BUYER"
                        ? "Nhận xét của bạn"
                        : scope === "SELLER"
                          ? "Phản hồi của cửa hàng"
                          : "Lý do ẩn (chỉ Admin)"
                    }
                    value={draft}
                    disabled={locked}
                    rows={5}
                    onChange={(e) => {
                      if (latch.current) return;
                      invalidate();
                      draftRef.current = e.target.value;
                      setDraft(e.target.value);
                    }}
                  />
                </label>
                <p>
                  Không đưa số điện thoại, địa chỉ hoặc thông tin thanh toán vào
                  nội dung công khai.
                </p>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={locked}
                    onChange={(e) => {
                      if (latch.current) return;
                      confirmedVersion.current = e.target.checked
                        ? version.current
                        : null;
                      setConfirmed(e.target.checked);
                    }}
                  />{" "}
                  Tôi xác nhận nội dung và thao tác đang chọn.
                </label>
                <button type="submit" disabled={locked || !confirmed}>
                  {scope === "BUYER"
                    ? selected
                      ? "Lưu chỉnh sửa đánh giá"
                      : "Gửi đánh giá"
                    : scope === "SELLER"
                      ? "Gửi phản hồi"
                      : "Ẩn đánh giá"}
                </button>
              </form>
            ) : (
              <p>
                {scope === "BUYER"
                  ? "Mặt hàng này chưa đủ điều kiện hoặc đã hết hạn tạo/sửa đánh giá."
                  : scope === "SELLER"
                    ? "Cửa hàng đã có phản hồi cho đánh giá này."
                    : "Đánh giá này đã được ẩn."}
              </p>
            )}
            {view?.history.length ? (
              <section>
                <h3>Lịch sử đánh giá</h3>
                <ol>
                  {view.history.map((h) => (
                    <li key={h.revision}>
                      <strong>
                        v{h.revision} · {h.action}
                      </strong>
                      <p>
                        {h.rating}/5 · {h.hidden ? "Đã ẩn" : "Hiển thị"}
                      </p>
                      {h.reason && <p>{h.reason}</p>}
                      <time>{date(h.createdAt)}</time>
                    </li>
                  ))}
                </ol>
                {view.historyTruncated && (
                  <p>Chỉ hiển thị 50 thay đổi gần nhất.</p>
                )}
              </section>
            ) : null}
          </article>
        )}
      </div>
    </section>
  );
}
