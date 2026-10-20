// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchApi, setAccessToken } from '../services/apiClient';
import { AdminDashboardPage } from './AdminDashboardPage';

vi.mock('../services/apiClient', async (original) => ({
  ...await original<typeof import('../services/apiClient')>(), fetchApi: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  user: { id: 1, email: 'admin@example.test', fullName: 'Admin QA', role: 'ADMIN', isActive: true },
  loading: false, logout: vi.fn(),
}));
vi.mock('../contexts/useAuth', () => ({ useAuth: () => auth }));
const originalBrands = [
  { id: 5, name: 'Brand A', slug: 'brand-a', isActive: true },
  { id: 6, name: 'Brand B', slug: 'brand-b', isActive: false },
];
const category = { id: 1, name: 'Category A', slug: 'category-a', parentId: null, isActive: true };
let brands = structuredClone(originalBrands);
const writes = () => vi.mocked(fetchApi).mock.calls.filter(([, options]) => options?.method);
function setup(write?: (path: string, options: RequestInit) => Promise<unknown>) {
  vi.mocked(fetchApi).mockImplementation((path, options) => {
    if (options?.method) return write ? write(path, options) as ReturnType<typeof fetchApi> : Promise.resolve({});
    if (path === '/admin/categories') return Promise.resolve([category]);
    if (path === '/admin/brands') return Promise.resolve(structuredClone(brands));
    return Promise.reject(new Error(`Unexpected path: ${path}`));
  });
  return render(<MemoryRouter initialEntries={['/admin/catalog']}><Routes><Route path="/admin/*" element={<AdminDashboardPage />} /></Routes></MemoryRouter>);
}
async function openEditor() {
  fireEvent.click(await screen.findByRole('button', { name: 'Thương hiệu 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sửa tên/slug thương hiệu' }));
  const editor = screen.getByRole('region', { name: 'Sửa thương hiệu Admin' });
  await within(editor).findByRole('button', { name: 'Sửa thương hiệu Brand A' });
  return within(editor);
}
async function reviewName() {
  const editor = await openEditor();
  fireEvent.click(editor.getByRole('button', { name: 'Sửa thương hiệu Brand A' }));
  fireEvent.change(editor.getByRole('textbox', { name: 'Tên thương hiệu' }), { target: { value: 'Renamed Brand' } });
  fireEvent.click(editor.getByRole('button', { name: 'Xem lại thay đổi' }));
  return editor;
}
beforeEach(() => {
  brands = structuredClone(originalBrands);
  vi.mocked(fetchApi).mockReset();
  setAccessToken('test-only', 1);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); setAccessToken(null); vi.restoreAllMocks(); });

