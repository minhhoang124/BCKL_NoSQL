import { useEffect, useState, type FormEvent } from 'react';
import './App.css';

type Role = 'USER' | 'SELLER' | 'ADMIN';
interface User { id: number; email: string; fullName: string | null; role: Role; isActive: boolean }
interface SessionResponse { user: User; accessToken: string }
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message || `Yêu cầu thất bại (${response.status})`);
  }
  return data;
}

function App() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [message, setMessage] = useState('Đang kiểm tra phiên đăng nhập...');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(readResponse)
      .then((session: SessionResponse) => {
        setUser(session.user); setAccessToken(session.accessToken); setMessage('Đã khôi phục phiên đăng nhập.');
      })
      .catch(() => setMessage('Bạn chưa đăng nhập.'));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('Đang xử lý...');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API_URL}/auth/${mode}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const session = (await readResponse(response)) as SessionResponse;
      setUser(session.user); setAccessToken(session.accessToken);
      setMessage(mode === 'login' ? 'Đăng nhập thành công.' : 'Tạo tài khoản thành công.');
      event.currentTarget.reset();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Có lỗi không xác định.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    setUser(null); setAccessToken(null); setMessage('Đã đăng xuất.'); setBusy(false);
  }

  async function checkPermission(path: string) {
    try {
      const response = await fetch(`${API_URL}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await readResponse(response); setMessage(data.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể kiểm tra quyền.'); }
  }

  return (
    <main className="shell">
      <section className="intro">
        <span className="eyebrow">BCKL · E-COMMERCE</span>
        <h1>Nền tảng mua sắm và tìm kiếm đa phương thức</h1>
        <p>Module đầu tiên xác thực người dùng, Seller và Admin bằng JWT cùng PostgreSQL.</p>
        <div className="architecture"><span>React</span><b>→</b><span>NestJS</span><b>→</b><span>PostgreSQL</span></div>
      </section>
      <section className="card">
        {user ? (
          <div className="profile">
            <span className="success">Phiên đang hoạt động</span><h2>{user.fullName || user.email}</h2><p>{user.email}</p>
            <dl><div><dt>Vai trò</dt><dd>{user.role}</dd></div><div><dt>ID</dt><dd>#{user.id}</dd></div></dl>
            <div className="actions">
              {user.role === 'SELLER' && <button onClick={() => checkPermission('seller/test')}>Kiểm tra quyền Seller</button>}
              {user.role === 'ADMIN' && <button onClick={() => checkPermission('admin/test')}>Kiểm tra quyền Admin</button>}
              <button className="secondary" onClick={logout} disabled={busy}>Đăng xuất</button>
            </div>
          </div>
        ) : (
          <>
            <div className="tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Đăng nhập</button><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Đăng ký</button></div>
            <form onSubmit={submit}>
              {mode === 'register' && <label>Họ và tên<input name="fullName" minLength={2} maxLength={100} required /></label>}
              <label>Email<input name="email" type="email" autoComplete="email" required /></label>
              <label>Mật khẩu<input name="password" type="password" minLength={8} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
              {mode === 'register' && <label>Loại tài khoản<select name="accountType" defaultValue="USER"><option value="USER">Người mua</option><option value="SELLER">Người bán</option></select></label>}
              <button className="primary" disabled={busy}>{busy ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
            </form>
          </>
        )}
        <p className="message" aria-live="polite">{message}</p>
      </section>
    </main>
  );
}

export default App;
