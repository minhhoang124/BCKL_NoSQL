// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../../contexts/useAuth';
import { ApiError, setAccessToken } from '../../services/apiClient';
import { AdminCategoryAttributesReader } from './AdminCategoryAttributesReader';
import { createAttributeReadApi } from './attributeReadApi';
import type { ReadRequester } from './attributeReadApi';
// Keep fixtures independent of test modules (no registration side effects).
const row = (id = 1) => ({ id, categoryId: 12, name: `Thuộc tính ${id}`, slug: `thuoc-tinh-${id}`, dataType: 'SINGLE_SELECT',
  isRequired: false, isFilterable: false, allowsCustom: false, sortOrder: 0, isActive: true, revision: 3,
  usage: { referencedProductCount: 0 }, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' });
const option = (id: number) => ({ id, attributeDefinitionId: 1, value: `Lựa chọn ${id}`, slug: `lua-chon-${id}`, sortOrder: 0, isActive: false, referencedProductCount: 0 });
function view(request?: ReadRequester, role: 'ADMIN' | 'USER' = 'ADMIN', categoryId = 12) {
  return <AuthContext.Provider value={{ user: { id: 99, email: 'fake@example.test', fullName: 'Mẫu', role, isActive: true }, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}>
    <AdminCategoryAttributesReader categoryId={categoryId} api={request && createAttributeReadApi(request)} pageSize={1} />
  </AuthContext.Provider>;
}
afterEach(() => { cleanup(); setAccessToken(null); vi.restoreAllMocks(); });
describe('Attributes read-only screen', () => {
  it('defaults unconnected, not successful empty', () => {
    render(view()); expect(screen.getByText(/Chưa kết nối API đọc/)).toBeInTheDocument(); expect(screen.queryByText(/Không có thuộc tính phù hợp/)).not.toBeInTheDocument();
  });
  it('does not request for non-Admin', () => {
    const request = vi.fn(); render(view(request, 'USER')); expect(request).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('Cần tài khoản Admin');
  });
  it('loads ID-ordered pages, detail and inactive options with usage zero; no write controls', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/options')) return { items: [option(1)], nextCursor: null, definitionRevision: 3 };
      if (path.endsWith('/1')) return row();
      return path.includes('afterId=1') ? { items: [row(2)], nextCursor: null } : { items: [row()], nextCursor: 1 };
    });
    render(view(request));
    fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm thuộc tính' }));
    await screen.findByRole('button', { name: /Thuộc tính 2/ });
    fireEvent.click(screen.getByRole('button', { name: /Thuộc tính 1/ }));
    await screen.findByText('0 sản phẩm tham chiếu', { exact: false });
    expect(screen.getByText(/Lựa chọn 1 · lua-chon-1 · Tắt · 0 sản phẩm/)).toBeInTheDocument();
    expect(request.mock.calls.every(call => !call[0].includes('/public/'))).toBe(true);
    expect(screen.queryByRole('button', { name: /Lưu|Tạo|Xóa/ })).not.toBeInTheDocument();
  });
  it('clears options and detail when a later page revision changes; never auto-retries', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/options')) return { items: [option(path.includes('afterId') ? 2 : 1)], nextCursor: path.includes('afterId') ? null : 1, definitionRevision: path.includes('afterId') ? 4 : 3 };
      return path.endsWith('/1') ? row() : { items: [row()], nextCursor: null };
    });
    render(view(request)); fireEvent.click(await screen.findByRole('button', { name: /Thuộc tính 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm lựa chọn' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('đổi phiên bản');
    expect(screen.queryByText(/Lựa chọn 1 ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lựa chọn 2 ·/)).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('rejects detail revision newer than list before fetching options', async () => {
    const request = vi.fn(async (path: string) => path.endsWith('/1') ? { ...row(), revision: 4 } : { items: [row()], nextCursor: null });
    render(view(request)); fireEvent.click(await screen.findByRole('button', { name: /Thuộc tính 1/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('đổi phiên bản'); expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not reveal detail or first options when first options revision differs', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/options')) return { items: [option(1)], nextCursor: null, definitionRevision: 4 };
      return path.endsWith('/1') ? row() : { items: [row()], nextCursor: null };
    });
    render(view(request)); fireEvent.click(await screen.findByRole('button', { name: /Thuộc tính 1/ }));
    await screen.findByRole('alert');
    expect(within(screen.getByRole('region', { name: 'Chi tiết thuộc tính chỉ đọc' })).queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText(/Lựa chọn 1 ·/)).not.toBeInTheDocument();
  });
  it('discards old category response after switching category', async () => {
    let resolve: (v: unknown) => void = () => {};
    const request = vi.fn(async (path: string) => path.includes('/12/') ? new Promise(r => { resolve = r; }) : { items: [], nextCursor: null });
    const rendered = render(view(request));
    rendered.rerender(view(request, 'ADMIN', 13));
    await screen.findByText('Không có thuộc tính phù hợp.');
    await act(async () => resolve({ items: [row()], nextCursor: null }));
    expect(screen.queryByRole('button', { name: /Thuộc tính 1/ })).not.toBeInTheDocument();
  });
  it.each([401, 403])('clears all private rows after HTTP %i on detail', async status => {
    const request = vi.fn(async (path: string) => { if (path.endsWith('/1')) throw new ApiError('SECRET diagnostic', status); return { items: [row()], nextCursor: null }; });
    render(view(request)); fireEvent.click(await screen.findByRole('button', { name: /Thuộc tính 1/ }));
    await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: /Thuộc tính 1/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải lại danh sách' })).toBeDisabled(); expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
  });
  it('shows real empty separately from a safe retryable error', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('SECRET')).mockResolvedValue({ items: [], nextCursor: null });
    render(view(request)); await screen.findByRole('alert'); expect(screen.queryByText('Không có thuộc tính phù hợp.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' })); await screen.findByText('Không có thuộc tính phù hợp.');
  });
  it('ignores late detail after changing server filter and clears selection', async () => {
    let resolve: (v: unknown) => void = () => {};
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/1')) return new Promise(r => { resolve = r; });
      return { items: path.includes('isActive=false') ? [] : [row()], nextCursor: null };
    });
    render(view(request)); fireEvent.click(await screen.findByRole('button', { name: /Thuộc tính 1/ }));
    fireEvent.change(screen.getByLabelText('Trạng thái đọc'), { target: { value: 'INACTIVE' } });
    await screen.findByText('Không có thuộc tính phù hợp.');
    await act(async () => resolve(row()));
    expect(within(screen.getByRole('region', { name: 'Chi tiết thuộc tính chỉ đọc' })).queryByRole('heading')).not.toBeInTheDocument();
  });
  it('does not duplicate a page on double click', async () => {
    let resolve: (v: unknown) => void = () => {};
    const request = vi.fn().mockResolvedValueOnce({ items: [row()], nextCursor: 1 }).mockImplementation(() => new Promise(r => { resolve = r; }));
    render(view(request)); const button = await screen.findByRole('button', { name: 'Tải thêm thuộc tính' }); fireEvent.click(button); fireEvent.click(button);
    await act(async () => resolve({ items: [row(2)], nextCursor: null }));
    await screen.findByRole('button', { name: /Thuộc tính 2/ }); expect(request).toHaveBeenCalledTimes(2);
  });
  it('unmounts private rows when context changes to a non-Admin', async () => {
    const request = vi.fn().mockResolvedValue({ items: [row()], nextCursor: null });
    const rendered = render(view(request)); await screen.findByRole('button', { name: /Thuộc tính 1/ });
    rendered.rerender(view(request, 'USER')); await waitFor(() => expect(screen.queryByRole('button', { name: /Thuộc tính 1/ })).not.toBeInTheDocument());
  });
});
