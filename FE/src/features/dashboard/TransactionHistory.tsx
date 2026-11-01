import { useEffect, useRef, useState } from "react";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import {
  formatMoney,
  type DashboardApi,
  type Query,
  type Scope,
  type Transactions,
} from "./dashboardApi";
import styles from "./Dashboard.module.css";

const providerLabels: Record<string, string> = {
  COD: "Thanh toán khi nhận hàng",
  VNPAY: "VNPay",
  MOMO: "MoMo",
};
const statusLabels: Record<string, string> = {
  UNPAID: "Chưa thanh toán",
  PENDING: "Đang xử lý",
  PAID: "Đã thanh toán",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
  EXPIRED: "Hết hạn",
  REFUND_PENDING: "Chờ hoàn tiền",
  REFUNDED: "Đã hoàn tiền",
  REVIEW_REQUIRED: "Cần kiểm tra",
};

function message(error: unknown) {
  if (error instanceof ApiError && [401, 403].includes(error.status ?? 0))
    return "Phiên hoặc quyền truy cập đã thay đổi. Vui lòng đăng nhập lại.";
  return error instanceof Error && !(error instanceof ApiError)
    ? error.message
    : "Không tải được lịch sử giao dịch. Vui lòng thử lại.";
}

/** CN3-YC2: payment and refund history for one Store (Seller) or any Store (Admin). */
export function TransactionHistory({
  api,
  scope,
  query,
}: {
  api: DashboardApi;
  scope: Scope;
  query: Query;
}) {
  const [stores, setStores] = useState<{ id: number; name: string }[]>([]);
  const [storeFilter, setStoreFilter] = useState<number | undefined>();
  const [data, setData] = useState<Transactions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const flight = useRef<AbortController | null>(null);
  const epoch = useRef(getAuthSessionVersion());

  async function load(filter: number | undefined, cursor?: string) {
    if (epoch.current !== getAuthSessionVersion()) return;
    flight.current?.abort();
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError("");
    if (!cursor) setData(null);
    try {
      const page = await api.transactions(
        query,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        { cursor, filterStoreId: filter },
      );
      if (controller.signal.aborted || epoch.current !== getAuthSessionVersion())
        return;
      setData((previous) =>
        cursor && previous
          ? { ...page, items: [...previous.items, ...page.items] }
          : page,
      );
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setBusy(false);
      }
    }
  }

  const storesFlight = useRef<AbortController | null>(null);
  const [storesFailed, setStoresFailed] = useState(false);
  function loadStores() {
    if (scope !== "ADMIN" || storesFlight.current) return;
    const controller = new AbortController();
    storesFlight.current = controller;
    setStoresFailed(false);
    api
      .stores(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setStores(rows);
      })
      .catch(() => {
        // The filter keeps "Tất cả cửa hàng"; surface a separate retry.
        if (storesFlight.current === controller) {
          storesFlight.current = null;
          if (!controller.signal.aborted) setStoresFailed(true);
        }
      });
  }
  function open() {
    loadStores();
    void load(storeFilter);
  }
  // Parent remounts this panel when the query or API changes.
  useEffect(
    () => () => {
      storesFlight.current?.abort();
      flight.current?.abort();
    },
    [],
  );

  return (
    <section className={styles.panel} aria-label="Lịch sử giao dịch">
      <h3>Lịch sử giao dịch</h3>
      <p>
        Khoản thanh toán và hoàn tiền từ {query.from} đến trước {query.to}, mới
        nhất trước. Dòng hoàn tiền là bút toán mô phỏng.
      </p>
      {!data && !busy && !error && (
        <button type="button" onClick={open}>
          Xem lịch sử giao dịch
        </button>
      )}
      {scope === "ADMIN" && (data || busy || error) && (
        <label className={styles.inlineField}>
          Cửa hàng{" "}
          <select
            value={storeFilter ?? ""}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : undefined;
              setStoreFilter(next);
              void load(next);
            }}
          >
            <option value="">Tất cả cửa hàng</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {scope === "ADMIN" && storesFailed && (
        <p>
          <span role="status">Chưa tải được danh sách cửa hàng.</span>{" "}
          <button type="button" onClick={loadStores}>
            Tải lại danh sách cửa hàng
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}{" "}
          <button type="button" onClick={open}>
            Thử lại
          </button>
        </p>
      )}
      {busy && !data && <p role="status">Đang tải lịch sử giao dịch…</p>}
      {data && (
        <>
          <dl className={styles.counts}>
            <div>
              <dt>Đã thanh toán ({data.totals.paidCount})</dt>
              <dd>{formatMoney(data.totals.paidAmount)}</dd>
            </div>
            <div>
              <dt>Đã hoàn tiền ({data.totals.refundCount})</dt>
              <dd>{formatMoney(data.totals.refundAmount)}</dd>
            </div>
          </dl>
          {data.items.length === 0 ? (
            <p>Chưa có giao dịch trong khoảng thời gian này.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Thời gian</th>
                    <th scope="col">Mã đơn</th>
                    {scope === "ADMIN" && <th scope="col">Cửa hàng</th>}
                    <th scope="col">Loại</th>
                    <th scope="col">Phương thức</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((t) => (
                    <tr key={t.key}>
                      <td>
                        {new Date(t.at).toLocaleString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })}
                      </td>
                      <th scope="row">{t.orderNumber}</th>
                      {scope === "ADMIN" && <td>{t.storeName}</td>}
                      <td>{t.type === "PAYMENT" ? "Thanh toán" : "Hoàn tiền"}</td>
                      <td>{providerLabels[t.provider]}</td>
                      <td>{statusLabels[t.status] ?? t.status}</td>
                      <td>
                        {t.type === "REFUND" ? "−" : ""}
                        {formatMoney(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.nextCursor !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(storeFilter, data.nextCursor!)}
            >
              {busy ? "Đang tải…" : "Xem thêm giao dịch"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
