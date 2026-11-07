import type { ReactNode } from 'react';
import { ChatBubbleLeftRightIcon, MagnifyingGlassIcon, TruckIcon } from '@heroicons/react/24/outline';
import styles from './AuthLayout.module.css';

/** Presentation only: forms retain their own handlers, validation and auth flow. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <section className={styles.layout}>
      <aside className={styles.intro}>
        <p className={styles.eyebrow}>BCKL · Chợ hiện đại</p>
        <h2>Mua sắm từ nhiều cửa hàng trong một tài khoản.</h2>
        <ul className={styles.perks}>
          <li className={styles.perkItem}>
            <MagnifyingGlassIcon className={styles.perkIcon} aria-hidden="true" />
            <div>
              <strong>Tìm sản phẩm bằng chữ hoặc hình ảnh</strong>
              <span>Lọc theo danh mục, thương hiệu và hàng còn sẵn</span>
            </div>
          </li>
          <li className={styles.perkItem}>
            <ChatBubbleLeftRightIcon className={styles.perkIcon} aria-hidden="true" />
            <div>
              <strong>Trao đổi trực tiếp với cửa hàng</strong>
              <span>Hỏi về sản phẩm hoặc đơn hàng ngay trong tin nhắn</span>
            </div>
          </li>
          <li className={styles.perkItem}>
            <TruckIcon className={styles.perkIcon} aria-hidden="true" />
            <div>
              <strong>Theo dõi đơn hàng trên tài khoản</strong>
              <span>Xem trạng thái xác nhận, đóng gói và giao hàng của từng đơn</span>
            </div>
          </li>
        </ul>
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
