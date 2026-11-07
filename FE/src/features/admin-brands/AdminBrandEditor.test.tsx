// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../../contexts/useAuth';
import { ApiError, setAccessToken } from '../../services/apiClient';
import type { User } from '../../types/auth';
import { AdminBrandEditor } from './AdminBrandEditor';
import type { AdminBrand, BrandWrite } from './brandApi';

const admin: User = { id: 10, email: 'admin@example.test', fullName: 'Admin mẫu', role: 'ADMIN', isActive: true };
const rows: AdminBrand[] = [{ id: 5, name: 'Brand A', slug: 'brand-a', isActive: true }, { id: 6, name: 'Brand B', slug: 'brand-b', isActive: false }];
const api = { list: vi.fn(), update: vi.fn() };
const response: BrandWrite = { ...rows[0], name: 'Brand New', searchReconciliation: { jobId: '19', status: 'PENDING' } };
function page(user: User | null = admin) {
  return <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}><AdminBrandEditor api={api} /></AuthContext.Provider>;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function edit() {
  await screen.findByRole('button', { name: 'Sửa thương hiệu Brand A' });
  fireEvent.click(screen.getByRole('button', { name: 'Sửa thương hiệu Brand A' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Tên thương hiệu' }), { target: { value: 'Brand New' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xem lại thay đổi' }));
}
beforeEach(() => { vi.clearAllMocks(); api.list.mockReset().mockResolvedValue(rows); api.update.mockReset().mockResolvedValue(response); setAccessToken('test-only', admin.id); });
afterEach(() => { cleanup(); setAccessToken(null); });

describe('Admin Brand edit module', () => {
  it.each([null, { ...admin, role: 'SELLER' as const }, { ...admin, isActive: false }])('does not read or write for disallowed actor %j', async (user) => {
    render(page(user));
    expect(screen.getByRole('alert')).toHaveTextContent('Chỉ Admin đang hoạt động');
    expect(api.list).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
  it('reads active and inactive brands without exposing active toggle', async () => {
    render(page());
    expect(await screen.findByText('Brand B')).toBeVisible();
    expect(screen.getByText('Đã tắt')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Bật' })).not.toBeInTheDocument();
  });
  it('requires review and confirmation, allows cancelling review, sends name only once', async () => {
    render(page()); await edit();
    expect(api.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại sửa' }));
    expect(screen.getByRole('textbox', { name: 'Tên thương hiệu' })).toHaveValue('Brand New');
    fireEvent.click(screen.getByRole('button', { name: 'Xem lại thay đổi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(5, { name: 'Brand New' }, expect.any(AbortSignal));
    expect(await screen.findByText(/Đã lưu thương hiệu/)).toHaveTextContent('Thay đổi có thể chưa xuất hiện ngay trong kết quả tìm kiếm.');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('rejects blank name, invalid slug and unchanged forms before writing', async () => {
    render(page()); await edit();
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại sửa' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tên thương hiệu' }), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem lại thay đổi' }));
    expect(screen.getByRole('alert')).toHaveTextContent('2 đến 120');
    fireEvent.change(screen.getByRole('textbox', { name: 'Tên thương hiệu' }), { target: { value: 'Brand A' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Slug' }), { target: { value: 'Bad_Slug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem lại thay đổi' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Slug');
    fireEvent.change(screen.getByRole('textbox', { name: 'Slug' }), { target: { value: 'brand-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem lại thay đổi' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa có thay đổi');
    expect(api.update).not.toHaveBeenCalled();
  });
  it('keeps form and does not report success on duplicate slug 409', async () => {
    api.update.mockRejectedValue(new ApiError('Slug thương hiệu đã tồn tại', 409));
    render(page()); await edit(); fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Slug thương hiệu đã tồn tại');
    expect(screen.getByRole('textbox', { name: 'Tên thương hiệu' })).toHaveValue('Brand New');
    expect(screen.getByRole('button', { name: 'Xem lại thay đổi' })).toBeEnabled();
    expect(screen.queryByText(/Đã lưu thương hiệu/)).not.toBeInTheDocument();
  });
  it.each([new Error('network'), new ApiError('server error', 503), new ApiError('bad 2xx body')])('locks writes after unknown outcome, even after successful GET: %s', async (failure) => {
    api.update.mockRejectedValue(failure);
    render(page()); await edit(); fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa rõ kết quả lưu');
    expect(screen.getByRole('button', { name: 'Xem lại thay đổi' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
    expect(await screen.findByRole('button', { name: 'Sửa thương hiệu Brand A' })).toBeDisabled();
    expect(screen.getByText(/GET không chứng minh/)).toBeVisible();
    expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('keeps saved success distinct from a failed reload; no form to resubmit', async () => {
    api.list.mockResolvedValueOnce(rows).mockRejectedValue(new Error('read failed'));
    render(page()); await edit(); fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách');
    expect(screen.getByRole('status')).toHaveTextContent('Đã lưu thương hiệu');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('blocks fast repeated submits while write is pending', async () => {
    const write = deferred<BrandWrite>(); api.update.mockReturnValue(write.promise);
    render(page()); await edit(); const confirm = screen.getByRole('button', { name: 'Xác nhận lưu' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Đang lưu…' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Tên thương hiệu' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Slug' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tải lại danh sách' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sửa thương hiệu Brand B' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hủy chỉnh sửa' })).toBeDisabled();
    await act(async () => write.resolve(response));
  });
  it('retains an unsaved draft after a failed read and a successful read retry', async () => {
    api.list.mockResolvedValueOnce(rows).mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(rows);
    render(page()); await edit();
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách');
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
    expect(await screen.findByRole('textbox', { name: 'Tên thương hiệu' })).toHaveValue('Brand New');
    expect(screen.getByRole('textbox', { name: 'Slug' })).toHaveValue('brand-a');
    expect(api.update).not.toHaveBeenCalled();
  });
  it('retains an uncertain draft and write lock after read-only reconciliation', async () => {
    api.update.mockRejectedValue(new Error('network'));
    render(page()); await edit(); fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    await screen.findByText(/Thao tác ghi đang bị khóa/);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
    expect(await screen.findByRole('textbox', { name: 'Tên thương hiệu' })).toHaveValue('Brand New');
    expect(screen.getByRole('textbox', { name: 'Tên thương hiệu' })).toBeDisabled();
    expect(api.update).toHaveBeenCalledTimes(1);
  });
  it('discards the old actor read after switching to another Admin session', async () => {
    const oldRead = deferred<AdminBrand[]>(); api.list.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce([{ ...rows[1], name: 'Admin B result' }]);
    const { rerender } = render(page()); await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    setAccessToken('other-test-only', 20); rerender(page({ ...admin, id: 20 }));
    expect(await screen.findByText('Admin B result')).toBeVisible();
    await act(async () => oldRead.resolve(rows));
    expect(screen.queryByText('Brand A')).not.toBeInTheDocument();
    expect(screen.getByText('Admin B result')).toBeVisible();
  });
  it('clears drafts when the same Admin starts a new login session', async () => {
    const { rerender } = render(page()); await edit();
    setAccessToken('same-user-new-session', admin.id); rerender(page());
    await screen.findByRole('button', { name: 'Sửa thương hiệu Brand A' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
  });
});
