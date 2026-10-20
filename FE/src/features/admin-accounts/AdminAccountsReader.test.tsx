// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../../contexts/useAuth';
import { ApiError, setAccessToken } from '../../services/apiClient';
import { AdminAccountsReader } from './AdminAccountsReader';
import { createAccountReadApi } from './accountReadApi';
import type { AccountReadApi, AccountRequester } from './accountReadApi';
const row = (id = 1) => ({ id, email: `account${id}@example.test`, fullName: null, role: 'USER', isActive: true,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', store: null });
function view(api?: AccountReadApi, actor = 99, role: 'USER' | 'ADMIN' = 'ADMIN') {
  return <AuthContext.Provider value={{ user: { id: actor, email: 'admin@example.test', fullName: 'QA', role, isActive: true }, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}>
    <AdminAccountsReader api={api} pageSize={1} /></AuthContext.Provider>;
}
function setup(request: AccountRequester) { const api = createAccountReadApi(request); return { api, ...render(view(api)) }; }
afterEach(() => { cleanup(); setAccessToken(null); vi.restoreAllMocks(); });
describe('Accounts read screen', () => {
  it('keeps missing API distinct from successful empty, disables filters', () => {
    render(view()); expect(screen.getByText('Chưa kết nối API Accounts')).toBeVisible(); expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.queryByText('Không có tài khoản phù hợp')).not.toBeInTheDocument();
  });
  it('does not request for non-Admin', () => {
    const request = vi.fn(); render(view(createAccountReadApi(request), 99, 'USER')); expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Cần tài khoản Admin');
  });
  it('shows CLOSED separately from account activity and keeps ACTIVE/null Store rows', async () => {
    const request = vi.fn().mockResolvedValue({ items: [
      { ...row(1), role: 'SELLER', store: { id: 10, name: 'Active store', status: 'ACTIVE' } },
      { ...row(2), role: 'SELLER', store: { id: 11, name: 'Closed store', status: 'CLOSED' } },
      row(3),
    ], nextCursor: null });
    render(<AuthContext.Provider value={{ user: { id: 99, email: 'admin@example.test', fullName: 'QA', role: 'ADMIN', isActive: true }, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}>
      <AdminAccountsReader api={createAccountReadApi(request)} pageSize={50} />
    </AuthContext.Provider>);
    expect(await screen.findByText('Store #11 · Đã đóng')).toBeVisible();
    expect(screen.getByText('Store #10 · Hoạt động')).toBeVisible();
    expect(screen.getByText('Chưa có Store')).toBeVisible();
    expect(screen.getByText('account2@example.test').closest('tr')).toHaveTextContent('Đang hoạt động');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /khóa|mở/i })).not.toBeInTheDocument();
  });
  it('renders paginated results including ADMIN/null Store and no lock/unlock controls', async () => {
    const request = vi.fn(async (path: string) => path.includes('afterId') ? { items: [{ ...row(2), role: 'ADMIN', isActive: false }], nextCursor: null } : { items: [row()], nextCursor: 1 });
    setup(request); fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm tài khoản' }));
    await screen.findByText('account2@example.test'); expect(screen.getAllByText('Quản trị viên').length).toBeGreaterThan(0); expect(screen.getAllByText('Chưa có tên hiển thị', { selector: 'strong' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /khóa|mở/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('Chưa có Store')).toHaveLength(2); expect(screen.queryByRole('button', { name: 'Tải thêm tài khoản' })).not.toBeInTheDocument();
  });
  it('submits q/role/inactive to Backend and resets the cursor, not a client-side page filter', async () => {
    const request = vi.fn(async (path: string) => path.includes('isActive=false') ? { items: [], nextCursor: null } : { items: [row()], nextCursor: 1 });
    setup(request); await screen.findByText('account1@example.test');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' A\u0301 ' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Vai trò' }), { target: { value: 'SELLER' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Trạng thái tài khoản' }), { target: { value: 'LOCKED' } });
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' })); await screen.findByText('Không có tài khoản phù hợp');
    const url = new URL(request.mock.calls[1][0], 'https://test.invalid');
    expect(url.searchParams.get('q')).toBe('Á'); expect(url.searchParams.get('role')).toBe('SELLER'); expect(url.searchParams.get('isActive')).toBe('false'); expect(url.searchParams.has('afterId')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' })); await screen.findByText('account1@example.test'); expect(request.mock.calls[2][0]).toBe('/admin/accounts?limit=1');
  });
  it('shows loading, true empty and safe retryable errors separately', async () => {
    let resolve: (value: unknown) => void = () => {};
    const request = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ items: [], nextCursor: null });
    setup(request); expect(screen.getByRole('status')).toHaveTextContent('Đang tải'); expect(screen.queryByText('Không có tài khoản phù hợp')).not.toBeInTheDocument();
    await act(async () => resolve({ items: [], nextCursor: null })); await screen.findByText('Không có tài khoản phù hợp');
    request.mockRejectedValueOnce(new Error('SECRET diagnostic'));
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại từ đầu' })); await screen.findByRole('alert');
    expect(screen.queryByText('Không có tài khoản phù hợp')).not.toBeInTheDocument(); expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại từ đầu' })); await screen.findByText('Không có tài khoản phù hợp');
  });
  it.each([401, 403])('clears rows and blocks controls on HTTP %i loading more', async status => {
    const request = vi.fn().mockResolvedValueOnce({ items: [row()], nextCursor: 1 }).mockRejectedValue(new ApiError('SECRET', status));
    setup(request); fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm tài khoản' })); await screen.findByRole('alert');
    expect(screen.queryByText('account1@example.test')).not.toBeInTheDocument(); expect(screen.getByRole('searchbox')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Tải lại từ đầu' })).toBeDisabled();
  });
  it('discards late pages when a new search replaces the old query', async () => {
    let resolve: (value: unknown) => void = () => {};
    const request = vi.fn(async (path: string) => path.includes('q=new') ? { items: [row(9)], nextCursor: null } : new Promise(r => { resolve = r; }));
    setup(request); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } }); fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    await screen.findByText('account9@example.test'); await act(async () => resolve({ items: [row()], nextCursor: null }));
    expect(screen.queryByText('account1@example.test')).not.toBeInTheDocument();
  });
  it.each([99, 100])('starts a clean read for new session (actor %i) and ignores old response', async actor => {
    let resolve: (value: unknown) => void = () => {};
    const request = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ items: [row(9)], nextCursor: null });
    const rendered = setup(request); setAccessToken(null); rendered.rerender(view(rendered.api, actor));
    await screen.findByText('account9@example.test'); await act(async () => resolve({ items: [row()], nextCursor: null }));
    expect(screen.queryByText('account1@example.test')).not.toBeInTheDocument();
  });
  it('does not request an extra page twice on double click', async () => {
    let resolve: (value: unknown) => void = () => {};
    const request = vi.fn().mockResolvedValueOnce({ items: [row()], nextCursor: 1 }).mockImplementation(() => new Promise(r => { resolve = r; }));
    setup(request); const button = await screen.findByRole('button', { name: 'Tải thêm tài khoản' }); fireEvent.click(button); fireEvent.click(button);
    await act(async () => resolve({ items: [row(2)], nextCursor: null })); await screen.findByText('account2@example.test'); expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects overlong/control q locally without clearing already applied results', async () => {
    const request = vi.fn().mockResolvedValue({ items: [row()], nextCursor: null }); setup(request); await screen.findByText('account1@example.test');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'x'.repeat(121) } }); fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(screen.getByRole('alert')).toHaveTextContent('120'); expect(request).toHaveBeenCalledTimes(1); expect(screen.getByText('account1@example.test')).toBeVisible();
  });
  it('clears prior data after malformed next page and allows retry from start', async () => {
    const request = vi.fn().mockResolvedValueOnce({ items: [row()], nextCursor: 1 }).mockResolvedValueOnce({ items: [row()], nextCursor: 1 }).mockResolvedValue({ items: [], nextCursor: null });
    setup(request); fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm tài khoản' })); await screen.findByRole('alert');
    expect(screen.queryByText('account1@example.test')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Tải lại từ đầu' })); await screen.findByText('Không có tài khoản phù hợp');
  });
  it('removes private results as soon as context loses Admin access', async () => {
    const request = vi.fn().mockResolvedValue({ items: [row()], nextCursor: null }); const rendered = setup(request); await screen.findByText('account1@example.test');
    rendered.rerender(view(rendered.api, 99, 'USER')); await waitFor(() => expect(screen.queryByText('account1@example.test')).not.toBeInTheDocument());
  });
});
