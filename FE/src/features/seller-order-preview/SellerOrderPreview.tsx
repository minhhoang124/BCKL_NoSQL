import { createContext, useContext, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { displayMoney } from '../buyer-preview/fixtures';
import styles from '../buyer-preview/BuyerPreview.module.css';

type Status = 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'PACKING' | 'READY_TO_SHIP' | 'SHIPPING';
type ViewState = 'ready' | 'loading' | 'error' | 'empty';
type Command = 'confirm' | 'start-packing' | 'ready-to-ship';
interface PreviewOrder {
  id: string;
  number: string;
  product: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  total: string;
  status: Status;
  history: readonly string[];
}
const labels: Record<Status, string> = {
  PENDING_CONFIRMATION: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  PACKING: 'Đang đóng gói',
  READY_TO_SHIP: 'Sẵn sàng bàn giao',
  SHIPPING: 'Đang giao mô phỏng',
};
const steps: Partial<Record<Status, { command: Command; target: Status; label: string }>> = {
  PENDING_CONFIRMATION: { command: 'confirm', target: 'CONFIRMED', label: 'Xác nhận đơn mẫu' },
  CONFIRMED: { command: 'start-packing', target: 'PACKING', label: 'Bắt đầu đóng gói mẫu' },
  PACKING: { command: 'ready-to-ship', target: 'READY_TO_SHIP', label: 'Đã đóng gói mẫu' },
};
function fixtures(): PreviewOrder[] {
  return [
    { id: 'seller-demo-pending', number: 'DEMO-SELLER-001', product: 'Tai nghe không dây · mẫu', sku: 'DEMO-SKU-A', quantity: 2, unitPrice: '100000.00', total: '200000.00', status: 'PENDING_CONFIRMATION', history: ['Đơn mẫu được tạo'] },
    { id: 'seller-demo-packing', number: 'DEMO-SELLER-002', product: 'Loa để bàn · mẫu', sku: 'DEMO-SKU-B', quantity: 1, unitPrice: '200000.00', total: '200000.00', status: 'PACKING', history: ['Đơn mẫu được tạo', 'Đã xác nhận mẫu', 'Đang đóng gói mẫu'] },
    { id: 'seller-demo-shipping', number: 'DEMO-SELLER-003', product: 'Cáp sạc · mẫu', sku: 'DEMO-SKU-C', quantity: 1, unitPrice: '50000.00', total: '50000.00', status: 'SHIPPING', history: ['Đơn mẫu được tạo', 'Admin giao mô phỏng — fixture'] },
  ];
}
interface Session {
  orders: PreviewOrder[];
  generation: number;
  advance: (id: string, command: Command) => void;
  reset: () => void;
}
const PreviewContext = createContext<Session | null>(null);
function usePreview() {
  const value = useContext(PreviewContext);
  if (!value) throw new Error('Seller preview provider missing');
  return value;
}
export function SellerOrderPreviewLayout() {
  const [orders, setOrders] = useState(fixtures);
  const [generation, setGeneration] = useState(0);
  const session: Session = {
    orders,
    generation,
    reset: () => { setOrders(fixtures()); setGeneration((current) => current + 1); },
    advance: (id, command) => setOrders((current) => current.map((order) => {
      const step = steps[order.status];
      // Local display only. Revalidate source status even if a stale UI attempts the command.
      return order.id === id && step?.command === command
        ? { ...order, status: step.target, history: [...order.history, `${labels[step.target]} · chỉ trong phiên mẫu`] }
        : order;
    })),
  };
  return <PreviewContext.Provider value={session}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.logo} to="/dev/seller-orders">BCKL</Link>
        <span>Kênh người bán · BCKL Audio mẫu</span>
        <Link to="/">Về website</Link>
      </header>
      <main className={styles.main}>
        <aside className={styles.notice} aria-label="Giới hạn Seller preview">
          <strong>SELLER DEMO — KHÔNG XỬ LÝ ĐƠN THẬT</strong>
          <p>Một Store mẫu. Không gọi API, không trừ/hoàn kho hoặc đổi đơn PostgreSQL.
            Trạng thái chỉ giữ trong bộ nhớ, tải lại trang sẽ mất.</p>
        </aside>
        <nav className={styles.tabs} aria-label="Seller demo">
          <NavLink end to="/dev/seller-orders">Đơn của Store mẫu</NavLink>
          <Link to="/dev/buyer-flow/checkout">Buyer preview độc lập</Link>
        </nav>
        <button onClick={session.reset}>Khôi phục tất cả đơn mẫu</button>
        <Outlet />
      </main>
      <footer className={styles.footer}>Seller chuẩn bị hàng; Admin/adapter giao mô phỏng. Không phải dữ liệu Buyer preview được đồng bộ.</footer>
    </div>
  </PreviewContext.Provider>;
}
function StateChoice({ value, change }: { value: ViewState; change: (state: ViewState) => void }) {
  return <label className={styles.scenario}>Tình huống Seller mẫu
    <select value={value} onChange={(e) => change(e.target.value as ViewState)}>
      <option value="ready">Có dữ liệu</option><option value="loading">Đang tải</option>
      <option value="error">Lỗi tải thông tin</option><option value="empty">Không có dữ liệu</option>
    </select>
  </label>;
}
function StatePanel({ state, retry }: { state: ViewState; retry: () => void }) {
  return <section className={styles.card} role={state === 'error' ? 'alert' : 'status'}>
    <h2>{state === 'loading' ? 'Đang tải đơn mẫu…' : state === 'error' ? 'Chưa tải được đơn mẫu' : 'Chưa có đơn trong lựa chọn này'}</h2>
    {state !== 'loading' && <button onClick={retry}>Xem lại dữ liệu Seller mẫu</button>}
  </section>;
}
export function SellerOrdersPreviewPage() {
  const { orders } = usePreview();
  const [state, setState] = useState<ViewState>('ready');
  const [filter, setFilter] = useState('ALL');
  const visible = orders.filter((order) => filter === 'ALL' || order.status === filter);
  return <>
    <div className={styles.heading}><h1>Quản lý đơn hàng mẫu</h1><StateChoice value={state} change={setState} /></div>
    <label className={styles.scenario}>Trạng thái Seller
      <select value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="ALL">Tất cả</option>
        {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {state !== 'ready' || visible.length === 0
      ? <StatePanel state={state === 'ready' ? 'empty' : state} retry={() => { setState('ready'); setFilter('ALL'); }} />
      : <div className={styles.stack}>{visible.map((order) => <article key={order.id} className={styles.card}>
        <div className={styles.orderHeading}><h2>{order.number}</h2><span className={styles.badge}>{labels[order.status]}</span></div>
        <p>{order.product} · {order.quantity} sản phẩm</p>
        <p>COD chưa thanh toán · {displayMoney(order.total)}</p>
        <Link to={`/dev/seller-orders/${order.id}`} className={styles.actionLink}>Xem chi tiết {order.number}</Link>
      </article>)}</div>}
  </>;
}
export function SellerOrderDetailPreviewPage() {
  const { demoId } = useParams();
  const { generation } = usePreview();
  // Keyed content prevents state/errors/confirmation leaking to a different order on navigation.
  return <Detail key={`${demoId}:${generation}`} id={demoId} />;
}
function Detail({ id }: { id: string | undefined }) {
  const { orders, advance } = usePreview();
  const order = orders.find((item) => item.id === id);
  const [state, setState] = useState<ViewState>('ready');
  const [pending, setPending] = useState<Command | null>(null);
  const [fail, setFail] = useState(false);
  const [notice, setNotice] = useState('');
  if (!order) return <section className={styles.card}><h1>Không tìm thấy đơn Seller mẫu</h1><Link to="/dev/seller-orders">Về danh sách Seller mẫu</Link></section>;
  const step = steps[order.status];
  const execute = () => {
    if (!pending || !step || step.command !== pending || state !== 'ready') return;
    if (fail) { setNotice('Lỗi mô phỏng trước thao tác: trạng thái đơn mẫu chưa đổi. Bỏ chọn lỗi rồi xác nhận lại. Không có request thật.'); return; }
    advance(order.id, pending);
    setPending(null);
    setNotice('Đã đổi trạng thái trong phiên mẫu; database và tồn kho không thay đổi.');
  };
  return <>
    <div className={styles.heading}><div><Link to="/dev/seller-orders">← Đơn của Store mẫu</Link><h1>{order.number}</h1></div><StateChoice value={state} change={(next) => { setState(next); setPending(null); setNotice(''); }} /></div>
    {state !== 'ready' ? <StatePanel state={state} retry={() => setState('ready')} /> : <div className={styles.grid}>
      <div className={styles.stack}>
        <section className={styles.card}><h2>{labels[order.status]}</h2><p>COD: chưa thanh toán</p><p>Không tính đây là doanh thu đã hoàn tất.</p></section>
        <section className={styles.card}><h2>Hàng cần chuẩn bị — snapshot mẫu</h2><strong>{order.product}</strong><p>SKU: {order.sku} · Màu đen · Số lượng: {order.quantity}</p><p>{displayMoney(order.unitPrice)} × {order.quantity}</p><p>Tổng: {displayMoney(order.total)} · phí giao demo: 0 đ</p></section>
        <section className={styles.card}><h2>Thông tin giao hàng mẫu</h2><p>Người nhận mẫu · Số điện thoại minh họa</p><p>Phường mẫu · Thành phố mẫu · Địa chỉ mẫu</p><p className={styles.muted}>Khi nối API chỉ Seller đúng Store mới được đọc dữ liệu giao hàng cần thiết.</p></section>
        <section className={styles.card}><h2>Xử lý mẫu</h2>
          {step ? <>
            <p>Kiểm tra đúng SKU/số lượng trước bước tiếp theo. Bản này không xác thực kho thật.</p>
            <label><input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} /> Minh họa lỗi trước thao tác</label>
            <button className={styles.primary} disabled={pending !== null} onClick={() => { setPending(step.command); setNotice(''); }}>{step.label}</button>
          </> : <p>{order.status === 'READY_TO_SHIP' ? 'Đã sẵn sàng bàn giao. Chờ Admin/adapter mô phỏng vận chuyển; Seller không tự đánh dấu đã giao.' : 'Đơn đang giao mô phỏng; Seller không được đánh dấu đã giao hoặc hoàn tất.'}</p>}
          {pending && step && <section className={styles.warning} aria-label="Xác nhận thao tác mẫu">
            <h3>Xác nhận {step.label.toLowerCase()}?</h3><p>Chỉ thay đổi hiển thị, không gọi API.</p>
            <button onClick={execute}>Đồng ý đổi trạng thái mẫu</button>{' '}
            <button onClick={() => { setPending(null); setNotice(''); }}>Bỏ qua thao tác mẫu</button>
          </section>}
          {notice && <p role={fail && pending ? 'alert' : 'status'}>{notice}</p>}
          <p className={styles.muted}>Hủy, hoàn kho và giao thất bại chờ API/kiểm thử riêng; chưa có nút thực hiện.</p>
        </section>
      </div>
      <section className={styles.card}><h2>Lịch sử phiên mẫu</h2><ol className={styles.timeline}>{order.history.map((event, index) => <li key={`${index}-${event}`}>{event}</li>)}</ol></section>
    </div>}
  </>;
}
