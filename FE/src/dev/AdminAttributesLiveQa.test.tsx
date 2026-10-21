// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/useAuth';
import type { User } from '../types/auth';
import { AdminAttributesLiveQa } from './AdminAttributesLiveQa';

const admin: User = { id: 71, email: 'qa-admin@example.invalid', fullName: 'QA Admin', role: 'ADMIN', isActive: true };
function setup(user: User | null = admin, loading = false) {
  const api = { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), detail: vi.fn(), options: vi.fn() };
  const logout = vi.fn().mockResolvedValue(undefined);
  render(<MemoryRouter><AuthContext.Provider value={{ user, loading, login: vi.fn(), logout, refresh: vi.fn() }}><AdminAttributesLiveQa api={api} /></AuthContext.Provider></MemoryRouter>);
  return { api, logout };
}
afterEach(cleanup);
describe('DEV live QA boundary (component mocks, not live HTTP)', () => {
  it('guest uses the existing login form without a synthetic Admin or GET', () => {
    const { api } = setup(null); expect(screen.getByLabelText('Mật khẩu')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mở bộ đọc thật' })).not.toBeInTheDocument(); expect(api.list).not.toHaveBeenCalled();
  });
  it('does not read while the real auth provider is restoring a session', () => {
    const { api } = setup(null, true); expect(screen.getByRole('status')).toHaveTextContent('Đang kiểm tra phiên'); expect(api.list).not.toHaveBeenCalled();
  });
  it.each(['USER', 'SELLER'] as const)('does not request Attributes for %s', role => {
    const { api } = setup({ ...admin, role }); expect(screen.getByRole('alert')).toHaveTextContent('Cần tài khoản Admin'); expect(api.list).not.toHaveBeenCalled();
  });
  it('does not read for an inactive Admin', () => {
    const { api } = setup({ ...admin, isActive: false }); expect(api.list).not.toHaveBeenCalled(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('does not guess a Category ID or fetch before explicit configuration', () => {
    const { api } = setup(); expect(screen.getByLabelText('Category ID QA')).toHaveValue(''); expect(api.list).not.toHaveBeenCalled();
  });
  it('validates IDs and page bounds before any network adapter call', () => {
    const { api } = setup(); fireEvent.change(screen.getByLabelText('Category ID QA'), { target: { value: '2147483648' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mở bộ đọc thật' })); expect(screen.getByRole('alert')).toHaveTextContent('Category ID'); expect(api.list).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Category ID QA'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Cỡ trang QA'), { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mở bộ đọc thật' })); expect(api.list).not.toHaveBeenCalled();
  });
  it('mounts the existing reader using configured numeric IDs and no write controls', async () => {
    const { api } = setup(); fireEvent.change(screen.getByLabelText('Category ID QA'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mở bộ đọc thật' })); await screen.findByText('Không có thuộc tính phù hợp.');
    expect(api.list).toHaveBeenCalledWith(12, { limit: 2, afterId: undefined }, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: /Tạo|Lưu|Xóa/ })).not.toBeInTheDocument();
  });
  it('uses the existing logout callback and removes the reader before awaiting it', async () => {
    const { api, logout } = setup(); fireEvent.change(screen.getByLabelText('Category ID QA'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mở bộ đọc thật' })); await screen.findByText('Không có thuộc tính phù hợp.');
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất QA' })); expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Đọc cấu hình thuộc tính' })).not.toBeInTheDocument(); expect(api.list).toHaveBeenCalledTimes(1);
  });
});
