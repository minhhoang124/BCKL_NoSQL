import styles from "./dashboard/Dashboard.module.css";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/useAuth";
import { fetchApi, getAuthSessionVersion } from "../services/apiClient";

type Report = {
  status: "DISABLED" | "PARTIAL" | "RECORDED";
  coverage: "RECORDED_ONLY";
  complete: false;
  asOf: string;
  availableFrom: string | null;
  totals: { impressions: number; clicks: number } | null;
  strategies: { strategy: string; impressions: number; clicks: number }[];
};
function validate(raw: unknown): Report {
  if (!raw || typeof raw !== "object")
    throw Error("Dữ liệu thống kê không hợp lệ.");
  const v = raw as Report,
    count = (x: number) => Number.isSafeInteger(x) && x >= 0;
  if (
    !["DISABLED", "PARTIAL", "RECORDED"].includes(v.status) ||
    v.coverage !== "RECORDED_ONLY" ||
    v.complete !== false ||
    !Number.isFinite(Date.parse(v.asOf)) ||
    !Array.isArray(v.strategies) ||
    v.strategies.length > 2 ||
    (v.status === "DISABLED"
      ? v.totals !== null
      : !v.totals ||
        !count(v.totals.impressions) ||
        !count(v.totals.clicks) ||
        v.totals.clicks > v.totals.impressions) ||
    v.strategies.some(
      (r) =>
        !["HYBRID_TEXT", "IMAGE"].includes(r.strategy) ||
        !count(r.impressions) ||
        !count(r.clicks) ||
        r.clicks > r.impressions,
    )
  )
    throw Error("Dữ liệu thống kê không hợp lệ.");
  return v;
}
export function SearchAnalytics({ scope }: { scope: "SELLER" | "ADMIN" }) {
  const { user, loading } = useAuth();
  if (loading) return <p>Đang kiểm tra phiên…</p>;
  if (!user?.isActive || user.role !== scope)
    return <p role="alert">Không có quyền xem thống kê tìm kiếm.</p>;
  return <Screen key={`${user.id}:${getAuthSessionVersion()}`} scope={scope} />;
}
function Screen({ scope }: { scope: "SELLER" | "ADMIN" }) {
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() =>
    new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  );
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    pending = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function load() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setReport(null);
    setError("");
    const current = ++generation.current,
      session = getAuthSessionVersion();
    try {
      const q = new URLSearchParams({
        from: `${from}T00:00:00.000Z`,
        to: `${to}T00:00:00.000Z`,
      });
      const value = validate(
        await fetchApi(`/${scope.toLowerCase()}/search-analytics?${q}`),
      );
      if (current === generation.current && session === getAuthSessionVersion())
        setReport(value);
    } catch {
      if (current === generation.current && session === getAuthSessionVersion())
        setError(
          "Không tải được thống kê. Không thể suy ra số lượt bằng 0; hãy tải lại hoặc kiểm tra phiên đăng nhập.",
        );
    } finally {
      if (current === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className={styles.layout} aria-label="Thống kê tìm kiếm">
      <h2>Hiệu quả xuất hiện trong tìm kiếm</h2>
      <p>
        {scope === "SELLER"
          ? "Chỉ thống kê sản phẩm của cửa hàng bạn."
          : "Tổng hợp sản phẩm toàn sàn."}{" "}
        Lượt hiển thị là thẻ đi vào vùng nhìn thấy; nhấp là mở liên kết sản
        phẩm, không phải đơn mua.
      </p>
      <form className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          Từ ngày UTC
          <input
            type="date"
            required
            value={from}
            disabled={busy}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Đến ngày UTC (không gồm ngày này)
          <input
            type="date"
            required
            value={to}
            disabled={busy}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button disabled={busy}>
          {busy ? "Đang tải…" : "Xem thống kê tìm kiếm"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {report?.status === "DISABLED" ? (
        <p role="status">
          Thu thập thống kê chưa được bật; chưa có số liệu để kết luận.
        </p>
      ) : (
        report?.totals && (
          <>
            <p role="status">
              Chỉ gồm lượt đã ghi nhận; có thể thiếu do lỗi mạng, chặn theo dõi
              hoặc dịch vụ gián đoạn.{" "}
              {report.status === "PARTIAL"
                ? "Kỳ chọn có phần nằm ngoài thời gian đã thu thập."
                : ""}
            </p>
            <p>
              Dữ liệu từ {report.availableFrom ?? "chưa xác định"} · đối chiếu
              lúc {report.asOf} · lưu 30 ngày, mỗi kết quả tối đa 1 lượt hiển
              thị và 1 lượt nhấp/lần tìm.
            </p>
            <p>
              Hiển thị: <strong>{report.totals.impressions}</strong> · Nhấp:{" "}
              <strong>{report.totals.clicks}</strong>
            </p>
            <table>
              <thead>
                <tr>
                  <th>Kiểu tìm</th>
                  <th>Hiển thị</th>
                  <th>Nhấp</th>
                </tr>
              </thead>
              <tbody>
                {report.strategies.map((r) => (
                  <tr key={r.strategy}>
                    <td>
                      {r.strategy === "IMAGE" ? "Bằng ảnh" : "Văn bản kết hợp"}
                    </td>
                    <td>{r.impressions}</td>
                    <td>{r.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      )}
    </section>
  );
}
