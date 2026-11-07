// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/useAuth';
import type { User } from '../types/auth';
import { AppRouter } from './AppRouter';

const list = vi.hoisted(() => vi.fn());
vi.mock('../services/addressApi', () => ({ addressApi: { list } }));
vi.mock('../pages/HomePage', () => ({ HomePage: () => <p>Trang chủ kiểm thử</p> }));
vi.mock('../pages/LoginPage', () => ({ LoginPage: () => <p>Đăng nhập kiểm thử</p> }));
const buyer: User = { id: 1, email: 'buyer@example.test', fullName: null, role: 'USER', isActive: true };
function page(user: User | null, path = '/account/addresses') {
  return <MemoryRouter initialEntries={[path]}><AuthContext.Provider value={{ user, loading: false,
    login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}><AppRouter /></AuthContext.Provider></MemoryRouter>;
}
beforeEach(() => { list.mockReset(); list.mockResolvedValue({ items: [] }); });
afterEach(cleanup);
describe('Address route approved by Hoàng', () => {
  it('opens the real Address page for active USER', async () => {
    render(page(buyer));
    expect(await screen.findByRole('heading', { name: /Sổ địa chỉ/i })).toBeInTheDocument();
  });
  it('links Account to the agreed Address route', () => {
    render(page(buyer, '/account'));
    expect(screen.getByRole('link', { name: 'Sổ địa chỉ' })).toHaveAttribute('href', '/account/addresses');
  });
  it.each(['SELLER', 'ADMIN'] as const)('rejects %s without reading addresses', (role) => {
    render(page({ ...buyer, role }));
    expect(screen.getByText('Trang chủ kiểm thử')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
  it('rejects inactive USER without reading addresses', () => {
    render(page({ ...buyer, isActive: false }));
    expect(screen.getByRole('alert')).toHaveTextContent('đang hoạt động');
    expect(list).not.toHaveBeenCalled();
  });
  it('redirects anonymous users to login', () => {
    render(page(null));
    expect(screen.getByText('Đăng nhập kiểm thử')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
});
