import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.policies}>
          <span>CHÍNH SÁCH BẢO MẬT</span>
          <span className={styles.divider}>·</span>
          <span>ĐIỀU KHOẢN DỊCH VỤ</span>
          <span className={styles.divider}>·</span>
          <span>QUY CHẾ HOẠT ĐỘNG SÀN</span>
          <span className={styles.divider}>·</span>
          <span>TRỌNG TÀI TRANH CHẤP</span>
          <span className={styles.divider}>·</span>
          <span>CHÍNH SÁCH TRẢ HÀNG &amp; HOÀN TIỀN</span>
        </div>

        <div className={styles.columns}>
          <div className={styles.col}>
            <strong>BCKL · CHỢ HIỆN ĐẠI (NOEL 2026)</strong>
            <p>Khám phá những lựa chọn yêu thích cho cuộc sống mỗi ngày.</p>
          </div>
          <div className={styles.col}>
            <strong>THANH TOÁN</strong>
            <div className={styles.badges}>
              <span className={styles.badge}>Thanh toán khi nhận hàng</span>
              <span className={styles.badge}>VNPay</span>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <p>&copy; 2026 BCKL E-Commerce. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
