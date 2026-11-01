// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordPage } from './ChangePasswordPage';
import { ApiError, AuthSessionChangedError } from '../services/apiClient';
import { saveBinding, loadBinding } from '../features/account-settings/passwordChangeBinding';

const session = vi.hoisted(() => ({ version: 1 }));
vi.mock('../services/apiClient', async load => ({
  ...(await load<typeof import('../services/apiClient')>()),
  getAuthSessionVersion: () => session.version,
}));

const TOKEN = 'A'.repeat(43);
const BINDING = 'B'.repeat(43);
const mocks = vi.hoisted(() => ({
  user: { id: 7, email: 'qa@example.invalid', fullName: 'QA', role: 'USER', isActive: true } as Record<string, unknown> | null,
  loading: false,
  verify: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('../contexts/useAuth', () => ({ useAuth: () => ({ user: mocks.user, loading: mocks.loading }) }));
vi.mock('../services/passwordChangeEmailApi', async load => ({
  ...(await load<typeof import('../services/passwordChangeEmailApi')>()),
  verifyPasswordChangeLink: mocks.verify,
  confirmPasswordChange: mocks.confirm,
}));

function LoginProbe() {
  const location = useLocation();
  return <p data-testid="login">{String((location.state as { accountNotice?: string } | null)?.accountNotice)}</p>;
}
function open(hash = `#token=${TOKEN}`) {
  window.history.replaceState(null, '', '/account/change-password' + hash);
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/account/change-password']}>
        <Routes>
          <Route path="/account/change-password" element={<ChangePasswordPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}
const future = () => new Date(Date.now() + 10 * 60000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  session.version = 1;
  window.localStorage.clear();
  mocks.user = { id: 7, email: 'qa@example.invalid', fullName: 'QA', role: 'USER', isActive: true };
  mocks.loading = false;
  mocks.verify.mockResolvedValue({ expiresAt: future() });
  mocks.confirm.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('BUY-02 ChangePasswordPage', () => {
  it('removes the token from the address bar and verifies exactly once (StrictMode)', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    open();
    expect(window.location.hash).toBe('');
    expect(await screen.findByLabelText('Mật khẩu mới')).toBeInTheDocument();
    expect(mocks.verify).toHaveBeenCalledWith(TOKEN, BINDING, expect.anything());
    // StrictMode mounts effects twice; one key may start at most one verify request.
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('asks for the original browser when this browser holds no binding, without calling the API', async () => {
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('đúng trình duyệt đã gửi yêu cầu');
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('asks to sign in (no redirect carrying the token) when signed out', async () => {
    mocks.user = null;
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('đăng nhập');
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('treats a link without a valid token as incomplete', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    open('#token=short');
    expect(await screen.findByRole('alert')).toHaveTextContent('không đầy đủ');
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('an old invalid link ends that challenge but keeps the binding of a newer request', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    mocks.verify.mockRejectedValue(new ApiError('x', 400, 'EMAIL_TOKEN_INVALID'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('đã hết hạn');
    expect(loadBinding(7)).toBe(BINDING);
  });
  it('ignores a confirm result that arrives after the session changed', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    let release!: () => void;
    mocks.confirm.mockReturnValue(new Promise<void>(done => { release = done; }));
    open();
    fireEvent.change(await screen.findByLabelText('Mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Đổi mật khẩu/ }));
    session.version = 2;
    release();
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });
  it('a late successful confirm does not erase a newer request binding (compare-and-delete)', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    let release!: () => void;
    mocks.confirm.mockReturnValue(new Promise<void>(done => { release = done; }));
    open();
    fireEvent.change(await screen.findByLabelText('Mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Đổi mật khẩu/ }));
    const NEWER = 'N'.repeat(43);
    saveBinding(7, { bindingSecret: NEWER, expiresAt: future() }); // another tab requested again
    release();
    await screen.findByTestId('login');
    expect(loadBinding(7)).toBe(NEWER);
  });
  it('treats AuthSessionChangedError on confirm as not ours: no redirect, no retry', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    mocks.confirm.mockRejectedValue(new AuthSessionChangedError());
    open();
    fireEvent.change(await screen.findByLabelText('Mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Đổi mật khẩu/ }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });
  it('shows the other-browser message on 409', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    mocks.verify.mockRejectedValue(new ApiError('x', 409, 'PASSWORD_CHANGE_OTHER_BROWSER'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('đúng trình duyệt');
  });
  it('confirms once for a double submit, clears the binding and asks to sign in again', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    let release!: () => void;
    mocks.confirm.mockReturnValue(new Promise<void>(done => { release = done; }));
    open();
    fireEvent.change(await screen.findByLabelText('Mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    const form = screen.getByRole('button', { name: /Đổi mật khẩu/ }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(TOKEN, BINDING, 'NewPassword123!', expect.anything());
    release();
    expect(await screen.findByTestId('login')).toHaveTextContent('password-changed');
    expect(loadBinding(7)).toBeNull();
  });
  it('keeps the form for PASSWORD_UNCHANGED', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    mocks.confirm.mockRejectedValue(new ApiError('x', 400, 'PASSWORD_UNCHANGED'));
    open();
    fireEvent.change(await screen.findByLabelText('Mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Đổi mật khẩu/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('khác mật khẩu hiện tại');
    expect(screen.getByLabelText('Mật khẩu mới')).toBeInTheDocument();
  });
  it('never resends after an uncertain 503: goes to login with password-unknown', async () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    mocks.confirm.mockRejectedValue(new ApiError('x', 503, 'AUTH_EMAIL_CONFIRM_UNCERTAIN'));
    open();
    fireEvent.change(await screen.findByLabelText('Mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /Đổi mật khẩu/ }));
    expect(await screen.findByTestId('login')).toHaveTextContent('password-unknown');
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  });
});

describe('passwordChangeBinding', () => {
  it('drops expired or malformed bindings', () => {
    saveBinding(7, { bindingSecret: BINDING, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(loadBinding(7)).toBeNull();
    window.localStorage.setItem('bckl.passwordChangeBinding.7', JSON.stringify({ bindingSecret: 'x', expiresAt: future() }));
    expect(loadBinding(7)).toBeNull();
    saveBinding(7, { bindingSecret: BINDING, expiresAt: future() });
    expect(loadBinding(8)).toBeNull();
    expect(loadBinding(7)).toBe(BINDING);
  });
});