describe('Brand editor integrated in the real Admin Catalog', () => {
  it('mounts only after opening the editor; retains the existing Category and Brand create/toggle controls', async () => {
    setup();
    await screen.findByRole('button', { name: /Category A/ });
    expect(screen.queryByRole('region', { name: 'Sửa thương hiệu Admin' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo danh mục' })).toBeEnabled();
    const editor = await openEditor();
    expect(editor.getByText('Brand B')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Thêm thương hiệu' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Tắt' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Bật' })).toBeEnabled();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(writes()).toHaveLength(0);
  });
  it('sends only the changed name after consent and refreshes the legacy Brand list without changing slug/status', async () => {
    setup(async (_path, options) => {
      brands[0] = { ...brands[0], ...JSON.parse(options.body as string) };
      return { ...brands[0], searchReconciliation: { jobId: '10', status: 'PENDING' } };
    });
    const editor = await reviewName();
    expect(writes()).toHaveLength(0);
    fireEvent.click(editor.getByRole('button', { name: 'Xác nhận lưu' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm thương hiệu' })).toBeEnabled());
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe('/admin/brands/5');
    expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ name: 'Renamed Brand' });
    expect(writes()[0][1]).toMatchObject({ method: 'PATCH', retryOnUnauthorized: false });
    expect(brands[0]).toEqual({ ...originalBrands[0], name: 'Renamed Brand' });
    expect(screen.getAllByText('Renamed Brand')).toHaveLength(2);
    expect(editor.getByRole('status')).toHaveTextContent('chưa xác nhận index đã đồng bộ');
  });
  it('shares the write lock with legacy create/toggle, tabs and refresh during confirmation and pending PATCH', async () => {
    let finish!: (value: unknown) => void;
    setup(() => new Promise(resolve => { finish = resolve; }));
    const editor = await reviewName();
    for (const name of ['Thêm thương hiệu', 'Tắt', 'Bật', 'Danh mục 1']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: /Làm mới/ })).toBeDisabled();
    fireEvent.click(editor.getByRole('button', { name: 'Xác nhận lưu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tắt' }));
    expect(writes()).toHaveLength(1);
    await act(async () => finish({ ...brands[0], name: 'Renamed Brand', searchReconciliation: null }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tắt' })).toBeEnabled());
  });
  it('unlocks legacy controls when review is cancelled without sending a write', async () => {
    setup(); const editor = await reviewName();
    fireEvent.click(editor.getByRole('button', { name: 'Quay lại sửa' }));
    expect(screen.getByRole('button', { name: 'Thêm thương hiệu' })).toBeEnabled();
    expect(editor.getByRole('textbox', { name: 'Tên thương hiệu' })).toHaveValue('Renamed Brand');
    expect(writes()).toHaveLength(0);
  });
  it('retains draft across Category/Brand tabs rather than remounting the editor', async () => {
    setup(); const editor = await reviewName();
    fireEvent.click(editor.getByRole('button', { name: 'Quay lại sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Danh mục 1' }));
    expect(screen.queryByRole('region', { name: 'Sửa thương hiệu Admin' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thương hiệu 2' }));
    expect(editor.getByRole('textbox', { name: 'Tên thương hiệu' })).toHaveValue('Renamed Brand');
    expect(writes()).toHaveLength(0);
  });
  it('keeps the 409 draft and unlocks existing controls, without reporting saved', async () => {
    setup(async () => { throw new ApiError('Slug trùng', 409); });
    const editor = await reviewName();
    fireEvent.click(editor.getByRole('button', { name: 'Xác nhận lưu' }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Slug trùng');
    expect(editor.getByRole('textbox', { name: 'Tên thương hiệu' })).toHaveValue('Renamed Brand');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm thương hiệu' })).toBeEnabled());
    expect(editor.queryByRole('status')).not.toBeInTheDocument();
  });
  it('keeps all Catalog mutations and tab switching locked after unknown outcome even after GET succeeds', async () => {
    setup(async () => { throw new TypeError('Network response lost'); });
    const editor = await reviewName();
    fireEvent.click(editor.getByRole('button', { name: 'Xác nhận lưu' }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Chưa rõ kết quả');
    fireEvent.click(editor.getByRole('button', { name: 'Tải lại danh sách' }));
    await waitFor(() => expect(editor.getByRole('textbox', { name: 'Tên thương hiệu' })).toBeDisabled());
    for (const name of ['Thêm thương hiệu', 'Tắt', 'Bật', 'Danh mục 1']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(writes()).toHaveLength(1);
  });
  it('disables the editor during legacy Brand create and refreshes it after success', async () => {
    let finish!: (value: unknown) => void;
    setup(() => new Promise(resolve => { finish = resolve; }));
    const editor = await openEditor();
    fireEvent.change(screen.getByLabelText('Tên thương hiệu', { selector: '#brand-name' }), { target: { value: 'New Brand' } });
    fireEvent.change(screen.getByLabelText('Mã đường dẫn'), { target: { value: 'new-brand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thương hiệu' }));
    expect(editor.getByRole('button', { name: 'Sửa thương hiệu Brand A' })).toBeDisabled();
    expect(editor.getByRole('button', { name: 'Tải lại danh sách' })).toBeDisabled();
    brands.push({ id: 7, name: 'New Brand', slug: 'new-brand', isActive: true });
    await act(async () => finish(brands[2]));
    expect(await editor.findByText('New Brand')).toBeVisible();
    expect(writes()[0]).toEqual(['/admin/brands', { method: 'POST', body: JSON.stringify({ name: 'New Brand', slug: 'new-brand' }) }]);
  });
  it('preserves legacy Brand toggle payload and refreshes the embedded editor status', async () => {
    setup(async (_path, options) => {
      brands[0].isActive = JSON.parse(options.body as string).isActive;
      return { ...brands[0], searchReconciliation: { jobId: '11', status: 'PENDING' } };
    });
    const editor = await openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Tắt' }));
    await waitFor(() => expect(editor.getAllByText('Đã tắt')).toHaveLength(2));
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toEqual(['/admin/brands/5', { method: 'PATCH', body: JSON.stringify({ isActive: false }) }]);
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });
});
