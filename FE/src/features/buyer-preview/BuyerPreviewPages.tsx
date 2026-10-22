import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  demoAddress,
  demoOrders,
  displayMoney,
  statusLabels,
} from "./fixtures";
import type { DemoOrder, DemoState } from "./fixtures";
import styles from "./BuyerPreview.module.css";

function Scenario({
  value,
  onChange,
  checkout = false,
}: {
  value: DemoState;
  onChange: (value: DemoState) => void;
  checkout?: boolean;
}) {
  return (
    <label className={styles.scenario}>
      Tình huống minh họa
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DemoState)}
      >
        <option value="ready">Có dữ liệu</option>
        <option value="loading">Đang tải</option>
        <option value="error">Lỗi kết nối</option>
        <option value="empty">Không có dữ liệu</option>
        {checkout && (
          <>
            <option value="price-changed">Giá thay đổi</option>
            <option value="stock-short">Không đủ tồn kho</option>
            <option value="unknown">Chưa xác định kết quả tạo đơn</option>
          </>
        )}
      </select>
    </label>
  );
}
function StatePanel({ state, retry }: { state: DemoState; retry: () => void }) {
  if (state === "loading")
    return (
      <div role="status" className={styles.card}>
        Đang tải dữ liệu mẫu…
      </div>
    );
  if (state === "error")
    return (
      <div role="alert" className={styles.card}>
        <h2>Chưa tải được thông tin</h2>
        <p>Dữ liệu đã nhập không bị xóa. Đây là lỗi kết nối được minh họa.</p>
        <button onClick={retry}>Thử lại dữ liệu mẫu</button>
      </div>
    );
  return (
    <div className={styles.card}>
      <h2>Chưa có dữ liệu</h2>
      <p>Không có đơn hoặc sản phẩm được chọn trong tình huống này.</p>
      <button onClick={retry}>Xem dữ liệu mẫu</button>
    </div>
  );
}
function Line({ order }: { order: DemoOrder }) {
  return (
    <div className={styles.line}>
      <div className={styles.thumbnail} aria-hidden="true">
        Ảnh
        <br />
        mẫu
      </div>
      <div>
        <strong>{order.product}</strong>
        <p>{order.options}</p>
        <p>
          {displayMoney(order.unitPrice)} × {order.quantity}
        </p>
      </div>
      <strong>{displayMoney(order.total)}</strong>
    </div>
  );
}
export function CheckoutPreviewPage() {
  const [state, setState] = useState<DemoState>("ready");
  const navigate = useNavigate();
  const canCheckout = state === "ready";
  return (
    <>
      <div className={styles.heading}>
        <div>
          <p>Bước 2 / 3 · dữ liệu minh họa</p>
          <h1>Xác nhận mua hàng</h1>
        </div>
        <Scenario value={state} onChange={setState} checkout />
      </div>
      <section className={styles.card} aria-label="Điểm chuyển từ Cart">
        <h2>Từ giỏ hàng sang xác nhận mua</h2>
        <p>Chỉ các Variant được chọn ở giỏ và số lượng tương ứng mới được chuyển sang bước này. Đây là tập chọn cố định minh họa, chưa lấy từ Cart thật.</p>
        <p className={styles.muted}>Nếu giá hoặc kho thay đổi, quay lại Cart để điều chỉnh rồi xem preview mới. Không tự lấy toàn bộ giỏ hoặc đặt riêng cửa hàng còn đủ kho. Điểm chuyển màn Cart của Hiền chưa được nối.</p>
      </section>
      {["loading", "error", "empty"].includes(state) ? (
        <StatePanel state={state} retry={() => setState("ready")} />
      ) : (
        <div className={styles.grid}>
          <div className={styles.stack}>
            <section className={styles.card}>
              <h2>Địa chỉ nhận hàng</h2>
              <strong>{demoAddress.recipient}</strong>
              <p>{demoAddress.phone}</p>
              <p>{demoAddress.line}</p>
              <p className={styles.muted}>
                Chỉ đọc dữ liệu mẫu. Chọn/sửa địa chỉ sẽ nối màn Address của
                Hiền sau.
              </p>
            </section>
            {demoOrders.map((order) => (
              <section className={styles.card} key={order.id}>
                <h2>{order.store}</h2>
                <Line order={order} />
                <p className={styles.muted}>
                  Mỗi cửa hàng sẽ có một đơn riêng; nếu một dòng lỗi, toàn lượt
                  đặt bị chặn.
                </p>
              </section>
            ))}
            <section className={styles.card}>
              <h2>Thanh toán</h2>
              <p>COD — thanh toán khi nhận hàng</p>
              <p className={styles.muted}>
                Phí vận chuyển mô phỏng DEMO_ZERO_V1: 0 đ. Không phải phí vận
                chuyển thật.
              </p>
            </section>
          </div>
          <aside className={styles.card}>
            <h2>Thông tin thanh toán</h2>
            {canCheckout ? (
              <dl className={styles.summary}>
                <dt>Tiền hàng</dt>
                <dd>3.039.000 đ</dd>
                <dt>Vận chuyển mô phỏng</dt>
                <dd>0 đ</dd>
                <dt>Tổng cộng</dt>
                <dd>
                  <strong>3.039.000 đ</strong>
                </dd>
              </dl>
            ) : (
              <div role="alert" className={styles.warning}>
                {state === "price-changed" && (
                  <p>
                    Giá đã thay đổi (PRICE_CHANGED). Cần xem giá mới và xác nhận
                    lại; không tự chấp nhận.
                  </p>
                )}
                {state === "stock-short" && (
                  <p>
                    Không đủ tồn kho (INSUFFICIENT_STOCK). Quay lại giỏ để điều
                    chỉnh số lượng.
                  </p>
                )}
                {state === "unknown" && (
                  <p>
                    Chưa xác định kết quả. Không đặt lại bằng mã mới; cần kiểm
                    tra kết quả của lần gửi trước.
                  </p>
                )}
                <p>
                  Tổng thanh toán chưa được xác nhận. Không thanh toán một phần.
                </p>
              </div>
            )}
            <button
              className={styles.primary}
              disabled={!canCheckout}
              onClick={() => navigate("/dev/buyer-flow/result")}
            >
              Xem kết quả đặt hàng mẫu
            </button>
            <p className={styles.muted}>
              Nút này chỉ đổi màn hình. Không gửi yêu cầu tạo đơn.
            </p>
            {!canCheckout && (
              <button onClick={() => setState("ready")}>
                Đặt lại tình huống minh họa
              </button>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
export function CheckoutResultPreviewPage() {
  const [unknown, setUnknown] = useState(false);
  return (
    <>
      <div className={styles.heading}>
        <h1>Kết quả tạo đơn mẫu</h1>
        <button onClick={() => setUnknown(!unknown)}>
          Minh họa {unknown ? "thành công" : "mất phản hồi"}
        </button>
      </div>
      <section className={styles.card}>
        <div role={unknown ? "alert" : "status"}>
          <h2>{unknown ? "Chưa xác định kết quả" : "Đã tạo 2 đơn minh họa"}</h2>
          <p>
            {unknown
              ? "Không kết luận thất bại chỉ vì mất phản hồi hoặc tra cứu trả 404. Giữ nguyên yêu cầu và mã lần gửi để kiểm tra lại."
              : "Kết quả mẫu chỉ thể hiện bước tạo đơn, không phải xác nhận đã thanh toán hoặc đã giao."}
          </p>
        </div>
        {unknown ? (
          <p className={styles.warning}>
            Bản này không thực hiện tra cứu hay thử lại API. Luồng thật cần đối
            chiếu hữu hạn tối đa 3 lần, rồi cho kiểm tra thủ công.
          </p>
        ) : (
          demoOrders.map((order) => (
            <div className={styles.receipt} key={order.id}>
              <strong>{order.number}</strong>
              <p>{order.store}</p>
              <p>
                Chờ xác nhận · COD chưa thanh toán · {displayMoney(order.total)}
              </p>
              <Link to={`/dev/buyer-flow/orders/${order.id}`}>
                Xem trạng thái mẫu hiện hành
              </Link>
            </div>
          ))
        )}
        <Link className={styles.actionLink} to="/dev/buyer-flow/orders">
          Xem đơn mua mẫu
        </Link>
      </section>
    </>
  );
}
export function BuyerOrdersPreviewPage() {
  const [state, setState] = useState<DemoState>("ready");
  const [filter, setFilter] = useState("ALL");
  const orders = demoOrders.filter(
    (order) => filter === "ALL" || order.status === filter,
  );
  return (
    <>
      <div className={styles.heading}>
        <h1>Đơn mua</h1>
        <Scenario value={state} onChange={setState} />
      </div>
      <label className={styles.scenario}>
        Trạng thái đơn
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">Tất cả</option>
          {Object.entries(statusLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {state !== "ready" || orders.length === 0 ? (
        <StatePanel
          state={state === "ready" ? "empty" : state}
          retry={() => {
            setState("ready");
            setFilter("ALL");
          }}
        />
      ) : (
        <div className={styles.stack}>
          {orders.map((order) => (
            <article className={styles.card} key={order.id}>
              <div className={styles.orderHeading}>
                <h2>{order.store}</h2>
                <span className={styles.badge}>
                  {statusLabels[order.status]}
                </span>
              </div>
              <p>{order.number}</p>
              <Line order={order} />
              <Link
                className={styles.actionLink}
                to={`/dev/buyer-flow/orders/${order.id}`}
              >
                Xem chi tiết đơn mẫu
              </Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function BuyerOrderDetailPreviewPage() {
  const { demoId } = useParams();
  return <BuyerOrderDetailContent key={demoId} demoId={demoId} />;
}
function BuyerOrderDetailContent({ demoId }: { demoId: string | undefined }) {
  const order = demoOrders.find((item) => item.id === demoId);
  const [state, setState] = useState<DemoState>("ready");
  const [notice, setNotice] = useState("");
  if (!order)
    return (
      <section className={styles.card}>
        <h1>Không tìm thấy đơn mẫu</h1>
        <p>ID minh họa không phải ID PostgreSQL.</p>
        <Link to="/dev/buyer-flow/orders">Về danh sách</Link>
      </section>
    );
  return (
    <>
      <div className={styles.heading}>
        <div>
          <Link to="/dev/buyer-flow/orders">← Đơn mua</Link>
          <h1>{order.number}</h1>
        </div>
        <Scenario value={state} onChange={setState} />
      </div>
      {state !== "ready" ? (
        <StatePanel state={state} retry={() => setState("ready")} />
      ) : (
        <div className={styles.grid}>
          <div className={styles.stack}>
            <section className={styles.card}>
              <h2>{statusLabels[order.status]}</h2>
              <p>
                COD:{" "}
                {order.payment === "PAID" ? "Đã thanh toán" : "Chưa thanh toán"}
              </p>
              <p className={styles.muted}>
                Trạng thái thanh toán tách khỏi trạng thái đơn.
              </p>
            </section>
            <section className={styles.card}>
              <h2>{order.store}</h2>
              <Line order={order} />
              <p>Tổng tiền snapshot mẫu: {displayMoney(order.total)}</p>
            </section>
            <section className={styles.card}>
              <h2>Địa chỉ lúc đặt hàng</h2>
              <p>{demoAddress.recipient}</p>
              <p>{demoAddress.line}</p>
              <p className={styles.muted}>
                Luồng thật đọc snapshot đơn; sửa sổ địa chỉ không thay đổi đơn
                cũ.
              </p>
            </section>
            {order.status === "PENDING_CONFIRMATION" && (
              <section className={styles.card}>
                <button
                  onClick={() =>
                    setNotice(
                      "Luồng hủy cần API, lý do và xác nhận trước khi hoàn kho. Bản xem trước không hủy đơn.",
                    )
                  }
                >
                  Xem hướng dẫn hủy đơn
                </button>
                {notice && <p role="status">{notice}</p>}
              </section>
            )}
          </div>
          <section className={styles.card}>
            <h2>Lịch sử đơn mẫu</h2>
            <ol className={styles.timeline}>
              {order.timeline.map((event) => (
                <li key={event.title}>
                  <strong>{event.title}</strong>
                  <p>{event.at}</p>
                </li>
              ))}
            </ol>
            <p className={styles.muted}>
              Chi tiết/timeline API còn chờ triển khai. Không có nút tự đánh dấu
              đã giao cho Buyer/Seller.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
