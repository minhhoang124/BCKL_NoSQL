import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { getAuthSessionVersion } from "../../services/apiClient";
import {
  adminFulfilmentApi,
  allowed,
  definiteRejection,
  intentHash,
  readPending,
  snapshot,
  storageKey,
  validId,
  type Command,
  type Pending,
  type Snapshot,
} from "./fulfilmentClient";
import { orderStatusLabels } from "../order-readiness/orderPolicy";
import styles from "./AdminFulfilment.module.css";
const labels: Record<Command, string> = {
  ship: "Bàn giao vận chuyển",
  "delivery-failed": "Ghi nhận giao thất bại",
  "retry-delivery": "Giao lại",
  "mark-delivered": "Ghi nhận đã giao",
  "confirm-returned": "Nhận hàng hoàn",
};
export function AdminFulfilment() {
  const { user } = useAuth();
  if (!user?.isActive || user.role !== "ADMIN")
    return <p role="alert">Cần tài khoản Admin đang hoạt động.</p>;
  return (
    <Workspace
      key={`${user.id}:${getAuthSessionVersion()}`}
      actorId={user.id}
    />
  );
}
function Workspace({ actorId }: { actorId: number }) {
  const [initial] = useState(() => {
    try {
      return { pending: readPending(actorId), error: "" };
    } catch {
      return {
        pending: null,
        error:
          "Không đọc được yêu cầu đang chờ. Dừng thao tác và kiểm tra bộ nhớ phiên.",
      };
    }
  });
  const [pending, setPending] = useState<Pending | null>(initial.pending),
    [error, setError] = useState(initial.error),
    [note, setNote] = useState("");
  const [queue, setQueue] = useState<Snapshot[]>([]),
    [order, setOrder] = useState<Snapshot | null>(null),
    [id, setId] = useState(String(initial.pending?.orderId ?? ""));
  const [command, setCommand] = useState<Command>(
      initial.pending?.command ?? "ship",
    ),
    [tracking, setTracking] = useState(""),
    [attempt, setAttempt] = useState("1");
  const [reason, setReason] = useState(""),
    [reasonCode, setReasonCode] = useState("CUSTOMER_UNREACHABLE"),
    [disposition, setDisposition] = useState("RETURN_RECEIVED"),
    [receipt, setReceipt] = useState("");
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    generation = useRef(0),
    mounted = useRef(true),
    epoch = useRef(getAuthSessionVersion());
  const live = () =>
    mounted.current && epoch.current === getAuthSessionVersion();
  const blocked = !!initial.error;
  async function load(orderId: number) {
    if (lock.current) return;
    const version = ++generation.current;
    setOrder(null);
    setError(initial.error);
    try {
      const r = await adminFulfilmentApi.detail(orderId);
      if (!live() || version !== generation.current) return;
      if (r.id !== orderId) throw Error("Phản hồi không đúng đơn.");
      setOrder(snapshot(r));
      setId(String(orderId));
      if (!pending) {
        setReason("");
        setReceipt("");
        setDisposition("RETURN_RECEIVED");
        setReasonCode("CUSTOMER_UNREACHABLE");
        setNote("");
        setCommand(allowed(r)[0] ?? "ship");
        setTracking(r.currentAttempt?.trackingReference ?? "");
        setAttempt(String(r.currentDeliveryAttempt ?? 1));
        setConsent(false);
      }
    } catch {
      if (live() && version === generation.current)
        setError("Không tải được đơn. Kiểm tra quyền, mã đơn và thử tải lại.");
    }
  }
  useEffect(() => {
    mounted.current = true;
    void adminFulfilmentApi
      .list()
      .then((r) => {
        if (live()) setQueue(r);
      })
      .catch(() => {
        if (live() && !initial.error)
          setError("Không tải được danh sách. Có thể tra cứu bằng mã đơn.");
      });
    if (initial.pending) void load(initial.pending.orderId);
    return () => {
      mounted.current = false;
      ++generation.current;
    };
  }, []); // mount is fenced by actor/session key
  async function send() {
    if (lock.current || !consent || blocked || !order || !live()) return;
    lock.current = true;
    ++generation.current;
    setBusy(true);
    setError("");
    setNote("");
    const wasPending = !!pending;
    try {
      const orderId = order.id;
      const clean = tracking.trim(),
        text = reason.trim();
      let body: Record<string, unknown>;
      if (command === "confirm-returned") {
        if (
          !text ||
          text.length > 500 ||
          (disposition !== "LOST" && !receipt.trim())
        )
          throw Error("Nhập lý do và biên nhận hợp lệ.");
        body = {
          reasonCode: disposition,
          reasonText: text,
          restockable: disposition === "RETURN_RECEIVED",
          receiptReference: disposition === "LOST" ? null : receipt.trim(),
        };
      } else {
        if (!clean || clean.length > 100 || /[\u0000-\u001f\u007f]/.test(clean))
          throw Error("Nhập mã vận đơn hợp lệ.");
        body = { trackingReference: clean };
        if (command === "mark-delivered" || command === "delivery-failed") {
          const number = Number(attempt);
          if (!Number.isInteger(number) || number < 1 || number > 4)
            throw Error("Lần giao phải từ 1 đến 4.");
          body.deliveryAttempt = number;
        }
        if (command === "delivery-failed") {
          if (!text || text.length > 500)
            throw Error("Nhập lý do giao thất bại.");
          body.reasonCode = reasonCode;
          body.reasonText = text;
        }
      }
      if (!pending && !allowed(order).includes(command))
        throw Error("Trạng thái đơn không cho phép thao tác.");
      const hash = await intentHash(actorId, orderId, command, body);
      if (!live()) return;
      if (
        pending &&
        (pending.hash !== hash ||
          pending.orderId !== orderId ||
          pending.command !== command)
      )
        throw Error(
          "Nội dung khác yêu cầu đang chờ. Nhập lại đúng nội dung cũ để đối chiếu bằng cùng mã.",
        );
      const intent = pending ?? {
        actorId,
        orderId,
        command,
        key: crypto.randomUUID(),
        hash,
      };
      // Durable before POST; payload/reason/tracking/PII are never persisted.
      sessionStorage.setItem(storageKey(actorId), JSON.stringify(intent));
      setPending(intent);
      try {
        await adminFulfilmentApi.send(intent, body);
      } catch (e) {
        if (live() && !wasPending && definiteRejection(e)) {
          sessionStorage.removeItem(storageKey(actorId));
          if (live()) setPending(null);
        }
        throw e;
      }
      if (!live()) return;
      sessionStorage.removeItem(storageKey(actorId));
      setPending(null);
      setConsent(false);
      setNote("Đã xác minh biên nhận. Tải lại đơn trước thao tác tiếp theo.");
      // A fresh mount/load reads canonical state, never synthesizes the next transition.
      setOrder(null);
      ++generation.current;
    } catch (e) {
      if (live())
        setError(
          e instanceof Error
            ? e.message
            : "Chưa xác định kết quả. Giữ yêu cầu để gửi lại cùng mã.",
        );
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  }
  return (
    <section className={styles.workspace} aria-label="Giao hàng mô phỏng">
      <h1>Giao hàng mô phỏng</h1>
      <p>
        Môi trường mô phỏng: không gọi hãng vận chuyển hoặc thu tiền thật.
        Giao thành công ghi nhận COD đã thanh toán trong dữ liệu mô phỏng.
      </p>
      <details>
        <summary>20 đơn cần xử lý khi mở màn hình</summary>
        <ul>
          {queue.map((o) => (
            <li key={o.id}>
              <button
                disabled={busy || !!pending}
                onClick={() => void load(o.id)}
              >
                {o.orderNumber} ·{" "}
                {orderStatusLabels[
                  o.status as keyof typeof orderStatusLabels
                ] ?? o.status}
              </button>
            </li>
          ))}
        </ul>
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(id);
          if (validId(n) && !lock.current && !pending) void load(n);
        }}
        className={styles.fields}
      >
        <label>
          Mã đơn hàng
          <input
            type="number"
            min="1"
            max="2147483647"
            value={id}
            disabled={busy || !!pending}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <button
          disabled={busy || blocked}
          type={pending ? "button" : "submit"}
          onClick={pending ? () => void load(pending.orderId) : undefined}
        >
          Tải đơn
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
      {pending && (
        <p role="status">
          Có yêu cầu cần đối chiếu cho đơn {pending.orderId}. Không tạo yêu cầu
          khác. Nếu vừa tải lại trang, nhập lại đúng nội dung cũ; chỉ gửi lại
          khi bạn xác nhận, với cùng mã yêu cầu.
        </p>
      )}
      {order && (
        <>
          <h2>Đơn {order.orderNumber}</h2>
          <p>
            Trạng thái:{" "}
            {orderStatusLabels[
              order.status as keyof typeof orderStatusLabels
            ] ?? order.status}{" "}
            · Tổng {order.total} VND · Thanh toán {order.payment?.provider}:{" "}
            {order.payment?.status}
          </p>
          <p>
            Lần giao: {order.currentDeliveryAttempt ?? "Chưa bàn giao"} · Vận
            đơn: {order.currentAttempt?.trackingReference ?? "Chưa có"}
          </p>
          {(pending || allowed(order).length > 0) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className={styles.fields}
            >
              <label>
                Thao tác
                <select
                  aria-label="Thao tác"
                  value={command}
                  disabled={busy || !!pending}
                  onChange={(e) => {
                    setCommand(e.target.value as Command);
                    setConsent(false);
                  }}
                >
                  {(pending ? [pending.command] : allowed(order)).map((c) => (
                    <option key={c} value={c}>
                      {labels[c]}
                    </option>
                  ))}
                </select>
              </label>
              {command !== "confirm-returned" && (
                <label>
                  Mã vận đơn
                  <input
                    maxLength={100}
                    value={tracking}
                    disabled={busy}
                    onChange={(e) => {
                      setTracking(e.target.value);
                      setConsent(false);
                    }}
                    required
                  />
                </label>
              )}
              {(command === "mark-delivered" ||
                command === "delivery-failed") && (
                <label>
                  Lần giao
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={attempt}
                    disabled={busy}
                    onChange={(e) => {
                      setAttempt(e.target.value);
                      setConsent(false);
                    }}
                    required
                  />
                </label>
              )}
              {command === "delivery-failed" && (
                <label>
                  Lý do giao thất bại
                  <select
                    aria-label="Lý do giao thất bại"
                    value={reasonCode}
                    disabled={busy}
                    onChange={(e) => {
                      setReasonCode(e.target.value);
                      setConsent(false);
                    }}
                  >
                    <option value="CUSTOMER_UNREACHABLE">
                      Không liên hệ được khách
                    </option>
                    <option value="ADDRESS_ISSUE">Vấn đề địa chỉ</option>
                    <option value="CUSTOMER_REFUSED">Khách từ chối</option>
                    <option value="OTHER">Khác</option>
                  </select>
                </label>
              )}
              {command === "confirm-returned" && (
                <>
                  <label>
                    Tình trạng hàng hoàn
                    <select
                      disabled={busy}
                      aria-label="Tình trạng hàng hoàn"
                      value={disposition}
                      onChange={(e) => {
                        setDisposition(e.target.value);
                        setConsent(false);
                      }}
                    >
                      <option value="RETURN_RECEIVED">
                        Đã nhận, đủ điều kiện nhập kho
                      </option>
                      <option value="DAMAGED">
                        Đã nhận, hỏng — không nhập kho
                      </option>
                      <option value="LOST">Thất lạc — không nhập kho</option>
                    </select>
                  </label>
                  {disposition !== "LOST" && (
                    <label>
                      Biên nhận hàng hoàn
                      <input
                        maxLength={100}
                        required
                        disabled={busy}
                        value={receipt}
                        onChange={(e) => {
                          setReceipt(e.target.value);
                          setConsent(false);
                        }}
                      />
                    </label>
                  )}
                </>
              )}
              {(command === "delivery-failed" ||
                command === "confirm-returned") && (
                <label>
                  Chi tiết lý do
                  <textarea
                    aria-label="Chi tiết lý do"
                    required
                    maxLength={500}
                    disabled={busy}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setConsent(false);
                    }}
                  />
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Tôi đã kiểm tra đúng đơn và đồng ý ghi nhận thao tác mô phỏng
                này.
              </label>
              <button disabled={!consent || busy || blocked} type="submit">
                {busy
                  ? "Đang xử lý…"
                  : pending
                    ? "Gửi lại cùng yêu cầu"
                    : "Xác nhận mô phỏng"}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
