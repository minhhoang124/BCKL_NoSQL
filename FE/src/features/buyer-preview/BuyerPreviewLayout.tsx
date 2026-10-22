import { Link, NavLink, Outlet } from "react-router-dom";
import styles from "./BuyerPreview.module.css";

export function BuyerPreviewLayout() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/dev/buyer-flow/checkout" className={styles.logo}>
          BCKL
        </Link>
        <span>Khu vực xem trước Checkout / Đơn hàng</span>
        <Link to="/">Về website</Link>
      </header>
      <main className={styles.main}>
        <aside className={styles.notice} aria-label="Giới hạn bản minh họa">
          <strong>BẢN MINH HỌA — KHÔNG ĐẶT ĐƠN THẬT</strong>
          <p>
            Dữ liệu mẫu cố định. Không gọi Checkout/Order API, không trừ kho,
            không thu tiền. Các trạng thái bên dưới phục vụ duyệt giao diện,
            không chứng minh nghiệp vụ đã chạy.
          </p>
        </aside>
        <nav className={styles.tabs} aria-label="Màn hình minh họa">
          <NavLink to="/dev/buyer-flow/checkout">Xác nhận mua</NavLink>
          <NavLink to="/dev/buyer-flow/result">Kết quả tạo đơn</NavLink>
          <NavLink to="/dev/buyer-flow/orders">Đơn mua</NavLink>
        </nav>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        Address/Cart UI do Hiền phụ trách. Bản này chỉ chuẩn bị màn
        Checkout/Order của Hoàng.
      </footer>
    </div>
  );
}
