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
            <span className={styles.perkIcon} aria-hidden="true">🎁</span>
            <div>
              <strong>Voucher 120.000₫ cho đơn hàng đầu tiên</strong>
              <span>Áp dụng mọi ngành hàng Thời trang, Công nghệ &amp; Gia dụng</span>
            </div>
          </div>
          <div className={styles.perkItem}>
            <span className={styles.perkIcon} aria-hidden="true">🚚</span>
            <div>
              <strong>Freeship 0Đ toàn quốc mọi đơn từ 99K</strong>
              <span>Giao nhanh hỏa tốc SPX Express chỉ trong 2 giờ</span>
            </div>
          </div>
          <div className={styles.perkItem}>
            <span className={styles.perkIcon} aria-hidden="true">🛡️</span>
            <div>
              <strong>Đổi trả miễn phí 7 ngày &amp; Hoàn tiền 100%</strong>
              <span>Trọng tài sàn bảo vệ quyền lợi người mua tuyệt đối</span>
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
