import type { ReactNode } from 'react';
import styles from './AuthLayout.module.css';

/** Presentation only: forms retain their own handlers, validation and auth flow. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <section className={styles.layout}>
      <aside className={styles.intro}>
        <div className={styles.eyebrowRow}>
          <span className={styles.festiveBadge}>🎄 MÙA LỄ HỘI NOEL 2026</span>
          <p className={styles.eyebrow}>BCKL · Chợ hiện đại</p>
        </div>
        <h2>
          Đại tiệc Giáng Sinh —<br />
          <span>Mua sắm theo cách của bạn.</span>
        </h2>
        <p className={styles.lead}>
          Những món quà ý nghĩa cho người thân và những lựa chọn dành riêng cho bạn.
        </p>

        <div className={styles.perks}>
          <div className={styles.perkItem}>
            <span className={styles.perkIcon} aria-hidden="true">🔎</span>
            <div>
              <strong>Tìm sản phẩm bằng chữ hoặc hình ảnh</strong>
              <span>Lọc theo danh mục, thương hiệu và hàng còn sẵn</span>
            </div>
          </div>
          <div className={styles.perkItem}>
            <span className={styles.perkIcon} aria-hidden="true">💬</span>
            <div>
              <strong>Trao đổi trực tiếp với cửa hàng</strong>
              <span>Hỏi về sản phẩm hoặc đơn hàng ngay trong tin nhắn</span>
            </div>
          </div>
          <div className={styles.perkItem}>
            <span className={styles.perkIcon} aria-hidden="true">📦</span>
            <div>
              <strong>Theo dõi đơn hàng ngay trên tài khoản</strong>
              <span>Xem trạng thái xác nhận, đóng gói và giao hàng của từng đơn</span>
            </div>
          </div>
        </div>

        <img
          className={styles.artwork}
          src="/images/auth-shopping-v1.webp"
          width="1000"
          height="667"
          alt=""
        />
      </aside>
      {children}
    </section>
  );
}
