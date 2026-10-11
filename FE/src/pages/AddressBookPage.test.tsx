// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/useAuth';
import { ApiError } from '../services/apiClient';
import { AddressBookPage } from './AddressBookPage';
import type { Address } from '../types/address';
import type { User } from '../types/auth';

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), setDefault: vi.fn() }));
vi.mock('../services/addressApi', () => ({ addressApi: api }));
const user: User = { id: 1, email: 'buyer@example.test', fullName: 'Buyer Test', role: 'USER', isActive: true };
const first: Address = { id: 10, recipientName: 'Buyer Test', phone: '0901234567', province: 'Thành phố mẫu', district: null,
  ward: 'Phường mẫu', addressLine: '10 Đường mẫu', postalCode: null, deliveryNote: null, isDefault: true,
  createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
const second: Address = { ...first, id: 11, recipientName: 'Người nhận khác', addressLine: '20 Đường mẫu', isDefault: false };
function page(actor: User | null = user) {
  return <MemoryRouter><AuthContext.Provider value={{ user: actor, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}><AddressBookPage /></AuthContext.Provider></MemoryRouter>;
}
function fill() {
  for (const [label, value] of [['Họ và tên người nhận *', ' Người nhận mới '], ['Số điện thoại *', '0909876543'], ['Tỉnh / thành phố *', 'Tỉnh mẫu'], ['Phường / xã *', 'Xã mẫu'], ['Địa chỉ cụ thể *', '30 Đường mẫu']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { vi.resetAllMocks(); api.list.mockResolvedValue({ items: [first, second] }); });
afterEach(cleanup);

describe('Buyer Address Book', () => {
  it('shows loading and then the empty state without creating an address', async () => {
    const pending = deferred<{ items: Address[] }>(); api.list.mockReturnValueOnce(pending.promise);
    render(page()); expect(screen.getByText('Đang tải địa chỉ...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })).toBeDisabled();
    await act(async () => pending.resolve({ items: [] }));
    expect(await screen.findByText('Bạn chưa có địa chỉ nhận hàng')).toBeInTheDocument(); expect(api.create).not.toHaveBeenCalled();
  });

  it('creates a trimmed address with nullable optional fields and prevents double submission', async () => {
    const pending = deferred<Address>(); api.create.mockReturnValueOnce(pending.promise);
    render(page()); await screen.findByText(first.addressLine + ', ' + first.ward + ', ' + first.province);
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })); fill();
    const form = screen.getByRole('form', { name: 'Thông tin địa chỉ' });
    fireEvent.submit(form); fireEvent.submit(form);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith({ recipientName: 'Người nhận mới', phone: '0909876543', province: 'Tỉnh mẫu', ward: 'Xã mẫu', addressLine: '30 Đường mẫu', district: null, postalCode: null, deliveryNote: null, isDefault: false });
    await act(async () => pending.resolve({ ...first, id: 12 }));
    expect(await screen.findByText('Đã thêm địa chỉ.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('rejects whitespace and invalid phone locally', async () => {
    render(page()); await screen.findByText('Người nhận khác');
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })); fill();
    fireEvent.change(screen.getByLabelText('Họ và tên người nhận *'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Số điện thoại *'), { target: { value: 'abc123' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByText('Vui lòng nhập nội dung, không chỉ khoảng trắng.')).toBeInTheDocument();
    expect(screen.getByText(/Nhập 8–20 ký tự/)).toBeInTheDocument(); expect(api.create).not.toHaveBeenCalled();
  });

  it('keeps form values on validation failure and allows correction', async () => {
    api.create.mockRejectedValueOnce(new ApiError('Dữ liệu địa chỉ không hợp lệ.', 400));
    render(page()); await screen.findByText('Người nhận khác');
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })); fill(); fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dữ liệu địa chỉ không hợp lệ.');
    expect(screen.getByLabelText('Họ và tên người nhận *')).toHaveValue(' Người nhận mới ');
    expect(screen.getByRole('button', { name: 'Lưu địa chỉ' })).toBeEnabled();
  });

  it('keeps the limit error and draft; requires list reconciliation after a 409', async () => {
    api.create.mockRejectedValueOnce(new ApiError('Đã đạt giới hạn địa chỉ.', 409));
    render(page()); await screen.findByText('Người nhận khác');
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })); fill(); fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Đã đạt giới hạn địa chỉ.');
    expect(screen.getByRole('button', { name: 'Lưu địa chỉ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu địa chỉ' })).toBeEnabled());
    expect(screen.getByLabelText('Địa chỉ cụ thể *')).toHaveValue('30 Đường mẫu');
  });

  it('edits the default address without submitting isDefault=false', async () => {
    api.update.mockResolvedValue(first); render(page()); await screen.findByText('Người nhận khác');
    fireEvent.click(within(screen.getByRole('article', { name: 'Địa chỉ của Buyer Test' })).getByRole('button', { name: 'Chỉnh sửa' }));
    expect(screen.getByRole('checkbox')).toBeChecked(); expect(screen.getByRole('checkbox')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Ghi chú giao hàng (tùy chọn)'), { target: { value: 'Gọi trước khi giao' } });
    fireEvent.submit(screen.getByRole('form')); await screen.findByText('Đã cập nhật địa chỉ.');
    expect(api.update).toHaveBeenCalledWith(10, expect.objectContaining({ deliveryNote: 'Gọi trước khi giao', district: null }));
    expect(api.update.mock.calls[0][1]).not.toHaveProperty('isDefault');
  });

  it('changes default via its dedicated command and reloads the authoritative list', async () => {
    api.setDefault.mockResolvedValue({ ...second, isDefault: true });
    render(page()); await screen.findByText('Người nhận khác');
    api.list.mockResolvedValueOnce({ items: [{ ...second, isDefault: true }, { ...first, isDefault: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt làm mặc định' }));
    await screen.findByText('Đã đổi địa chỉ mặc định.');
    expect(api.setDefault).toHaveBeenCalledWith(11);
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'Địa chỉ của Người nhận khác' })).getByText('Mặc định')).toBeInTheDocument());
  });

  it('requires confirmation before deleting and supports deleting the default', async () => {
    api.remove.mockResolvedValue(undefined); render(page()); await screen.findByText('Người nhận khác');
    fireEvent.click(within(screen.getByRole('article', { name: 'Địa chỉ của Buyer Test' })).getByRole('button', { name: 'Xóa' }));
    expect(api.remove).not.toHaveBeenCalled(); expect(screen.getByText(/hệ thống sẽ tự chọn/)).toBeInTheDocument();
    api.list.mockResolvedValueOnce({ items: [{ ...second, isDefault: true }] });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa' }));
    await screen.findByText('Đã xóa địa chỉ.'); expect(api.remove).toHaveBeenCalledWith(10);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Địa chỉ của Buyer Test' })).not.toBeInTheDocument());
  });

  it('reports write success separately when the following list load fails', async () => {
    api.create.mockResolvedValue(first); render(page()); await screen.findByText('Người nhận khác');
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })); fill();
    api.list.mockRejectedValueOnce(new Error('offline')); fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByText('Đã thêm địa chỉ.')).toBeInTheDocument(); await screen.findByRole('alert');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })).toBeDisabled(); expect(api.create).toHaveBeenCalledTimes(1);
  });

  it('preserves a draft and blocks resubmission after an uncertain network write', async () => {
    api.create.mockRejectedValueOnce(new TypeError('network failure')); render(page()); await screen.findByText('Người nhận khác');
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })); fill(); fireEvent.submit(screen.getByRole('form'));
    await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Lưu địa chỉ' })).toBeDisabled();
    expect(screen.getByLabelText('Họ và tên người nhận *')).toHaveValue(' Người nhận mới '); expect(api.create).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('shows an actionable auth/permission error (%s)', async (status) => {
    api.list.mockRejectedValueOnce(new ApiError('denied', status)); render(page());
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 401 ? 'đăng nhập lại' : 'không có quyền');
    expect(screen.getByRole('button', { name: '+ Thêm địa chỉ mới' })).toBeDisabled();
  });

  it('clears personal data and ignores a late list response when the actor changes', async () => {
    const old = deferred<{ items: Address[] }>(); api.list.mockReturnValueOnce(old.promise);
    const view = render(page()); await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    const signal = api.list.mock.calls[0][0] as AbortSignal;
    api.list.mockResolvedValueOnce({ items: [] }); view.rerender(page({ ...user, id: 2, fullName: 'Buyer Two' }));
    await screen.findByText('Bạn chưa có địa chỉ nhận hàng'); expect(signal.aborted).toBe(true);
    await act(async () => old.resolve({ items: [first] }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('does not call Buyer API for a Seller account', () => {
    render(page({ ...user, role: 'SELLER' })); expect(screen.getByRole('alert')).toHaveTextContent('người mua');
    expect(api.list).not.toHaveBeenCalled();
  });
});
