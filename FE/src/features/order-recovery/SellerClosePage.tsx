import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../contexts/useAuth";
import { getAuthSessionVersion } from "../../services/apiClient";
import { validOrderId } from "../../services/orderResponse";
import { orderMoney, orderStatusLabels } from "../order-readiness/orderPolicy";
import { createOrderIntentJournal } from "./orderIntentJournal";
import {
  closeBody,
  closeDefiniteRejection,
  closeHash,
  eligibleClose,
  pendingSellerClose,
  prepareClose,
  sellerCloseApi,
  settleClose,
  type CloseCommand,
  type CloseIntent,
  type CloseStorage,
} from "./sellerCloseClient";
import type { OrderDetail } from "../../types/order";
import styles from "./BuyerCommandReview.module.css";

function storage(): CloseStorage {
  try {
    return window.sessionStorage;
  } catch {
    const deny = (): never => {
      throw Error("Không truy cập được bộ nhớ phục hồi.");
    };
    return { getItem: deny, setItem: deny, removeItem: deny };
  }
}
export function SellerClosePage() {
  const { user, loading } = useAuth(),
    { orderId } = useParams();
  if (loading) return <p role="status">Đang xác minh phiên…</p>;
  if (!user?.isActive || user.role !== "SELLER")
    return <p role="alert">Cần Seller đang hoạt động.</p>;
  if (
    !orderId ||
    !/^[1-9]\d{0,9}$/.test(orderId) ||
    !validOrderId(Number(orderId))
  )
    return <p role="alert">Mã đơn không hợp lệ.</p>;
  return (
    <CloseWorkspace
      key={`${user.id}:${getAuthSessionVersion()}:${orderId}`}
      actorId={user.id}
      orderId={Number(orderId)}
    />
  );
}
function CloseWorkspace({
  actorId,
  orderId,
}: {
  actorId: number;
  orderId: number;
}) {
  const [port] = useState(storage),
    [initial] = useState(() => {
      try {
        return {
          close: pendingSellerClose(storage(), actorId),
          preparation: createOrderIntentJournal(storage()).pending({
            id: actorId,
            role: "SELLER",
          }),
          error: "",
        };
      } catch {
        return {
          close: null,
          preparation: null,
          error: "Không đọc được journal. Khóa thao tác để đối chiếu.",
        };
      }
    });
  const [intent, setIntent] = useState<CloseIntent | null>(initial.close),
    [record, setRecord] = useState<{
      order: OrderDetail;
      storeStatus: string;
    } | null>(null),
    [command, setCommand] = useState<CloseCommand>(
      initial.close?.command ?? "cancel",
    );
  const [reasonCode, setReasonCode] = useState("CANNOT_FULFIL"),
    [reason, setReason] = useState(""),
    [receipt, setReceipt] = useState(""),
    [restock, setRestock] = useState(true),
    [consent, setConsent] = useState(false),
    [showResolution, setShowResolution] = useState(false),
    [resolutionConsent, setResolutionConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initial.error),
    [note, setNote] = useState("");
  const mounted = useRef(true),
    epoch = useRef(getAuthSessionVersion()),
    latch = useRef(false),
    generation = useRef(0);
  const sameSession = () => epoch.current === getAuthSessionVersion();
  const live = () => mounted.current && sameSession();
  async function read() {
    if (latch.current) return;
    const n = ++generation.current;
    setRecord(null);
    setConsent(false);
    setResolutionConsent(false);
    setError(initial.error);
    try {
      const r = await sellerCloseApi.read(actorId, orderId);
      if (!live() || generation.current !== n) return;
      setRecord(r);
      if (!intent)
        setCommand(
          r.order.status === "DELIVERY_FAILED" ? "confirm-returned" : "cancel",
        );
    } catch {
      if (live() && generation.current === n)
        setError("Không tải được đơn/cửa hàng hiện hành. Chưa được gửi lệnh.");
    }
  }
  useEffect(() => {
    mounted.current = true;
    void read();
    return () => {
      mounted.current = false;
      ++generation.current;
    };
  }, []); // actor/session/order key owns this read lifecycle
  const another = !!intent && intent.orderId !== orderId;
  const locked = !!initial.error || !!initial.preparation || another;
  async function resolvePending() {
    if (latch.current || !live() || !resolutionConsent || !intent || another || initial.error || !record?.order.payment) return;
    latch.current = true;
    ++generation.current;
    setBusy(true);
    setError("");
    setNote("");
    const p = intent;
    try {
      const proof = await sellerCloseApi.resolve(p, epoch.current, record.order.payment);
      if (!sameSession()) return;
      settleClose(port, p);
      if (!live()) return;
      setIntent(null);
      setConsent(false);
      setResolutionConsent(false);
      setShowResolution(false);
      setRecord(null);
      setNote(proof.outcome === "COMMITTED"
        ? "Đã đối chiếu biên nhận đã thực hiện. Tải lại đơn để xem trạng thái hiện tại."
        : "Đã đóng mã yêu cầu chưa thực hiện. Đóng mã không phải hủy đơn. Tải lại đơn trước thao tác mới.");
    } catch {
      if (live()) setError("Chưa xác minh được đối chiếu. Giữ nguyên mã yêu cầu; không tự tạo mã mới.");
    } finally {
      latch.current = false;
      if (live()) setBusy(false);
    }
  }
  async function send() {
    if (latch.current || !live() || !consent || locked || !record || !record.order.payment) return;
    latch.current = true;
    ++generation.current;
    setBusy(true);
    setError("");
    setNote("");
    const old = !!intent;
    try {
      if (!intent && !eligibleClose(record.order, record.storeStatus, command))
        throw Error("Trạng thái hoặc thanh toán không cho phép thao tác.");
      const body = closeBody(command, reasonCode, reason, receipt, restock),
        requestHash = await closeHash(actorId, orderId, command, body);
      if (!live()) return;
      const p = prepareClose(port, { actorId, orderId, command, requestHash });
      setIntent(p);
      try {
        await sellerCloseApi.send(p, body, epoch.current, record.order.payment);
      } catch (e) {
        if (sameSession() && !old && closeDefiniteRejection(e)) {
          settleClose(port, p);
          if (live()) setIntent(null);
        }
        throw e;
      }
      // The validated receipt proves this exact command even after navigation.
      // Storage CAS + session epoch fence protect a newer actor/intent; mounted
      // only controls React updates, not acknowledgement of a proven result.
      if (!sameSession()) return;
      settleClose(port, p);
      if (!live()) return;
      setIntent(null);
      setConsent(false);
      setRecord(null);
      setNote(
        "Đã xác minh biên nhận hủy/nhận hoàn. Tải lại đơn để xem trạng thái mới.",
      );
    } catch (e) {
      if (live())
        setError(
          e instanceof Error
            ? e.message
            : "Chưa rõ kết quả. Giữ yêu cầu để đối chiếu.",
        );
    } finally {
      latch.current = false;
      if (live()) setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="Hủy và nhận hoàn Seller">
      <h1>Hủy đơn và nhận hàng quay về</h1>
      <p>
        Giao thất bại chưa có nghĩa hàng đã về kho. Chỉ xác nhận nhận hàng sau
        khi đã kiểm tra hàng và biên nhận. Đây là vận chuyển mô phỏng.
      </p>
      <p>
        <Link to={`/seller/orders/${orderId}`}>Về chi tiết đơn</Link>
      </p>
      <button type="button" disabled={busy} onClick={() => void read()}>
        Tải lại đơn để đối chiếu
      </button>
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
      {initial.preparation && (
        <p role="alert">
          Còn lệnh chuẩn bị đơn chưa rõ kết quả.{" "}
          <Link to={`/seller/orders/${initial.preparation.orderId}`}>
            Đối chiếu lệnh chuẩn bị đơn
          </Link>{" "}
          trước thao tác mới.
        </p>
      )}
      {another && intent && (
        <p role="alert">
          Còn yêu cầu hủy/nhận hoàn ở đơn khác.{" "}
          <Link to={`/seller/orders/${intent.orderId}/close`}>
            Đối chiếu đơn {intent.orderId}
          </Link>
          .
        </p>
      )}
      {intent && !another && (
        <div>
        <p role="status">
          Có yêu cầu cần đối chiếu. Không tự gửi lại khi tải trang. Nhập đúng
          nội dung cũ và xác nhận để gửi lại bằng cùng mã; không tạo mã mới.
        </p>
        <button type="button" disabled={busy || !!initial.error} onClick={() => { setShowResolution(!showResolution); setConsent(false); setResolutionConsent(false); }}>
          {showResolution ? "Quay lại nhập yêu cầu cũ" : "Mở đối chiếu mã yêu cầu"}
        </button>
        {showResolution && <section aria-label="Đối chiếu mã yêu cầu Seller">
          <p>Nếu không nhớ nội dung cũ, server sẽ tìm biên nhận hoặc đóng mã chưa thực hiện. Đóng mã ngăn yêu cầu cũ đến muộn; thao tác này không hủy đơn, không hoàn kho và không thực hiện lại lệnh.</p>
          <label><input type="checkbox" checked={resolutionConsent} disabled={busy} onChange={(e) => setResolutionConsent(e.target.checked)} />Tôi đồng ý đối chiếu và đóng mã chưa thực hiện nếu chưa có biên nhận.</label>
          <button type="button" disabled={busy || !resolutionConsent || !record?.order.payment} onClick={() => void resolvePending()}>Đối chiếu / dừng mã yêu cầu</button>
        </section>}
        </div>
      )}
      {record && (
        <>
          <h2>Đơn {record.order.orderNumber}</h2>
          <p>
            {orderStatusLabels[record.order.status]} ·{" "}
            {orderMoney(record.order.total)} · Cửa hàng: {record.storeStatus}
          </p>
          {!showResolution && !locked &&
          (intent ||
            eligibleClose(record.order, record.storeStatus, command)) ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <h3>
                {command === "cancel"
                  ? "Hủy đơn trước bàn giao"
                  : "Xác nhận hàng giao thất bại đã quay về"}
              </h3>
              {command === "cancel" ? (
                <>
                  <label htmlFor="seller-close-reason-code">Lý do hủy</label>
                  <select
                    id="seller-close-reason-code"
                    disabled={busy}
                    value={reasonCode}
                    onChange={(e) => {
                      setReasonCode(e.target.value);
                      setConsent(false);
                    }}
                  >
                    <option value="CANNOT_FULFIL">
                      Không thể thực hiện đơn
                    </option>
                    <option value="OUT_OF_STOCK">Hết hàng</option>
                    <option value="OTHER">Lý do khác</option>
                  </select>
                </>
              ) : (
                <>
                  <label htmlFor="seller-close-disposition">
                    Tình trạng hàng đã nhận
                  </label>
                  <select
                    id="seller-close-disposition"
                    disabled={busy}
                    value={restock ? "restock" : "damaged"}
                    onChange={(e) => {
                      setRestock(e.target.value === "restock");
                      setConsent(false);
                    }}
                  >
                    <option value="restock">Đủ điều kiện nhập kho</option>
                    <option value="damaged">Hỏng, không nhập kho</option>
                  </select>
                  <label htmlFor="seller-close-receipt">
                    Biên nhận hàng quay về
                  </label>
                  <input
                    id="seller-close-receipt"
                    type="text"
                    maxLength={100}
                    required
                    disabled={busy}
                    value={receipt}
                    onChange={(e) => {
                      setReceipt(e.target.value);
                      setConsent(false);
                    }}
                  />
                </>
              )}
              <label htmlFor="seller-close-reason">Mô tả lý do</label>
              <textarea
                id="seller-close-reason"
                maxLength={500}
                required
                disabled={busy}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setConsent(false);
                }}
              />
              <p>
                Lý do và biên nhận chỉ ở màn hiện tại. Nếu mất phản hồi rồi tải
                lại trang, cần nhập lại đúng nội dung để đối chiếu.
              </p>
              <label className={styles.confirmation}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Tôi đã kiểm tra đúng đơn, lý do và tình trạng hàng; đồng ý ghi
                nhận thao tác này.
              </label>
              <button type="submit" disabled={!consent || busy}>
                {busy
                  ? "Đang xử lý…"
                  : intent
                    ? "Gửi lại cùng yêu cầu Seller"
                    : "Xác nhận hủy/nhận hoàn"}
              </button>
            </form>
          ) : (
            !showResolution && !locked && (
              <p>
                Không có thao tác hủy/nhận hoàn phù hợp với trạng thái hiện tại.
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}
