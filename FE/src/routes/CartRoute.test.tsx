// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/useAuth';
import type { User } from '../types/auth';
import { AppRouter } from './AppRouter';

const list = vi.hoisted(() => vi.fn());
vi.mock('../services/cartApi', () => ({ cartApi: { list } }));
vi.mock('../pages/HomePage', () => ({ HomePage: () => <p>Trang chủ kiểm thử</p> }));
vi.mock('../pages/LoginPage', () => ({ LoginPage: () => <p>Đăng nhập kiểm thử</p> }));
const buyer: User = { id: 1, email: 'buyer@example.test', fullName: null, role: 'USER', isActive: true };
function page(user: User | null) {
  return <MemoryRouter initialEntries={['/cart']}><AuthContext.Provider value={{ user, loading: false,
    login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}><AppRouter /></AuthContext.Provider></MemoryRouter>;
}
beforeEach(() => { list.mockReset(); list.mockResolvedValue({ groups: [], unavailableItems: [], lineCount: 0, totalQuantity: 0, purchasableSubtotal: '0.00' }); });
afterEach(cleanup);
describe('Cart route approved by Hoàng', () => {
  it('opens the real Cart page and Header link for active USER', async () => {
    render(page(buyer));
    expect(await screen.findByText('Giỏ hàng đang trống')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Giỏ hàng' })).toHaveAttribute('href', '/cart');
  });
  it.each(['SELLER', 'ADMIN'] as const)('rejects %s and hides Buyer link', (role) => {
    render(page({ ...buyer, role }));
    expect(screen.getByText('Trang chủ kiểm thử')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Giỏ hàng' })).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
  it('rejects inactive USER without reading Cart', () => {
    render(page({ ...buyer, isActive: false }));
    expect(screen.getByRole('alert')).toHaveTextContent('đang hoạt động');
    expect(screen.queryByRole('link', { name: 'Giỏ hàng' })).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
  it('redirects anonymous users to login', () => {
    render(page(null));
    expect(screen.getByText('Đăng nhập kiểm thử')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
});
