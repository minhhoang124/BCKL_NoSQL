import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { hasBuyerAccess } from "../../utils/buyerAccess";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import { orderApi } from "../../services/orderApi";
import type { OrderDetail } from "../../types/order";
import {
  aftersaleApi,
  type AftersaleApi,
  type Detail,
  type Summary,
  type Resolution,
} from "./aftersaleApi";
import {
  actions,
  loadPending,
  money,
  nextState,
  positive,
  prepareIntent,
  type Action,
  type Kind,
  type Pending,
  type Scope,
} from "./aftersaleIntent";
import styles from "./AftersalesPage.module.css";
const labels: Record<string, string> = {
  PENDING: "Chờ người bán xử lý",
  REJECTED: "Người bán từ chối",
  CANCELLED: "Đã rút yêu cầu",
  DISPUTED: "Chờ Admin giải quyết bất đồng",
  AWAITING_RETURN: "Chờ nhận lại hàng",
  REFUNDED: "Đã ghi nhận hoàn tiền mô phỏng",
  ADMIN_REJECTED: "Admin từ chối bất đồng",
  REFUND_ONLY: "Chỉ hoàn tiền",
  RETURN_AND_REFUND: "Trả hàng và hoàn tiền",
  create: "Gửi yêu cầu",
  cancel: "Rút yêu cầu",
  dispute: "Nhờ Admin giải quyết",
  approve: "Chấp thuận",
  reject: "Từ chối",
  receive: "Xác nhận đã nhận lại hàng",
};
const reasonLabels: Record<string, string> = {
  DAMAGED: "Hàng bị hỏng",
  WRONG_ITEM: "Giao sai hàng",
  NOT_AS_DESCRIBED: "Không đúng mô tả",
  OTHER: "Lý do khác",
};
const time = (v: string) =>
  new Date(v).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const amount = (v: string) =>
  BigInt(money(v).split(".")[0]!).toLocaleString("vi-VN") + " ₫";
const path = (scope: Scope) =>
  scope === "BUYER"
    ? "/account/aftersales"
    : scope === "SELLER"
      ? "/seller/aftersales"
      : "/admin/returns";
