// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../../pages/LoginPage';
import { AccountSettings } from './AccountSettings';
import { ApiError } from '../../services/apiClient';
const mocks = vi.hoisted(() => ({ updateProfile: vi.fn(), changePassword: vi.fn(), apply: vi.fn(), end: vi.fn(), version: 1,
  user: { id: 1, email: 'a@example.test', fullName: 'Name Alpha', role: 'USER' as 'USER' | 'SELLER' | 'ADMIN', isActive: true } }));
vi.mock('../../contexts/useAuth', () => ({ useAuth: () => ({ user: mocks.user, applyProfile: mocks.apply, endSession: mocks.end }) }));
vi.mock('../../services/accountSettingsApi', () => ({ updateProfile: mocks.updateProfile, changePassword: mocks.changePassword }));
vi.mock('../../services/apiClient', async load => ({ ...await load<typeof import('../../services/apiClient')>(), getAuthSessionVersion: () => mocks.version }));
const tree = () => <StrictMode><MemoryRouter initialEntries={['/account']}><Routes><Route path="/account" element={<AccountSettings />} /><Route path="/login" element={<LoginPage />} /></Routes></MemoryRouter></StrictMode>;
const passwordFields = () => {
  fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), { target: { value: 'CurrentPass123!' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'NextPassword123!' } });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), { target: { value: 'NextPassword123!' } });
};
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((yes,no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.clearAllMocks(); mocks.version = 1; mocks.user = { id: 1, email: 'a@example.test', fullName: 'Name Alpha', role: 'USER', isActive: true }; });
afterEach(cleanup);
describe('Account settings workflow', () => {
  it('renders no write request on mount/StrictMode or reload', () => { render(tree()); expect(mocks.changePassword).not.toHaveBeenCalled(); expect(mocks.updateProfile).not.toHaveBeenCalled(); });
  it('sends profile once for same-tick double submit and keeps session identity', async () => {
    const pending = deferred<typeof mocks.user>(); mocks.updateProfile.mockReturnValue(pending.promise); render(tree());
    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'New Name' } });
    const form = screen.getByRole('button', { name: 'Lưu hồ sơ' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form); expect(mocks.updateProfile).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ...mocks.user, fullName: 'New Name' }));
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'New Name' }), 1); expect(mocks.end).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Đã lưu');
  });
  it('keeps draft and locks both forms after 409; never silently retries', async () => {
    mocks.updateProfile.mockRejectedValue(new ApiError('Stale profile',409)); render(tree());
    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'My Draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Stale profile'); expect(screen.getByLabelText('Tên hiển thị')).toHaveValue('My Draft'); expect(screen.getByRole('button',{name:'Lưu hồ sơ'})).toBeDisabled(); expect(mocks.updateProfile).toHaveBeenCalledTimes(1);
  });
  it('unknown profile failure keeps draft locked and does not claim success', async () => {
    mocks.updateProfile.mockRejectedValue(new TypeError('network')); render(tree()); fireEvent.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa rõ kết quả'); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('rejects mismatching or UTF8-over72 passwords before HTTP', async () => {
    render(tree()); passwordFields(); fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'é'.repeat(37) } });
    fireEvent.submit(screen.getByRole('button', { name: 'Đổi mật khẩu và đăng nhập lại' }).closest('form')!); expect(await screen.findByRole('alert')).toHaveTextContent('72 byte'); expect(mocks.changePassword).not.toHaveBeenCalled();
  });
  it('password success sends once, clears only owning session and navigates with no password stored', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem'); const pending = deferred<void>(); mocks.changePassword.mockReturnValue(pending.promise); render(tree()); passwordFields();
    const form = screen.getByRole('button', { name: 'Đổi mật khẩu và đăng nhập lại' }).closest('form')!; fireEvent.submit(form); fireEvent.submit(form);
    expect(mocks.changePassword).toHaveBeenCalledTimes(1); await act(async () => pending.resolve());
    expect(screen.getByRole('status')).toHaveTextContent('Đã đổi mật khẩu'); expect(mocks.end).toHaveBeenCalledWith(1); expect(storage).not.toHaveBeenCalled(); storage.mockRestore();
  });
  it('lost password response ends owning local session without auto retry', async () => {
    mocks.changePassword.mockRejectedValue(new DOMException('timeout','TimeoutError')); render(tree()); passwordFields(); fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu và đăng nhập lại' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa rõ kết quả đổi mật khẩu'); expect(mocks.end).toHaveBeenCalledWith(1); expect(mocks.changePassword).toHaveBeenCalledTimes(1);
  });
  it('400 keeps current session and allows deliberate corrected request', async () => {
    mocks.changePassword.mockRejectedValue(new ApiError('Wrong password',400)); render(tree()); passwordFields(); fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu và đăng nhập lại' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password'); expect(mocks.end).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Đổi mật khẩu và đăng nhập lại' })).toBeEnabled();
  });
  it('401 requires reauthentication without retrying a write', async () => {
    mocks.changePassword.mockRejectedValue(new ApiError('Expired',401)); render(tree()); passwordFields(); fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu và đăng nhập lại' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Phiên đăng nhập đã hết hiệu lực'); await waitFor(() => expect(mocks.end).toHaveBeenCalledWith(1)); expect(mocks.changePassword).toHaveBeenCalledTimes(1);
  });
  it.each(['profile','password'])('late %s response cannot mutate or logout next account', async kind => {
    const pending = deferred<unknown>(); mocks.updateProfile.mockReturnValue(pending.promise); mocks.changePassword.mockReturnValue(pending.promise); const view = render(tree());
    if (kind === 'password') passwordFields(); fireEvent.click(screen.getByRole('button', { name: kind === 'password' ? 'Đổi mật khẩu và đăng nhập lại' : 'Lưu hồ sơ' }));
    mocks.version = 2; mocks.user = { ...mocks.user, id: 2, email: 'b@example.test', fullName: 'Name Beta' }; view.rerender(tree());
    await act(async () => pending.resolve(kind === 'password' ? undefined : { ...mocks.user, id: 1 }));
    expect(mocks.end).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled(); expect(screen.getByLabelText('Tên hiển thị')).toHaveValue('Name Beta');
  });
});
