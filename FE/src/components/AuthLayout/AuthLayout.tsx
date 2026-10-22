import type { ReactNode } from 'react';
import styles from './AuthLayout.module.css';

/** Presentation only: forms retain their own handlers, validation and auth flow. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return <section className={styles.layout}>
    <aside className={styles.intro}>
      <p className={styles.eyebrow}>BCKL · Chợ hiện đại</p>
      <h2>Mua sắm theo cách<br /><span>của bạn.</span></h2>
      <p>Tìm sản phẩm phù hợp, quản lý đơn mua và theo dõi hành trình giao hàng trên cùng một nền tảng.</p>
      <p className={styles.note}>Khám phá bằng từ khóa và hình ảnh.</p>
      <img className={styles.artwork} src="/images/auth-shopping-v1.webp" width="1000" height="667" alt="" />
    </aside>
    {children}
  </section>;
}
