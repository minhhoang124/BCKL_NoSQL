import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
      <h1>404 - Không tìm thấy trang</h1>
      <p>Trang bạn yêu cầu không tồn tại.</p>
      <Link to="/" style={{ color: '#09f', textDecoration: 'none' }}>Quay lại trang chủ</Link>
    </div>
  );
}
