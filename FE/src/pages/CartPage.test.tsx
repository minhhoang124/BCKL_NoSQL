// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/useAuth';
import { ApiError } from '../services/apiClient';
import type { User } from '../types/auth';
import type { CartResponse } from '../types/cart';
import { CartPage } from './CartPage';

const api = vi.hoisted(() => ({ list: vi.fn(), put: vi.fn(), remove: vi.fn() }));
vi.mock('../services/cartApi', () => ({ cartApi: api }));

const user: User = { id: 1, email: 'buyer@example.test', fullName: 'Người mua', role: 'USER', isActive: true };
const cart: CartResponse = {
  groups: [{ store: { id: 8, name: 'BCKL Audio' }, purchasableSubtotal: '2580000.00', items: [
    { variantId: 125, productId: 58, productName: 'Tai nghe mẫu', imageUrl: '/uploads/headphones.jpg', optionValues: ['Đen'], quantity: 2, currentUnitPrice: '1290000.00', stock: 4, available: true, unavailableReason: null },
    { variantId: 126, productId: 58, productName: 'Tai nghe trắng', quantity: 3, currentUnitPrice: '1290000.00', stock: 1, available: false, unavailableReason: 'INSUFFICIENT_STOCK' },
  ] }],
  unavailableItems: [{ variantId: 999, quantity: 1, available: false, unavailableReason: 'PRODUCT_UNAVAILABLE', productName: 'Private product name' }],
  lineCount: 3, totalQuantity: 6, purchasableSubtotal: '2580000.00',
};

function page(actor: User | null = user) {
  return <MemoryRouter><AuthContext.Provider value={{ user: actor, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}><CartPage /></AuthContext.Provider></MemoryRouter>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.resetAllMocks(); api.list.mockResolvedValue(cart); });
afterEach(cleanup);