function message(failure: unknown) {
  if (failure instanceof ApiError) {
    if ([401, 403].includes(failure.status ?? 0))
      return "Phiên hoặc quyền xử lý đã thay đổi. Vui lòng đăng nhập lại; mã yêu cầu cũ được giữ nguyên.";
    if (failure.status === 404)
      return "Không tìm thấy dữ liệu trong quyền của tài khoản này.";
    if (failure.status === 422)
      return "Số tiền của đơn cần quản trị viên đối chiếu trước khi xử lý hậu mãi.";
    if (failure.status === 409)
      return "Trạng thái, phiên bản hoặc quyền giữ hạn mức đã thay đổi. Nếu có mã chờ, đối chiếu mã đó trước rồi tải lại.";
    return "Chưa khép được yêu cầu. Giữ mã cũ và đối chiếu; không tự gửi lại.";
  }
  return failure instanceof Error && !(failure instanceof TypeError)
    ? failure.message
    : "Không kết nối được hệ thống. Mã chờ được giữ lại để đối chiếu.";
}
export function AftersalesPage({
  scope,
  api,
}: {
  scope: Scope;
  api?: AftersaleApi;
}) {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const actorId = user?.id;
  const source = useMemo(
    () => (actorId ? (api ?? aftersaleApi(actorId, scope)) : null),
    [api, scope, actorId],
  );
  if (loading) return <p role="status">Đang kiểm tra phiên đăng nhập…</p>;
  if (
    !user?.isActive ||
    (scope === "BUYER" ? !hasBuyerAccess(user) : user.role !== scope)
  )
    return (
      <p role="alert">Tài khoản hiện tại không có quyền xem hậu mãi này.</p>
    );
  let orderId: number | undefined, itemId: number | undefined;
  try {
    for (const [key, value] of params) {
      if (
        scope !== "BUYER" ||
        !["orderId", "itemId"].includes(key) ||
        params.getAll(key).length !== 1 ||
        !/^[1-9][0-9]*$/.test(value)
      )
        throw Error("invalid");
      if (key === "orderId") orderId = positive(Number(value));
      else itemId = positive(Number(value));
    }
    if (itemId && !orderId) throw Error("invalid");
  } catch {
    return <p role="alert">Liên kết hậu mãi không hợp lệ.</p>;
  }
  return (
    <Workspace
      key={`${user.id}:${scope}:${getAuthSessionVersion()}:${params.toString()}`}
      actorId={user.id}
      scope={scope}
      api={source!}
      orderId={orderId}
      itemId={itemId}
      enabled={import.meta.env.VITE_AFTERSALES_ENABLED !== "false"}
    />
  );
}
function Workspace({
  actorId,
  scope,
  api,
  orderId,
  itemId,
  enabled,
}: {
  actorId: number;
  scope: Scope;
  api: AftersaleApi;
  orderId?: number;
  itemId?: number;
  enabled: boolean;
}) {
  const [boot] = useState(() => {
    try {
      return { pending: loadPending(actorId), error: "" };
    } catch (e) {
      return { pending: null, error: message(e) };
    }
  });
  const [pending, setPending] = useState<Pending | null>(boot.pending),
    [storageError, setStorageError] = useState(boot.error);
  const [rows, setRows] = useState<Summary[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [listBusy, setListBusy] = useState(false),
    [listError, setListError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null),
    [selectedId, setSelectedId] = useState<number | null>(null),
    [detailBusy, setDetailBusy] = useState(false),
    [detailError, setDetailError] = useState("");
  const [order, setOrder] = useState<OrderDetail | null>(null),
    [orderError, setOrderError] = useState("");
  const [chosenItem, setChosenItem] = useState(itemId ? String(itemId) : ""),
    [kind, setKind] = useState<Kind>("REFUND_ONLY"),
    [reasonCode, setReasonCode] = useState("DAMAGED"),
    [description, setDescription] = useState("");
  const [decision, setDecision] = useState<Action | null>(null),
    [reason, setReason] = useState(""),
    [restock, setRestock] = useState(""),
    [confirmedAction, setConfirm] = useState<Action | null>(null),
    [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [blocked, setBlocked] = useState(false);
  const epoch = useRef(getAuthSessionVersion()),
    mounted = useRef(true),
    latch = useRef(false),
    denied = useRef(false);
  const listFlight = useRef<AbortController | null>(null),
    detailFlight = useRef<AbortController | null>(null),
    orderFlight = useRef<AbortController | null>(null),
    writeFlight = useRef<AbortController | null>(null);
  const active = (c?: AbortController) =>
    mounted.current &&
    epoch.current === getAuthSessionVersion() &&
    !c?.signal.aborted;
  const timeout = (c: AbortController) =>
    AbortSignal.any([c.signal, AbortSignal.timeout(15000)]);
  function deny(e: unknown) {
    if (e instanceof ApiError && [401, 403].includes(e.status ?? 0)) {
      denied.current = true;
      listFlight.current?.abort();
      detailFlight.current?.abort();
      orderFlight.current?.abort();
      setListBusy(false);
      setDetailBusy(false);
      setBlocked(true);
      setRows([]);
      setDetail(null);
      setOrder(null);
    }
  }
  async function readList(before?: number) {
    if (!active() || denied.current) return;
    listFlight.current?.abort();
    const c = new AbortController();
    listFlight.current = c;
    setListBusy(true);
    setListError("");
    if (!before) {
      setRows([]);
      setCursor(null);
    }
    try {
      const page = await api.list(timeout(c), before);
      if (active(c)) {
        setRows((old) => (before ? [...old, ...page.items] : page.items));
        setCursor(page.nextBeforeId);
      }
    } catch (e) {
      if (active(c)) {
        setListError(message(e));
        deny(e);
      }
    } finally {
      if (listFlight.current === c) {
        listFlight.current = null;
        if (active()) setListBusy(false);
      }
    }
  }
  async function readDetail(id: number, before?: number) {
    if (!active() || denied.current) return;
    detailFlight.current?.abort();
    const c = new AbortController();
    detailFlight.current = c;
    setSelectedId(id);
    setDetailBusy(true);
    setDetailError("");
    setDecision(null);
    setConfirm(null);
    if (!before) {
      setDetail(null);
      setDecision(null);
      setReason("");
      setRestock("");
      setConfirm(null);
    }
    try {
      const page = await api.detail(id, timeout(c), before);
      if (
        active(c) &&
        before &&
        detail &&
        page.request.revision !== detail.request.revision
      ) {
        setDetail(null);
        setDetailError(
          "Yêu cầu đã thay đổi trong lúc đọc lịch sử. Tải lại chi tiết trước khi quyết định.",
        );
        return;
      }
      if (active(c))
        setDetail((old) =>
          before && old && old.request.id === id
            ? { ...page, history: [...old.history, ...page.history] }
            : page,
        );
    } catch (e) {
      if (active(c)) {
        setDetail(null);
        setDetailError(message(e));
        deny(e);
      }
    } finally {
      if (detailFlight.current === c) {
        detailFlight.current = null;
        if (active()) setDetailBusy(false);
      }
    }
  }
  async function readOrder() {
    if (!orderId || scope !== "BUYER" || !active() || denied.current) return;
    orderFlight.current?.abort();
    const c = new AbortController();
    orderFlight.current = c;
    setOrder(null);
    setOrderError("");
    try {
      const result = await orderApi.detail("buyer", orderId, timeout(c));
      if (active(c)) {
        if (itemId && !result.items.some((i) => i.id === itemId))
          throw Error("Mặt hàng không thuộc đơn đã chọn.");
        setOrder(result);
        setChosenItem(String(itemId ?? result.items[0]?.id ?? ""));
      }
    } catch (e) {
      if (active(c)) {
        setOrderError(message(e));
        deny(e);
      }
    } finally {
      if (orderFlight.current === c) orderFlight.current = null;
    }
  }
  function syncPending() {
    try {
      const p = loadPending(actorId);
      setPending(p);
      return p;
    } catch (e) {
      setStorageError(message(e));
      throw e;
    }
  }
  async function finish(result: Resolution) {
    syncPending();
    setConsent(false);
    setDecision(null);
    setReason("");
    setDescription("");
    setConfirm(null);
    setNotice(
      result.outcome === "CLOSED"
        ? "Server đã đóng mã chưa thực hiện. Chưa hủy, duyệt, hoàn tiền hoặc hoàn kho; hãy tải lại trước khi tạo ý định mới."
        : `Đã ghi nhận thao tác cho yêu cầu #${result.receipt!.request.id}. Biên nhận được xác minh; chỉ tải lại dữ liệu, không gửi lại thao tác.`,
    );
    setDetail(null);
    await Promise.all([
      readList(),
      ...(result.receipt
        ? [readDetail(result.receipt.request.id)]
        : selectedId
          ? [readDetail(selectedId)]
          : []),
      ...(orderId ? [readOrder()] : []),
    ]);
  }
  async function mutate(action: Action) {
    if (
      latch.current ||
      !enabled ||
      denied.current ||
      storageError ||
      !active() ||
      confirmedAction !== action
    )
      return;
    latch.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const c = new AbortController();
    writeFlight.current = c;
    try {
      if (syncPending())
        throw Error("Còn mã yêu cầu cần đối chiếu trước khi thao tác mới.");
      const item = order?.items.find((i) => String(i.id) === chosenItem);
      if (
        action === "create" &&
        (!item ||
          !order ||
          !["DELIVERED", "COMPLETED"].includes(order.status) ||
          order.payment?.status !== "PAID")
      )
        throw Error("Chọn mặt hàng từ đơn đã giao và thanh toán hợp lệ.");
      if (
        action !== "create" &&
        (!detail || detailBusy || selectedId !== detail.request.id)
      )
        throw Error("Tải lại chi tiết yêu cầu trước khi xử lý.");
      if (action === "receive" && !["yes", "no"].includes(restock))
        throw Error("Chọn rõ hàng nhận lại có được nhập kho hay không.");
      const prepared = await prepareIntent(
        actorId,
        scope,
        action,
        action === "create" ? item!.id : detail!.request.id,
        action === "create"
          ? { kind, reasonCode, description }
          : {
              expectedRevision: detail!.request.revision,
              reason,
              ...(action === "receive"
                ? { restockable: restock === "yes" }
                : {}),
            },
        action === "create" ? undefined : detail!.request,
        detail?.context.lineTotal,
      );
      if (!active(c)) return;
      setPending(prepared);
      setDescription("");
      setReason("");
      setConfirm(null);
      const result = await api.execute(prepared, prepared.body, timeout(c));
      if (active(c)) await finish(result);
    } catch (e) {
      if (active()) {
        setError(message(e));
        deny(e);
        try {
          syncPending();
        } catch {
          /* The storage error separately blocks writes. */
        }
      }
    } finally {
      latch.current = false;
      if (writeFlight.current === c) writeFlight.current = null;
      if (active()) setBusy(false);
    }
  }
  async function reconcile() {
    if (
      latch.current ||
      denied.current ||
      storageError ||
      !consent ||
      !active()
    )
      return;
    latch.current = true;
    setBusy(true);
    setError("");
    const c = new AbortController();
    writeFlight.current = c;
    try {
      const p = syncPending();
      if (!p || p.value.scope !== scope)
        throw Error("Mở đúng phía hậu mãi của mã đang chờ.");
      const result = await api.reconcile(p, timeout(c), consent);
      if (active(c)) await finish(result);
    } catch (e) {
      if (active()) {
        setError(message(e));
        deny(e);
      }
    } finally {
      latch.current = false;
      if (writeFlight.current === c) writeFlight.current = null;
      if (active()) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void readList();
    void readOrder();
    /* oxlint-disable react-hooks/exhaustive-deps */
    return () => {
      mounted.current = false;
      listFlight.current?.abort();
      detailFlight.current?.abort();
      orderFlight.current?.abort();
      writeFlight.current?.abort();
    };
    /* oxlint-enable react-hooks/exhaustive-deps */
    // All identity/query changes remount Workspace; callbacks use the same epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const locked =
    !enabled || busy || blocked || Boolean(pending) || Boolean(storageError);
  const allowed =
    detail && !detailBusy
      ? actions.filter((action) => {
          if (action === "create") return false;
          try {
            nextState(scope, action, detail.request);
            return true;
          } catch {
            return false;
          }
        })
      : [];
  return (
    <section className={styles.page} aria-label="Hậu mãi">
      <header>
        <h1>Hỗ trợ sau mua hàng</h1>
        <p>
          Yêu cầu hoàn tiền hoặc trả hàng; người bán xử lý và Admin giải quyết
          bất đồng.
        </p>
        <nav>
          <Link
            to={
              scope === "ADMIN"
                ? "/admin"
                : scope === "SELLER"
                  ? "/seller"
                  : "/account/orders"
            }
          >
            Về{" "}
            {scope === "ADMIN"
              ? "quản trị"
              : scope === "SELLER"
                ? "kênh người bán"
                : "đơn mua"}
          </Link>
        </nav>
      </header>
      <p className={styles.notice}>
        Hoàn tiền trong bản hiện tại là mô phỏng, không chuyển tiền qua ngân
        hàng/ví. Không nhập kho khi chỉ hoàn tiền; hàng trả lại chỉ được cộng
        kho sau khi xác nhận đã nhận và đủ điều kiện.
      </p>
      {!enabled && (
        <p role="status">
          Tạm ngừng tạo hoặc xử lý yêu cầu mới. Bạn vẫn có thể đọc lịch sử và
          đối chiếu mã đang chờ.
        </p>
      )}
      {storageError && (
        <p role="alert" className={styles.error}>
          {storageError}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.success}>
          {notice}
        </p>
      )}
      {pending && (
        <section
          className={styles.panel}
          aria-label="Khôi phục yêu cầu hậu mãi"
        >
          <h2>Còn yêu cầu chờ đối chiếu</h2>
          <p>
            Thao tác: {labels[pending.value.action]} · mã{" "}
            {pending.value.commandId} · đối tượng #{pending.value.targetId}.
            Không tạo mã mới khi chưa khép kết quả.
          </p>
          {pending.value.scope !== scope ? (
            <Link to={path(pending.value.scope)}>
              Mở đúng phía hậu mãi để đối chiếu
            </Link>
          ) : (
            <>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy || blocked}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Tôi đồng ý đối chiếu: nhận biên nhận nếu đã thực hiện, hoặc đóng
                mã chưa thực hiện; không tự gửi lại thao tác.
              </label>
              <button
                disabled={!consent || busy || blocked || Boolean(storageError)}
                onClick={() => void reconcile()}
              >
                Đối chiếu mã cũ
              </button>
            </>
          )}
        </section>
      )}
      {scope === "BUYER" && orderId && (
        <section className={styles.panel} aria-label="Tạo yêu cầu hậu mãi">
          <h2>Gửi yêu cầu cho đơn #{orderId}</h2>
          {orderError && <p role="alert">{orderError}</p>}
          <button disabled={busy || blocked} onClick={() => void readOrder()}>
            Tải lại đơn
          </button>
          {order && (
            <>
              <p>
                {order.orderNumber} · {order.store.name}
              </p>
              {["DELIVERED", "COMPLETED"].includes(order.status) &&
              order.payment?.status === "PAID" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate("create");
                  }}
                >
                  <label>
                    Mặt hàng
                    <select
                      disabled={locked}
                      value={chosenItem}
                      onChange={(e) => {
                        setChosenItem(e.target.value);
                        setConfirm(null);
                      }}
                    >
                      {order.items.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.productName} · {item.quantity} món
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Phương án
                    <select
                      disabled={locked}
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value as Kind);
                        setConfirm(null);
                      }}
                    >
                      <option value="REFUND_ONLY">Chỉ hoàn tiền</option>
                      <option value="RETURN_AND_REFUND">
                        Trả hàng và hoàn tiền
                      </option>
                    </select>
                  </label>
                  <label>
                    Lý do
                    <select
                      disabled={locked}
                      value={reasonCode}
                      onChange={(e) => {
                        setReasonCode(e.target.value);
                        setConfirm(null);
                      }}
                    >
                      {Object.entries(reasonLabels).map(([key, title]) => (
                        <option key={key} value={key}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Mô tả
                    <textarea
                      required
                      minLength={10}
                      maxLength={2000}
                      disabled={locked}
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        setConfirm(null);
                      }}
                    />
                  </label>
                  <p>
                    Hệ thống kiểm thời hạn và tiền theo đơn đã lưu; không nhập
                    số tiền hoàn từ trình duyệt.
                  </p>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={confirmedAction === "create"}
                      disabled={locked}
                      onChange={(e) =>
                        setConfirm(e.target.checked ? "create" : null)
                      }
                    />
                    Tôi xác nhận gửi yêu cầu cho mặt hàng đã chọn.
                  </label>
                  <button disabled={locked || confirmedAction !== "create"}>
                    Gửi yêu cầu
                  </button>
                </form>
              ) : (
                <p>
                  Chỉ tiếp nhận yêu cầu cho đơn đã giao hoặc hoàn tất và đã
                  thanh toán hợp lệ.
                </p>
              )}
            </>
          )}
        </section>
      )}
      <div className={styles.columns}>
        <section
          className={styles.panel}
          aria-label="Danh sách yêu cầu hậu mãi"
        >
          <h2>Yêu cầu trong quyền của bạn</h2>
          <button
            disabled={busy || blocked || listBusy}
            onClick={() => void readList()}
          >
            Tải lại danh sách
          </button>
          {listBusy && <p role="status">Đang tải yêu cầu…</p>}
          {listError && <p role="alert">{listError}</p>}
          {!listBusy && !listError && rows.length === 0 && (
            <p>Chưa có yêu cầu hậu mãi.</p>
          )}
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <b>
                  Yêu cầu #{row.id} · {row.context.productName}
                </b>
                <p>
                  Đơn #{row.context.orderId} · {row.context.storeName} ·{" "}
                  {amount(row.context.lineTotal)}
                </p>
                <p>
                  {labels[row.state]} · {labels[row.kind]}
                </p>
                <button
                  disabled={busy || blocked}
                  onClick={() => void readDetail(row.id)}
                >
                  Xem yêu cầu #{row.id}
                </button>
              </li>
            ))}
          </ul>
          {cursor !== null && (
            <button
              disabled={listBusy || busy || blocked}
              onClick={() => void readList(cursor)}
            >
              Xem thêm yêu cầu
            </button>
          )}
        </section>
        <section className={styles.panel} aria-label="Chi tiết hậu mãi">
          <h2>Chi tiết và lịch sử</h2>
          {selectedId && (
            <button
              disabled={busy || blocked || detailBusy}
              onClick={() => void readDetail(selectedId)}
            >
              Tải lại chi tiết
            </button>
          )}
          {detailBusy && <p role="status">Đang đọc chi tiết…</p>}
          {detailError && <p role="alert">{detailError}</p>}
          {detail && (
            <>
              <h3>
                Yêu cầu #{detail.request.id} · {detail.context.productName}
              </h3>
              <p>
                Đơn #{detail.context.orderId} · {detail.context.quantity} món ·{" "}
                {amount(detail.context.lineTotal)}
              </p>
              <p>
                {labels[detail.request.state]} · phiên bản{" "}
                {detail.request.revision}
              </p>
              <p>
                {reasonLabels[detail.request.reasonCode] ??
                  detail.request.reasonCode}
                : {detail.request.description}
              </p>
              <p>Hạn tiếp nhận áp dụng: {time(detail.request.deadlineAt)}</p>
              {detail.refund && (
                <p className={styles.success}>
                  Biên nhận hoàn tiền mô phỏng #{detail.refund.id}:{" "}
                  {amount(detail.refund.amount)} ·{" "}
                  {time(detail.refund.succeededAt)}. Chưa phải chuyển tiền thật.
                </p>
              )}
              <div className={styles.actions}>
                {allowed.map((action) => (
                  <button
                    disabled={locked}
                    key={action}
                    onClick={() => {
                      setDecision(action);
                      setReason("");
                      setRestock("");
                      setConfirm(null);
                    }}
                  >
                    {labels[action]}
                  </button>
                ))}
              </div>
              {decision && allowed.includes(decision) && (
                <form
                  className={styles.confirmation}
                  aria-label="Xác nhận xử lý hậu mãi"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate(decision);
                  }}
                >
                  <h3>{labels[decision]}</h3>
                  <label>
                    Lý do quyết định
                    <textarea
                      required
                      minLength={10}
                      maxLength={2000}
                      disabled={locked}
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setConfirm(null);
                      }}
                    />
                  </label>
                  {decision === "receive" && (
                    <label>
                      Khả năng nhập lại kho
                      <select
                        required
                        disabled={locked}
                        value={restock}
                        onChange={(e) => {
                          setRestock(e.target.value);
                          setConfirm(null);
                        }}
                      >
                        <option value="">
                          Chọn sau khi kiểm hàng nhận lại
                        </option>
                        <option value="yes">
                          Đã nhận, hàng đủ điều kiện nhập kho
                        </option>
                        <option value="no">
                          Đã nhận, hàng không đủ điều kiện nhập kho
                        </option>
                      </select>
                    </label>
                  )}
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={confirmedAction === decision}
                      disabled={locked}
                      onChange={(e) =>
                        setConfirm(e.target.checked ? decision : null)
                      }
                    />
                    Tôi xác nhận quyết định này theo yêu cầu và hàng thực tế đã
                    kiểm tra.
                  </label>
                  <button disabled={locked || confirmedAction !== decision}>
                    Xác nhận {labels[decision].toLowerCase()}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDecision(null)}
                  >
                    Bỏ xác nhận
                  </button>
                </form>
              )}
              <h3>Lịch sử xử lý</h3>
              <ol>
                {detail.history.map((h) => (
                  <li key={h.id}>
                    <b>{labels[h.toState]}</b> · người thực hiện #{h.actorId} ·{" "}
                    {time(h.createdAt)}
                    <p>{h.reason}</p>
                  </li>
                ))}
              </ol>
              {detail.nextBeforeRevision !== null && (
                <button
                  disabled={detailBusy || busy || blocked}
                  onClick={() =>
                    void readDetail(
                      detail.request.id,
                      detail.nextBeforeRevision!,
                    )
                  }
                >
                  Xem lịch sử trước
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
