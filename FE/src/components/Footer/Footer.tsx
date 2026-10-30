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
            <p>Nền tảng thương mại điện tử đa ngành hàng tích hợp tìm kiếm lai ngữ nghĩa &amp; thị giác AI CLIP/FAISS.</p>
            <p>Địa chỉ: 140 Lê Trọng Tấn, Phường Tây Thạnh, Quận Tân Phú, TP. Hồ Chí Minh</p>
          </div>
          <div className={styles.col}>
            <strong>THANH TOÁN &amp; VẬN CHUYỂN</strong>
            <div className={styles.badges}>
              <span className={styles.badge}>VNPay QR</span>
              <span className={styles.badge}>COD Đồng Kiểm</span>
              <span className={styles.badge}>SPX Express</span>
              <span className={styles.badge}>GHN / GHTK</span>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <p>&copy; 2026 BCKL E-Commerce — Đề án Khóa luận Tốt nghiệp Đại học Công Thương TP.HCM (HUIT). All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