describe('Buyer Cart UI', () => {
  it('hands off only selected purchasable variant IDs, never product IDs or prices', async () => {
    api.list.mockResolvedValueOnce({ ...cart, groups: [{ ...cart.groups[0], items: [
      cart.groups[0].items[0], { ...cart.groups[0].items[0], variantId: 777 }, cart.groups[0].items[1],
    ] }] });
    render(page());
    const checkout = await screen.findByRole('link', { name: 'Tiếp tục thanh toán' });
    expect(checkout).toHaveAttribute('href', '/checkout?variantId=125&variantId=777');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn biến thể 125' }));
    expect(checkout).toHaveAttribute('href', '/checkout?variantId=777');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn biến thể 777' }));
    expect(screen.queryByRole('link', { name: 'Tiếp tục thanh toán' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục thanh toán' })).toBeDisabled();
  });

  it('blocks handoff until edited quantity is saved or cancelled', async () => {
    render(page());
    await screen.findByRole('link', { name: 'Tiếp tục thanh toán' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 125' }), { target: { value: '3' } });
    expect(screen.getByRole('button', { name: 'Tiếp tục thanh toán' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Tiếp tục thanh toán' })).not.toBeInTheDocument();
  });

  it.each([50, 51])('enforces maximum 50 selected rows (selected=%s)', async (count) => {
    api.list.mockResolvedValueOnce({ ...cart, groups: [{ ...cart.groups[0], items:
      Array.from({ length: count }, (_, index) => ({ ...cart.groups[0].items[0], variantId: index + 1 })) }] });
    render(page());
    await screen.findByRole('checkbox', { name: 'Chọn biến thể 1' });
    if (count === 50) {
      const href = screen.getByRole('link', { name: 'Tiếp tục thanh toán' }).getAttribute('href')!;
      expect(new URL(href, 'https://example.test').searchParams.getAll('variantId')).toHaveLength(50);
    } else {
      expect(screen.getByRole('button', { name: 'Tiếp tục thanh toán' })).toBeDisabled();
      expect(screen.getByRole('alert')).toHaveTextContent('tối đa 50');
    }
  });
  it('shows empty GET without creating a cart', async () => {
    api.list.mockResolvedValueOnce({ groups: [], unavailableItems: [], lineCount: 0, totalQuantity: 0, purchasableSubtotal: '0.00' });
    render(page());
    expect(screen.getByText('Đang tải giỏ hàng...')).toBeInTheDocument();
    expect(await screen.findByText('Giỏ hàng đang trống')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('selects only purchasable rows and calculates the subset from decimal strings', async () => {
    render(page());
    expect(await screen.findByText('Tai nghe mẫu')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Chọn biến thể 125' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chọn biến thể 126' })).toBeDisabled();
    expect(screen.getAllByText('2.580.000 ₫').length).toBeGreaterThan(0);
    expect(screen.getByText('Sản phẩm không còn được bán')).toBeInTheDocument();
    expect(screen.queryByText('Private product name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn cửa hàng BCKL Audio' }));
    expect(screen.getByText('0 ₫')).toBeInTheDocument();
  });

  it('sends absolute quantity once and accepts the authoritative PUT cart', async () => {
    const pending = deferred<CartResponse>();
    api.put.mockReturnValueOnce(pending.promise);
    render(page()); await screen.findByText('Tai nghe mẫu');
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '3' } });
    const update = within(row).getByRole('button', { name: 'Cập nhật' });
    fireEvent.click(update); fireEvent.click(update);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith(125, 3);
    await act(async () => pending.resolve({ ...cart, groups: [{ ...cart.groups[0], items: [{ ...cart.groups[0].items[0], quantity: 3 }, cart.groups[0].items[1]], purchasableSubtotal: '3870000.00' }], totalQuantity: 7, purchasableSubtotal: '3870000.00' }));
    expect(await screen.findByText('Đã cập nhật giỏ hàng.')).toBeInTheDocument();
    expect(within(row).getByRole('spinbutton')).toHaveValue(3);
  });

  it('validates quantity locally and reconciles a 409 before another write', async () => {
    api.put.mockRejectedValueOnce(new ApiError('Tồn kho hiện không đủ.', 409));
    render(page()); await screen.findByText('Tai nghe mẫu');
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '100' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Cập nhật' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1 đến 99');
    expect(api.put).not.toHaveBeenCalled();
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '4' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Cập nhật' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tồn kho hiện không đủ');
    expect(api.put).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại giỏ hàng' }));
    await waitFor(() => expect(screen.getByText('Tai nghe mẫu')).toBeInTheDocument());
  });

  it('requires confirmation before deleting a private row and reloads after 204', async () => {
    api.remove.mockResolvedValueOnce(undefined);
    render(page()); await screen.findByText('Tai nghe mẫu');
    const section = screen.getByRole('region', { name: 'Sản phẩm không còn công khai' });
    fireEvent.click(within(section).getByRole('button', { name: 'Xóa' }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.queryByText('Private product name')).not.toBeInTheDocument();
    api.list.mockResolvedValueOnce({ ...cart, unavailableItems: [], lineCount: 2, totalQuantity: 5 });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa' }));
    expect(api.remove).toHaveBeenCalledWith(999);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Sản phẩm không còn công khai' })).not.toBeInTheDocument());
  });

  it('rejects Seller locally without calling Buyer API', () => {
    render(page({ ...user, role: 'SELLER' }));
    expect(screen.getByRole('alert')).toHaveTextContent('người mua');
    expect(api.list).not.toHaveBeenCalled();
  });

  it.each([null, { ...user, isActive: false }, { ...user, role: 'ADMIN' as const }])('does not read a cart for an unauthorized actor %#', (actor) => {
    render(page(actor));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1.5', '100', ''])('rejects invalid quantity %s without a write', async (value) => {
    render(page()); await screen.findByText('Tai nghe mẫu');
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value } });
    fireEvent.click(within(row).getByRole('button', { name: 'Cập nhật' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('1 đến 99');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('shows a safe retry state after failed initial GET', async () => {
    api.list.mockRejectedValueOnce(new ApiError('Giỏ tạm thời không đọc được.', 503));
    render(page());
    expect(await screen.findByRole('alert')).toHaveTextContent('Giỏ tạm thời không đọc được');
    expect(screen.queryByText('Giỏ hàng đang trống')).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).queryByText('0 ₫')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại giỏ hàng' }));
    await screen.findByText('Tai nghe mẫu');
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('drops the old actor response after account switch', async () => {
    const old = deferred<CartResponse>();
    api.list.mockReturnValueOnce(old.promise);
    const view = render(page());
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    const signal = api.list.mock.calls[0][0] as AbortSignal;
    api.list.mockResolvedValueOnce({ groups: [], unavailableItems: [], lineCount: 0, totalQuantity: 0, purchasableSubtotal: '0.00' });
    view.rerender(page({ ...user, id: 2, fullName: 'Người mua khác' }));
    expect(await screen.findByText('Giỏ hàng đang trống')).toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(cart));
    expect(screen.queryByText('Tai nghe mẫu')).not.toBeInTheDocument();
  });

  it('supports mixed Store/all selection across multiple Stores without selecting unavailable rows', async () => {
    api.list.mockResolvedValueOnce({ ...cart, groups: [
      { ...cart.groups[0], items: [cart.groups[0].items[0], { ...cart.groups[0].items[0], variantId: 127, productName: 'Tai nghe thứ hai' }, cart.groups[0].items[1]] },
      { store: { id: 9, name: 'Store khác' }, items: [{ ...cart.groups[0].items[0], variantId: 128 }], purchasableSubtotal: '2580000.00' },
    ] });
    render(page()); await screen.findByText('Tai nghe thứ hai');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn biến thể 125' }));
    const group = screen.getByRole('checkbox', { name: 'Chọn cửa hàng BCKL Audio' });
    const all = screen.getByRole('checkbox', { name: 'Chọn tất cả hàng mua được' });
    expect(group).toBePartiallyChecked();
    expect(all).toBePartiallyChecked();
    fireEvent.click(group);
    expect(all).toBeChecked();
    fireEvent.click(all);
    expect(screen.getByRole('checkbox', { name: 'Chọn biến thể 128' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chọn biến thể 126' })).toBeDisabled();
  });

  it('preserves another row draft when accepting the authoritative PUT result', async () => {
    api.put.mockResolvedValueOnce(cart);
    render(page()); await screen.findByText('Tai nghe mẫu');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 126' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 125' }), { target: { value: '3' } });
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Cập nhật' }));
    await screen.findByText('Đã cập nhật giỏ hàng.');
    expect(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 125' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 126' })).toHaveValue(1);
    expect(screen.getByText(/Có 1 dòng sửa số lượng chưa lưu/)).toBeInTheDocument();
    const other = screen.getByText('Tai nghe trắng').closest('div')?.parentElement as HTMLElement;
    fireEvent.click(within(other).getByRole('button', { name: 'Hủy sửa' }));
    expect(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 126' })).toHaveValue(3);
  });

  it('keeps a draft on validation failure and does not calculate totals from unsaved input', async () => {
    api.put.mockRejectedValueOnce(new ApiError('Số lượng không hợp lệ.', 400));
    render(page()); await screen.findByText('Tai nghe mẫu');
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '3' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Cập nhật' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Số lượng không hợp lệ');
    expect(within(row).getByRole('spinbutton')).toHaveValue(3);
    expect(within(row).getByRole('button', { name: 'Cập nhật' })).toBeEnabled();
    expect(within(screen.getByRole('complementary')).getAllByText('2.580.000 ₫')).toHaveLength(2);
  });

  it.each([401, 403, 404, 409, 429, 500, 503])('invalidates stale summary after HTTP %s write failure', async (status) => {
    api.put.mockRejectedValueOnce(new ApiError('Không thể cập nhật.', status));
    render(page()); await screen.findByText('Tai nghe mẫu');
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '3' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Cập nhật' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Tai nghe mẫu')).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).queryByText('2.580.000 ₫')).not.toBeInTheDocument();
    expect(api.put).toHaveBeenCalledTimes(1);
    if (status === 401) expect(screen.getByRole('link', { name: 'Đăng nhập lại' })).toHaveAttribute('href', '/login');
  });

  it('requires reconciliation after a network failure, preserving draft for a later explicit reload', async () => {
    api.put.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(page()); await screen.findByText('Tai nghe mẫu');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 125' }), { target: { value: '3' } });
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Cập nhật' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('kiểm tra mạng');
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại giỏ hàng' }));
    await screen.findByText('Tai nghe mẫu');
    expect(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 125' })).toHaveValue(3);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('allows lowering insufficient stock but disables editing a disabled or sold-out variant', async () => {
    api.list.mockResolvedValueOnce({ ...cart, groups: [{ ...cart.groups[0], items: [
      ...cart.groups[0].items,
      { ...cart.groups[0].items[0], variantId: 127, productName: 'Hết hàng', available: false, stock: 0, unavailableReason: 'OUT_OF_STOCK' },
      { ...cart.groups[0].items[0], variantId: 128, productName: 'Phân loại đã ẩn', available: false, unavailableReason: 'VARIANT_UNAVAILABLE', optionValues: ['Private option'], currentUnitPrice: '999.00' },
    ] }] });
    render(page()); await screen.findByText('Tai nghe mẫu');
    expect(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 126' })).toBeEnabled();
    expect(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 127' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Số lượng biến thể 128' })).toBeDisabled();
    expect(screen.queryByText('Phân loại: Private option')).not.toBeInTheDocument();
    expect(screen.queryByText('999 ₫')).not.toBeInTheDocument();
  });

  it('reconciles selection and warns when reloading changes price and availability', async () => {
    render(page()); await screen.findByText('Tai nghe mẫu');
    api.list.mockResolvedValueOnce({ ...cart, groups: [{ ...cart.groups[0], items: [{ ...cart.groups[0].items[0], currentUnitPrice: '1500000.00', available: false, stock: 0, unavailableReason: 'OUT_OF_STOCK' }], purchasableSubtotal: '0.00' }], purchasableSubtotal: '0.00' });
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại giỏ hàng' }));
    await screen.findByText(/Giá của 1 dòng đã thay đổi/);
    expect(screen.getByRole('checkbox', { name: 'Chọn biến thể 125' })).not.toBeChecked();
    expect(within(screen.getByRole('complementary')).getByText('0 dòng')).toBeInTheDocument();
  });

  it('focuses/traps the deletion dialog, Escape cancels, and blocks double delete', async () => {
    render(page()); await screen.findByText('Tai nghe mẫu');
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    const remove = within(row).getByRole('button', { name: 'Xóa' });
    remove.focus(); fireEvent.click(remove);
    const keep = screen.getByRole('button', { name: 'Giữ lại' });
    const confirm = screen.getByRole('button', { name: 'Xác nhận xóa' });
    expect(keep).toHaveFocus();
    fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(keep).toHaveFocus();
    fireEvent.keyDown(keep, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(remove).toHaveFocus();
    expect(api.remove).not.toHaveBeenCalled();
    const pending = deferred<void>();
    api.remove.mockReturnValueOnce(pending.promise);
    fireEvent.click(remove);
    const submit = screen.getByRole('button', { name: 'Xác nhận xóa' });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => pending.resolve());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows delete success separately from a failed follow-up GET', async () => {
    render(page()); await screen.findByText('Tai nghe mẫu');
    api.remove.mockResolvedValueOnce(undefined);
    api.list.mockRejectedValueOnce(new ApiError('Không tải được giỏ.', 503));
    const section = screen.getByRole('region', { name: 'Sản phẩm không còn công khai' });
    fireEvent.click(within(section).getByRole('button', { name: 'Xóa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa' }));
    await screen.findByText('Đã xóa dòng khỏi giỏ hàng.');
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được giỏ');
    expect(within(screen.getByRole('complementary')).queryByText('2.580.000 ₫')).not.toBeInTheDocument();
    expect(api.remove).toHaveBeenCalledTimes(1);
  });

  it('ignores a pending mutation response after switching actors', async () => {
    const pending = deferred<CartResponse>();
    api.put.mockReturnValueOnce(pending.promise);
    const view = render(page()); await screen.findByText('Tai nghe mẫu');
    const row = screen.getByText('Tai nghe mẫu').closest('div')?.parentElement as HTMLElement;
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '3' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Cập nhật' }));
    api.list.mockResolvedValueOnce({ groups: [], unavailableItems: [], lineCount: 0, totalQuantity: 0, purchasableSubtotal: '0.00' });
    view.rerender(page({ ...user, id: 2 }));
    await screen.findByText('Giỏ hàng đang trống');
    await act(async () => pending.resolve(cart));
    expect(screen.queryByText('Tai nghe mẫu')).not.toBeInTheDocument();
    expect(screen.queryByText('Đã cập nhật giỏ hàng.')).not.toBeInTheDocument();
  });
});
