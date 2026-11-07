// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthContext } from '../../contexts/useAuth';
import type { Role } from '../../types/auth';
import { ApiError, fetchApi } from '../../services/apiClient';
import { CheckoutPage } from './CheckoutPage';
import { intentSlot } from './api';
vi.mock('../../services/apiClient', async original => ({ ...await original<typeof import('../../services/apiClient')>(), fetchApi: vi.fn() }));
const api = vi.mocked(fetchApi);
const slot = intentSlot(7, 'checkout');
const basket = { groups: [{ store: { id: 2, name: 'Store' }, items: [{ variantId: 10, quantity: 2, available: true, currentUnitPrice: '10000.00', productName: 'Tai nghe', unavailableReason: null }] }], unavailableItems: [] };
const addresses = { items: [{ id: 3, recipientName: 'Buyer', addressLine: '12 A', ward: 'W', province: 'P', isDefault: true }] };
const body = { addressId: 3, paymentProvider: 'COD', items: [{ variantId: 10, quantity: 2, expectedUnitPrice: '10000.00' }] };
const receipt = { checkoutId: 5, status: 'COMPLETED', replayed: true, orders: [{ id: 8, orderNumber: 'ORD-8', total: '20000.00', storeId: 2, status: 'PENDING_CONFIRMATION', payment: { provider: 'COD', status: 'UNPAID', amount: '20000.00', currency: 'VND' } }] };
function show(node: ReactNode, role: Role = 'USER', path = '/checkout?variantId=10') {
  return render(<AuthContext.Provider value={{ user: { id: 7, email: 'buyer@example.test', fullName: null, role, isActive: true }, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></AuthContext.Provider>);
}
beforeEach(() => {
  sessionStorage.clear(); api.mockReset();
  api.mockImplementation(async path => {
    if (path === '/cart') return basket;
    if (path === '/me/addresses') return addresses;
    if (path === '/checkout/preview') return { canCheckout: true, groups: [], unavailableItems: [], totals: { total: '20000.00' } };
    if (path === '/checkouts') throw new TypeError('lost response');
    throw new Error(`Unexpected API ${path}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
// The price/stock check (POST /checkout/preview) now runs automatically; only "Đặt hàng" is shown.
const previewCalls = () => api.mock.calls.filter(([path]) => path === '/checkout/preview');
const placeButton = () => screen.getByRole('button', { name: 'Đặt hàng COD' });
const placeReady = () => waitFor(() => expect(placeButton()).toBeEnabled());
describe('Checkout UI — mocked HTTP, not cross-service integration evidence', () => {
  it('releases only the rejected checkout intent after an email precondition failure and never retries automatically', async () => {
    api.mockImplementation(async path => {
      if (path === '/cart') return basket;
      if (path === '/me/addresses') return addresses;
      if (path === '/checkout/preview') return { canCheckout: true, groups: [], unavailableItems: [], totals: { total: '20000.00' } };
      if (path === '/checkouts') throw new ApiError('Verify email', 412, 'EMAIL_VERIFICATION_REQUIRED');
      throw new Error(path);
    });
    show(<CheckoutPage />);
    await placeReady();
    fireEvent.click(placeButton());
    await screen.findByText(/Cần xác minh email trong Tài khoản/);
    expect(previewCalls()).toHaveLength(1);
    expect(sessionStorage.getItem(slot)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gửi lại cùng yêu cầu' })).not.toBeInTheDocument();
    expect(api.mock.calls.filter(([path]) => path === '/checkouts')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Mở Tài khoản' })).toHaveAttribute('href', '/account');
  });
  it('does not show empty addresses or transaction uncertainty after a failed GET, and retry recovers', async () => {
    let fail = true;
    api.mockImplementation(async path => {
      if (fail && path === '/cart') throw new TypeError('offline');
      return path === '/cart' ? basket : path === '/checkout/preview' ? { canCheckout: true, groups: [], unavailableItems: [], totals: { total: '20000.00' } } : addresses;
    });
    show(<CheckoutPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được địa chỉ và giỏ hàng. Kiểm tra kết nối rồi thử lại.');
    expect(screen.queryByText(/Chưa có địa chỉ nhận hàng/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đặt hàng COD' })).not.toBeInTheDocument();
    expect(previewCalls()).toHaveLength(0);
    fail = false; fireEvent.click(screen.getByRole('button', { name: /^Tải lại$/ }));
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    expect(api.mock.calls.some(([path]) => path === '/checkouts')).toBe(false);
  });
  it('displays the full selected address outside the native select', async () => {
    show(<CheckoutPage />);
    // Parcel-label layout: recipient (bold) then the full address line, outside the native select.
    const shown = await screen.findByLabelText('Địa chỉ giao hàng đã chọn');
    expect(within(shown).getByText('Buyer')).toBeInTheDocument();
    expect(within(shown).getByText('12 A, W, P')).toBeInTheDocument();
  });
  it('shows a real empty-address message only after successful reads', async () => {
    api.mockImplementation(async path => path === '/cart' ? basket : { items: [] });
    show(<CheckoutPage />);
    await screen.findByText(/Chưa có địa chỉ nhận hàng/);
    expect(placeButton()).toBeDisabled();
    expect(previewCalls()).toHaveLength(0);
  });
  it('requires explicit price reload after rejection, uses new price and hides stale data if reload fails', async () => {
    let price = '10000.00'; let fail = false;
    api.mockImplementation(async path => {
      if (path === '/cart') {
        if (fail) throw new TypeError('offline');
        return { ...basket, groups: [{ ...basket.groups[0], items: [{ ...basket.groups[0]!.items[0], currentUnitPrice: price }] }] };
      }
      if (path === '/me/addresses') return addresses;
      if (path === '/checkout/preview') return { canCheckout: true, groups: [], totals: { total: '20000.00' } };
      if (path === '/checkouts') throw new ApiError('Giá đã đổi', 409, 'PRICE_CHANGED');
      throw new Error(path);
    });
    show(<CheckoutPage />);
    await placeReady();
    fireEvent.click(placeButton());
    await screen.findByText('Giá đã đổi');
    expect(sessionStorage.getItem(slot)).toBeNull();
    // After a rejection nothing is re-checked or re-sent until the buyer reloads explicitly.
    expect(placeButton()).toBeDisabled();
    expect(previewCalls()).toHaveLength(1);
    fail = true; fireEvent.click(screen.getByRole('button', { name: 'Tải lại giỏ và giá' }));
    await screen.findByRole('button', { name: /^Tải lại$/ });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đặt hàng COD' })).not.toBeInTheDocument();
    fail = false; price = '12000.00';
    fireEvent.click(screen.getByRole('button', { name: /^Tải lại$/ }));
    await placeReady();
    expect(screen.getByRole('checkbox')).toBeChecked();
    const previews = api.mock.calls.filter(([path]) => path === '/checkout/preview');
    expect(previews).toHaveLength(2);
    expect(JSON.parse(previews[1]![1]!.body as string).items).toEqual([{ variantId: 10, quantity: 2, expectedUnitPrice: '12000.00' }]);
    expect(api.mock.calls.filter(([path]) => path === '/checkouts')).toHaveLength(1);
  });
  it('a failed GET does not release a pending purchase or offer a new preview', async () => {
    const saved = { path: '/checkouts', key: 'saved_checkout_key_12345', body };
    sessionStorage.setItem(slot, JSON.stringify(saved));
    api.mockImplementation(async () => { throw new TypeError('offline'); });
    show(<CheckoutPage />);
    await screen.findByRole('button', { name: /^Tải lại$/ });
    expect(screen.getByRole('button', { name: /^Tải lại$/ })).toBeDisabled();
    expect(JSON.parse(sessionStorage.getItem(slot)!)).toEqual(saved);
    expect(screen.getByRole('button', { name: 'Gửi lại cùng yêu cầu' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Đặt hàng COD' })).not.toBeInTheDocument();
    expect(previewCalls()).toHaveLength(0);
  });
  it('does not auto-select the whole cart on direct Checkout navigation', async () => {
    show(<CheckoutPage />, 'USER', '/checkout');
    await screen.findByRole('checkbox');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(placeButton()).toBeDisabled();
    expect(previewCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox'));
    await placeReady();
    expect(previewCalls()).toHaveLength(1);
  });
  it('re-checks automatically when the result was cleared even if the final body is unchanged', async () => {
    show(<CheckoutPage />);
    await placeReady();
    expect(previewCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(placeButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    await placeReady();
    expect(previewCalls()).toHaveLength(2);
    expect(api.mock.calls.some(([path]) => path === '/checkouts')).toBe(false);
  });
  it('blocks ordering while an address is being saved, then re-checks and orders with the new address only', async () => {
    let finishSave!: (value: unknown) => void;
    const newAddress = { id: 99, recipientName: 'Người nhận mới', phone: '0912345678', province: 'TP.HCM', ward: 'Phường 1', district: null, addressLine: '123 Nguyễn Huệ', postalCode: null, deliveryNote: null, isDefault: false };
    api.mockImplementation(async (path, options) => {
      if (path === '/cart') return basket;
      if (path === '/me/addresses') return options?.method === 'POST' ? new Promise(done => { finishSave = done; }) : addresses;
      if (path === '/checkout/preview') return { canCheckout: true, groups: [], unavailableItems: [], totals: { total: '20000.00' } };
      if (path === '/checkouts') return { ...receipt, replayed: false };
      throw new Error(path);
    });
    show(<CheckoutPage />);
    await placeReady();
    expect(JSON.parse(previewCalls()[0]![1]!.body as string).addressId).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' }));
    fireEvent.change(screen.getByLabelText('Họ và tên người nhận *'), { target: { value: 'Người nhận mới' } });
    fireEvent.change(screen.getByLabelText('Số điện thoại *'), { target: { value: '0912345678' } });
    fireEvent.change(screen.getByLabelText('Tỉnh / thành phố *'), { target: { value: 'TP.HCM' } });
    fireEvent.change(screen.getByLabelText('Phường / xã *'), { target: { value: 'Phường 1' } });
    fireEvent.change(screen.getByLabelText('Địa chỉ cụ thể *'), { target: { value: '123 Nguyễn Huệ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu địa chỉ' }));
    // Saving: the old check no longer authorizes ordering and no new check starts.
    await waitFor(() => expect(placeButton()).toBeDisabled());
    fireEvent.click(placeButton());
    await new Promise(r => setTimeout(r, 30));
    expect(previewCalls()).toHaveLength(1);
    expect(api.mock.calls.some(([path]) => path === '/checkouts')).toBe(false);
    finishSave(newAddress);
    await placeReady();
    expect(previewCalls()).toHaveLength(2);
    expect(JSON.parse(previewCalls()[1]![1]!.body as string).addressId).toBe(99);
    fireEvent.click(placeButton());
    await screen.findByText(/Đã ghi nhận đặt hàng COD/);
    const orders = api.mock.calls.filter(([path]) => path === '/checkouts');
    expect(orders).toHaveLength(1);
    expect(JSON.parse(orders[0]![1]!.body as string).addressId).toBe(99);
  });
  it('does not retry a failed automatic check by itself; "Thử lại" re-checks once', async () => {
    let failing = true;
    api.mockImplementation(async path => {
      if (path === '/cart') return basket;
      if (path === '/me/addresses') return addresses;
      if (path === '/checkout/preview') { if (failing) throw new ApiError('Tạm thời lỗi', 500); return { canCheckout: true, groups: [], unavailableItems: [], totals: { total: '20000.00' } }; }
      throw new Error(path);
    });
    show(<CheckoutPage />);
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    await new Promise(r => setTimeout(r, 50));
    expect(previewCalls()).toHaveLength(1);
    failing = false;
    fireEvent.click(retry);
    await placeReady();
    expect(previewCalls()).toHaveLength(2);
  });
  it.each(['?variantId=999', '?variantId=10&variantId=999', '?variantId=', '?variantId=1.5', '?variantId=10&variantId=10'])('fails closed for invalid or missing Cart selection %s', async search => {
    show(<CheckoutPage />, 'USER', `/checkout${search}`);
    await screen.findByRole('checkbox');
    expect(placeButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('keeps only selected IDs and reloads canonical price/quantity without adding other Cart lines', async () => {
    let changed = false;
    api.mockImplementation(async path => path === '/cart' ? { ...basket, groups: [{ ...basket.groups[0], items: [{ ...basket.groups[0]!.items[0], quantity: changed ? 1 : 2, currentUnitPrice: changed ? '11000.00' : '10000.00' }, { ...basket.groups[0]!.items[0], variantId: 25 }] }] } : path === '/me/addresses' ? addresses : { canCheckout: false, groups: [], totals: null });
    show(<CheckoutPage />);
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    expect(screen.getAllByRole('checkbox').map(box => (box as HTMLInputElement).checked)).toEqual([true, false]);
    changed = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Tải lại giỏ và giá' }));
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path === '/checkout/preview')).toHaveLength(2));
    const calls = api.mock.calls.filter(([path]) => path === '/checkout/preview');
    expect(JSON.parse(calls[1]![1]!.body as string).items).toEqual([{ variantId: 10, quantity: 1, expectedUnitPrice: '11000.00' }]);
  });
  it('ignores a new URL selection while replaying a previously saved purchase', async () => {
    const saved = { path: '/checkouts', key: 'saved_checkout_key_12345', body };
    sessionStorage.setItem(slot, JSON.stringify(saved));
    api.mockImplementation(async path => path === '/cart' ? basket : path === '/me/addresses' ? addresses : receipt);
    show(<CheckoutPage />, 'USER', '/checkout?variantId=999');
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại cùng yêu cầu' }));
    await screen.findByText('Đã ghi nhận đặt hàng COD');
    expect(JSON.parse(api.mock.calls.find(([path]) => path === '/checkouts')![1]!.body as string)).toEqual(body);
  });
  it('does not submit a purchasable subset when another selected line becomes unavailable', async () => {
    api.mockImplementation(async path => path === '/cart' ? { ...basket, groups: [{ ...basket.groups[0], items: [basket.groups[0]!.items[0], { ...basket.groups[0]!.items[0], variantId: 25, available: false, unavailableReason: 'OUT_OF_STOCK' }] }] } : addresses);
    show(<CheckoutPage />, 'USER', '/checkout?variantId=10&variantId=25');
    await screen.findByText(/Món đã chọn không còn mua được/);
    expect(placeButton()).toBeDisabled();
    expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('previews exact variant/quantity/Decimal strings and preserves the same intent after lost response/remount/lookup 404', async () => {
    const view = show(<CheckoutPage />);
    await placeReady();
    const place = placeButton();
    fireEvent.click(place); fireEvent.click(place);
    await screen.findByRole('button', { name: 'Gửi lại cùng yêu cầu' });
    const saved = JSON.parse(sessionStorage.getItem(slot)!);
    expect(saved.body).toEqual(body);
    expect(api.mock.calls.filter(([path]) => path === '/checkouts')).toHaveLength(1);
    expect(JSON.parse(api.mock.calls.find(([path]) => path === '/checkout/preview')![1]!.body as string)).toEqual(body);
    view.unmount();
    api.mockImplementation(async path => {
      if (path === '/cart') return { groups: [], unavailableItems: [] };
      if (path === '/me/addresses') return { items: [] };
      if (path === '/checkouts/by-key') throw new ApiError('Not found yet', 404, 'CHECKOUT_NOT_FOUND');
      if (path === '/checkouts') return receipt;
      throw new Error(path);
    });
    show(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Tra biên nhận' }));
    await screen.findByText('Not found yet');
    expect(JSON.parse(sessionStorage.getItem(slot)!).key).toBe(saved.key);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại cùng yêu cầu' }));
    await screen.findByText('Đã ghi nhận đặt hàng COD');
    const calls = api.mock.calls.filter(([path]) => path === '/checkouts');
    expect(calls).toHaveLength(2);
    for (const [, options] of calls) { expect(options!.headers).toEqual({ 'Idempotency-Key': saved.key }); expect(JSON.parse(options!.body as string)).toEqual(body); }
    expect(sessionStorage.getItem(slot)).toBeNull();
  });
  it('blocks create when preview detects price/stock changes', async () => {
    api.mockImplementation(async path => path === '/cart' ? basket : path === '/me/addresses' ? addresses : { canCheckout: false, groups: [], unavailableItems: [], totals: null });
    show(<CheckoutPage />);
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    await screen.findByRole('button', { name: 'Tải lại giỏ và giá' });
    expect(placeButton()).toBeDisabled();
    expect(api.mock.calls.some(([path]) => path === '/checkouts')).toBe(false);
  });
  it('does not send a write when browser storage cannot persist the replay key', async () => {
    show(<CheckoutPage />);
    await placeReady();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(placeButton());
    await screen.findByRole('alert');
    expect(api.mock.calls.some(([path]) => path === '/checkouts')).toBe(false);
  });
  it('fails closed for corrupt saved intent', async () => {
    sessionStorage.setItem(slot, '{broken'); show(<CheckoutPage />);
    await waitFor(() => expect(screen.queryByText('Đang tải địa chỉ và giỏ hàng…')).not.toBeInTheDocument());
    expect(placeButton()).toBeDisabled(); expect(api.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(false);
  });
  it('allows opening inline address form and creating address without leaving checkout or losing draft', async () => {
    const newAddr = {
      id: 99,
      recipientName: 'Người nhận mới',
      phone: '0912345678',
      province: 'TP.HCM',
      ward: 'Phường 1',
      district: 'Quận 1',
      addressLine: '123 Nguyễn Huệ',
      postalCode: null,
      deliveryNote: null,
      isDefault: false,
    };
    api.mockImplementation(async (path, options) => {
      if (path === '/cart') return basket;
      if (path === '/me/addresses') {
        if (options?.method === 'POST') return newAddr;
        return addresses;
      }
      if (path === '/checkout/preview') return { canCheckout: true, groups: [], unavailableItems: [], totals: { total: '20000.00' } };
      throw new Error(path);
    });

    show(<CheckoutPage />);
    await screen.findByRole('button', { name: '+ Thêm địa chỉ mới' });
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' }));

    // Form is open
    expect(screen.getByRole('heading', { name: 'Thêm địa chỉ nhận hàng mới' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Họ và tên người nhận *'), { target: { value: 'Người nhận mới' } });
    fireEvent.change(screen.getByLabelText('Số điện thoại *'), { target: { value: '0912345678' } });
    fireEvent.change(screen.getByLabelText('Tỉnh / thành phố *'), { target: { value: 'TP.HCM' } });
    fireEvent.change(screen.getByLabelText('Phường / xã *'), { target: { value: 'Phường 1' } });
    fireEvent.change(screen.getByLabelText('Địa chỉ cụ thể *'), { target: { value: '123 Nguyễn Huệ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lưu địa chỉ' }));

    await waitFor(() => {
      expect(screen.queryByText('Thêm địa chỉ nhận hàng mới')).not.toBeInTheDocument();
    });

    // Checkbox and Tai nghe are still present and checked
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('Tai nghe')).toBeInTheDocument();
  });

});
