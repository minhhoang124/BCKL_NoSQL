import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { ApiError, getAuthSessionVersion } from "../../services/apiClient";
import {
  dashboardApi,
  defaultQuery,
  formatMoney,
  windows,
  type DashboardApi,
  type Quality,
  type Query,
  type Scope,
  type Summary,
} from "./dashboardApi";
import styles from "./Dashboard.module.css";

export function Dashboard({
  scope,
  storeId,
  api,
}: {
  scope: Scope;
  storeId?: number;
  api?: DashboardApi;
}) {
  const { user, loading } = useAuth();
  const source = useMemo(
    () => api ?? dashboardApi(scope, undefined, storeId),
    [api, scope, storeId],
  );
  if (loading) return <p role="status">Đang kiểm tra phiên đăng nhập…</p>;
  if (!user?.isActive || user.role !== scope)
    return (
      <p role="alert">Tài khoản hiện tại không có quyền xem thống kê này.</p>
    );
  return (
    <DashboardScreen
      key={`${user.id}:${user.role}:${getAuthSessionVersion()}:${storeId ?? "all"}`}
      api={source}
    />
  );
}
function errorMessage(error: unknown) {
  if (error instanceof ApiError && [401, 403].includes(error.status ?? 0))
    return "Phiên hoặc quyền truy cập đã thay đổi. Vui lòng đăng nhập lại.";
  if (error instanceof ApiError && error.status === 404)
    return "Tài khoản chưa có cửa hàng để xem thống kê.";
  return error instanceof Error && !(error instanceof ApiError)
    ? error.message
    : "Không tải được thống kê. Vui lòng thử lại.";
}
const stateLabels: Record<string, string> = {
  PENDING_CONFIRMATION: "Chờ xác nhận",
  CONFIRMED: "Đã xác nhận",
  PACKING: "Đang chuẩn bị",
  READY_TO_SHIP: "Sẵn sàng giao",
  SHIPPING: "Đang giao",
  DELIVERED: "Đã giao",
  COMPLETED: "Hoàn tất",
  CANCELLED: "Đã hủy",
  DELIVERY_FAILED: "Giao thất bại",
  DRAFT: "Nháp",
  ACTIVE: "Hoạt động",
  HIDDEN: "Đã ẩn",
  NOT_SUBMITTED: "Chưa gửi duyệt",
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  FROZEN: "Đóng băng",
  SUSPENDED: "Tạm khóa",
  CLOSED: "Đã đóng",
  USER: "Người mua",
  SELLER: "Người bán",
  ADMIN: "Quản trị viên",
};
const issueLabels: Record<string, string> = {
  MONEY_SNAPSHOT_INVALID: "Cần đối chiếu số tiền",
  FULFILLMENT_TIME_INVALID: "Cần đối chiếu mốc giao/hoàn tất",
  REFUND_PROJECTION_INVALID: "Cần đối chiếu bút toán hoàn tiền",
};
function Counts({
  title,
  values,
}: {
  title: string;
  values: Record<string, number>;
}) {
  return (
    <section className={styles.panel}>
      <h3>{title}</h3>
      <dl className={styles.counts}>
        {Object.entries(values).map(([key, n]) => (
          <div key={key}>
            <dt>{stateLabels[key] ?? key}</dt>
            <dd>{n.toLocaleString("vi-VN")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
function DashboardScreen({ api }: { api: DashboardApi }) {
  const [draft, setDraft] = useState<Query>(defaultQuery);
  const [data, setData] = useState<{
    query: Query;
    summary: Summary;
    source: DashboardApi;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [quality, setQuality] = useState<Quality | null>(null),
    [qualityError, setQualityError] = useState(""),
    [qualityBusy, setQualityBusy] = useState(false);
  const flight = useRef<AbortController | null>(null),
    qualityFlight = useRef<AbortController | null>(null);
  const epoch = useRef(getAuthSessionVersion()),
    generation = useRef(0);
  const mounted = useRef(true),
    blocked = useRef(false);
  const current = (controller: AbortController, version: number) =>
    mounted.current &&
    !controller.signal.aborted &&
    epoch.current === getAuthSessionVersion() &&
    generation.current === version;
  async function load(query: Query) {
    if (blocked.current || epoch.current !== getAuthSessionVersion()) return;
    try {
      windows(query);
    } catch {
      setError(
        "Chọn khoảng ngày hợp lệ, tối đa 366 ngày; ngày kết thúc không nằm trong kỳ.",
      );
      return;
    }
    const immutable = { ...query };
    flight.current?.abort();
    qualityFlight.current?.abort();
    qualityFlight.current = null;
    const controller = new AbortController(),
      version = ++generation.current;
    flight.current = controller;
    setBusy(true);
    setData(null);
    setError("");
    setQuality(null);
    setQualityError("");
    setQualityBusy(false);
    try {
      const summary = await api.summary(
        immutable,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (current(controller, version))
        setData({ query: immutable, summary, source: api });
    } catch (failure) {
      if (current(controller, version)) {
        setError(errorMessage(failure));
        if (
          failure instanceof ApiError &&
          [401, 403].includes(failure.status ?? 0)
        )
          blocked.current = true;
      }
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function readQuality(before?: number) {
    if (
      !data ||
      data.source !== api ||
      qualityFlight.current ||
      blocked.current ||
      epoch.current !== getAuthSessionVersion()
    )
      return;
    const controller = new AbortController(),
      version = generation.current;
    qualityFlight.current = controller;
    setQualityBusy(true);
    setQualityError("");
    try {
      const page = await api.quality(
        data.query,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        before,
      );
      if (current(controller, version))
        setQuality((previous) => ({
          ...page,
          items:
            before && previous
              ? [...previous.items, ...page.items]
              : page.items,
        }));
    } catch (failure) {
      if (current(controller, version)) {
        setQuality(null);
        setQualityError(errorMessage(failure));
        if (
          failure instanceof ApiError &&
          [401, 403].includes(failure.status ?? 0)
        ) {
          blocked.current = true;
          setData(null);
          setError(errorMessage(failure));
        }
      }
    } finally {
      if (qualityFlight.current === controller) {
        qualityFlight.current = null;
        if (mounted.current) setQualityBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load(defaultQuery());
    // These refs intentionally hold the latest requests, including those started after mount.
    /* oxlint-disable react-hooks/exhaustive-deps */
    return () => {
      mounted.current = false;
      ++generation.current;
      flight.current?.abort();
      qualityFlight.current?.abort();
    };
    /* oxlint-enable react-hooks/exhaustive-deps */
    // The parent remounts this screen on actor/session/API changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const summary = data?.source === api ? data.summary : undefined;
  return (
    <section
      className={styles.layout}
      aria-label="Thống kê doanh thu và hoàn tiền"
    >
      <header>
        <p className={styles.eyebrow}>
          {summary?.store?.name ?? "BCKL · THỐNG KÊ"}
        </p>
        <h2>Doanh thu và hoàn tiền</h2>
        <p>
          Đơn hoàn tất ghi nhận doanh thu; khoản hoàn được ghi nhận ở kỳ có hiệu
          lực.
        </p>
      </header>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          void load(draft);
        }}
      >
        <label>
          Từ ngày
          <input
            type="date"
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          Đến trước ngày
          <input
            type="date"
            required
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <label>
          Nhóm theo
          <select
            value={draft.bucket}
            onChange={(e) =>
              setDraft({ ...draft, bucket: e.target.value as Query["bucket"] })
            }
          >
            <option value="day">Ngày</option>
            <option value="month">Tháng</option>
            <option value="quarter">Quý</option>
          </select>
        </label>
        <button disabled={busy || blocked.current}>
          {busy ? "Đang tải…" : "Xem thống kê"}
        </button>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {busy && <p role="status">Đang tải số liệu từ hệ thống…</p>}
      {summary && data && (
        <>
          <p>
            Đang xem từ {data.query.from} đến trước {data.query.to} · Giờ Việt
            Nam (UTC+7). Cập nhật lúc{" "}
            {new Date(summary.asOf).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            })}
            .
          </p>
          <div className={styles.cards}>
            {[
              ["Doanh thu hàng hóa", summary.totals.grossMerchandise],
              [
                "Hoàn tiền có hiệu lực trong kỳ",
                summary.totals.effectiveRefundMerchandise,
              ],
              ["Doanh thu thuần", summary.totals.netMerchandise],
              [
                "Phí giao hàng của đơn hoàn tất",
                summary.totals.completedShipping,
              ],
              [
                "Khoản hoàn chờ ghi nhận · toàn thời gian",
                summary.pendingRefundMerchandise,
              ],
            ].map(([label, value]) => (
              <article className={styles.card} key={label}>
                <span>{label}</span>
                <strong>{formatMoney(value!)}</strong>
              </article>
            ))}
            <article className={styles.card}>
              <span>Đơn hoàn tất hợp lệ trong kỳ</span>
              <strong>
                {summary.totals.completedOrderCount.toLocaleString("vi-VN")}
              </strong>
            </article>
          </div>
          <p className={styles.notice}>
            Hoàn tiền hiện ở chế độ mô phỏng. Doanh thu thuần có thể âm khi hoàn
            đơn của kỳ trước; không phải lợi nhuận hay tiền đã đối soát. Khoản
            hoàn chờ chưa trừ vào doanh thu.
          </p>
          <div className={styles.tableScroll}>
            <table>
              <caption>
                Chi tiết theo kỳ · phí giao hàng trình bày riêng
              </caption>
              <thead>
                <tr>
                  <th scope="col">Kỳ</th>
                  <th scope="col">Đơn hoàn tất</th>
                  <th scope="col">Hàng hóa</th>
                  <th scope="col">Hoàn tiền</th>
                  <th scope="col">Thuần</th>
                  <th scope="col">Phí giao hàng</th>
                </tr>
              </thead>
              <tbody>
                {summary.buckets.map((b) => (
                  <tr key={b.periodStart}>
                    <th scope="row">
                      {b.from} → {b.to}
                      {b.partial && <small> · Một phần kỳ</small>}
                    </th>
                    <td>{b.completedOrderCount}</td>
                    <td>{formatMoney(b.grossMerchandise)}</td>
                    <td>{formatMoney(b.effectiveRefundMerchandise)}</td>
                    <td>{formatMoney(b.netMerchandise)}</td>
                    <td>{formatMoney(b.completedShipping)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className={styles.panel}>
            <h3>Đối chiếu dữ liệu</h3>
            <p>
              {summary.invalidSnapshotOrderCount} đơn cần kiểm tra, đã được loại
              khỏi cả doanh thu và khoản hoàn. Phạm vi gồm khoản hoàn chờ hoặc
              thiếu bút toán ở mọi thời điểm.
            </p>
            <button
              disabled={qualityBusy || blocked.current}
              onClick={() => void readQuality()}
            >
              Xem đơn cần đối chiếu
            </button>
            {qualityError && (
              <p role="alert" className={styles.error}>
                {qualityError}
              </p>
            )}
            {qualityBusy && <p role="status">Đang tải danh sách đối chiếu…</p>}
            {quality && (
              <>
                <p>
                  Danh sách được đọc riêng lúc{" "}
                  {new Date(quality.asOf).toLocaleString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                  })}
                  ; có thể thay đổi so với tổng ở trên.
                </p>
                {quality.items.length === 0 ? (
                  <p>Không có đơn cần đối chiếu trong lượt đọc này.</p>
                ) : (
                  <ul>
                    {quality.items.map((item) => (
                      <li key={item.orderId}>
                        Đơn #{item.orderId} · Store #{item.storeId}:{" "}
                        {item.issues
                          .map((code) => issueLabels[code])
                          .join("; ")}
                      </li>
                    ))}
                  </ul>
                )}
                {quality.nextBeforeId !== null && (
                  <button
                    disabled={qualityBusy || blocked.current}
                    onClick={() => void readQuality(quality.nextBeforeId!)}
                  >
                    Xem thêm đơn
                  </button>
                )}
              </>
            )}
          </section>
          <div className={styles.operational}>
            <Counts
              title="Đơn tạo trong kỳ · trạng thái hiện tại"
              values={summary.orders}
            />
            <Counts
              title="Sản phẩm hiện tại · trạng thái bán"
              values={summary.products.bySellerStatus}
            />
            <Counts
              title="Sản phẩm hiện tại · kiểm duyệt"
              values={summary.products.byModerationStatus}
            />
            {summary.stores && (
              <Counts
                title="Cửa hàng hiện tại · không lọc theo kỳ"
                values={summary.stores}
              />
            )}
            {summary.users && (
              <section className={styles.panel}>
                <h3>Tài khoản hiện tại · không lọc theo kỳ</h3>
                <ul>
                  {Object.entries(summary.users).map(([role, n]) => (
                    <li key={role}>
                      {stateLabels[role]}: {n.active} hoạt động / {n.inactive}{" "}
                      bị khóa
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </section>
  );
}
