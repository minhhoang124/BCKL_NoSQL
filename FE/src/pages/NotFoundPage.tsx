import { StateCard } from '../components/StateCard/StateCard';
import styles from './NotFoundPage.module.css';

/** ui-orange-v1 / 18-states: shared state card. */
export function NotFoundPage() {
  return (
    <div className={styles.wrap}>
      <StateCard title="Không tìm thấy trang" action={{ label: 'Quay lại trang chủ', to: '/' }} primary>
        <p>Trang bạn yêu cầu không tồn tại hoặc đã được di chuyển.</p>
      </StateCard>
    </div>
  );
}
