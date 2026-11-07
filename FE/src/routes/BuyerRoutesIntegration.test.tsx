// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/useAuth';
import { AppRouter } from './AppRouter';

const apis = vi.hoisted(() => ({ addresses: vi.fn(), cart: vi.fn() }));
vi.mock('../services/addressApi', () => ({ addressApi: { list: apis.addresses } }));
vi.mock('../services/cartApi', () => ({ cartApi: { list: apis.cart } }));

function ReturnToAddresses() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/account/addresses')}>Test return to addresses</button>;
}

beforeEach(() => {
  apis.addresses.mockReset().mockResolvedValue({ items: [] });
  apis.cart.mockReset().mockResolvedValue({ groups: [], unavailableItems: [], lineCount: 0,
    totalQuantity: 0, purchasableSubtotal: '0.00' });
});
afterEach(cleanup);

it('keeps both Buyer routes after merging Address and Cart, including Header navigation', async () => {
  render(<MemoryRouter initialEntries={['/account/addresses']}>
    <AuthContext.Provider value={{
      user: { id: 1, email: 'buyer@example.test', fullName: null, role: 'USER', isActive: true },
      loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn(),
    }}><ReturnToAddresses /><AppRouter /></AuthContext.Provider>
  </MemoryRouter>);
  expect(await screen.findByText('Bạn chưa có địa chỉ nhận hàng')).toBeInTheDocument();
  expect(apis.cart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: 'Giỏ hàng' }));
  expect(await screen.findByText('Giỏ hàng đang trống')).toBeInTheDocument();
  expect(screen.queryByText('Bạn chưa có địa chỉ nhận hàng')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Test return to addresses' }));
  expect(await screen.findByText('Bạn chưa có địa chỉ nhận hàng')).toBeInTheDocument();
  await waitFor(() => expect(apis.addresses).toHaveBeenCalledTimes(2));
  expect(apis.cart).toHaveBeenCalledTimes(1);
});
