import styles from './Loading.module.css';

export function Loading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={fullScreen ? styles.fullScreen : styles.container}>
      <div className={styles.spinner} aria-label="Đang tải..." role="status"></div>
    </div>
  );
}
