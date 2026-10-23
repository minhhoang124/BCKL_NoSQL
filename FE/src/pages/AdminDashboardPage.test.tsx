// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchApi } from '../services/apiClient';
import { AdminDashboardPage } from './AdminDashboardPage';
import { unknownHealth } from '../features/admin-system-health/systemHealth.fixtures';

vi.mock('../services/apiClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/apiClient')>(),
  fetchApi: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  user: { id: 1, email: 'admin@example.com', fullName: 'Admin Demo', role: 'ADMIN', isActive: true },
  logout: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchApi).mockReset();
  auth.user = { id: 1, email: 'admin@example.com', fullName: 'Admin Demo', role: 'ADMIN', isActive: true };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

vi.mock('../contexts/useAuth', () => ({
  useAuth: () => auth,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const productDetail = {
  id: 45,
  name: 'Tai nghe mẫu',
  storeId: 8,
  version: 3,
  moderationStatus: 'PENDING',
  sellerStatus: 'DRAFT',
  submittedAt: '2026-09-28T12:00:00.000Z',
  description: 'Mô tả sản phẩm',
  images: [
    {
      id: 1,
      url: 'http://localhost:3001/uploads/45/main.jpg',
      isPrimary: true,
    },
  ],
  variants: [
    {
      id: 2,
      skuCode: 'SKU-2',
      sellerSku: 'SELLER-2',
      price: '125000',
      stock: 6,
      isActive: true,
    },
  ],
  statusHistory: [],
};

function renderAdmin(path = '/admin/products/45') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<AdminDashboardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Admin Catalog delayed writes', () => {
  const categories = [
    { id: 1, name: 'Category A', slug: 'category-a', parentId: null, isActive: true },
    { id: 2, name: 'Category B', slug: 'category-b', parentId: null, isActive: true },
  ];
  function setup(write: Promise<unknown>) {
    vi.mocked(fetchApi).mockImplementation((path, options) => {
      if (options?.method) return write;
      if (path === '/admin/categories') return Promise.resolve(categories);
      if (path === '/admin/brands') return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
    renderAdmin('/admin/catalog');
  }

  it('locks selection, create/cancel, draft inputs, tabs and reload until Category save finishes', async () => {
    let finish!: (value: unknown) => void;
    setup(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(await screen.findByRole('button', { name: /Category A/ }));
    fireEvent.change(screen.getByLabelText('Tên danh mục'), { target: { value: 'Edited A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(screen.getByRole('button', { name: /Category B/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Tạo mới/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hủy chỉnh sửa' })).toBeDisabled();
    expect(screen.getByLabelText('Tên danh mục')).toBeDisabled();
    expect(screen.getByLabelText('Mã đường dẫn')).toBeDisabled();
    expect(screen.getByLabelText('Danh mục cha')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Thương hiệu 0/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Làm mới/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Category B/ }));
    expect(screen.getByLabelText('Tên danh mục')).toHaveValue('Edited A');
    await act(async () => finish({}));
    await waitFor(() => expect(screen.getByRole('button', { name: /Category B/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Category B/ }));
    fireEvent.change(screen.getByLabelText('Tên danh mục'), { target: { value: 'Draft B' } });
    expect(screen.getByLabelText('Tên danh mục')).toHaveValue('Draft B');
    expect(vi.mocked(fetchApi).mock.calls.filter(([, opts]) => opts?.method)).toEqual([
      ['/admin/categories/1', { method: 'PATCH', body: JSON.stringify({ name: 'Edited A', slug: 'category-a', parentId: null }) }],
    ]);
  });

  it('preserves the Category draft on failed save and unlocks editing', async () => {
    let fail!: (error: unknown) => void;
    setup(new Promise((_, reject) => { fail = reject; }));
    fireEvent.click(await screen.findByRole('button', { name: /Category A/ }));
    fireEvent.change(screen.getByLabelText('Tên danh mục'), { target: { value: 'Keep draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await act(async () => fail(new ApiError('Slug đã tồn tại', 409)));
    expect(await screen.findByRole('alert')).toHaveTextContent('Slug đã tồn tại');
    expect(screen.getByLabelText('Tên danh mục')).toHaveValue('Keep draft');
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled();
  });

  it('locks Brand draft and cross-tab changes while Brand create is pending', async () => {
    let finish!: (value: unknown) => void;
    setup(new Promise(resolve => { finish = resolve; }));
    await screen.findByRole('button', { name: /Category A/ });
    fireEvent.click(screen.getByRole('button', { name: /Thương hiệu 0/ }));
    fireEvent.change(screen.getByLabelText('Tên thương hiệu'), { target: { value: 'Brand draft' } });
    fireEvent.change(screen.getByLabelText('Mã đường dẫn'), { target: { value: 'brand-draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thương hiệu' }));
    expect(screen.getByLabelText('Tên thương hiệu')).toBeDisabled();
    expect(screen.getByLabelText('Mã đường dẫn')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Danh mục 2/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Làm mới/ })).toBeDisabled();
    await act(async () => finish({}));
    await waitFor(() => expect(screen.getByLabelText('Tên thương hiệu')).toBeEnabled());
    expect(screen.getByLabelText('Tên thương hiệu')).toHaveValue('');
  });

  it('preserves the Brand draft after a delayed failure', async () => {
    let fail!: (error: unknown) => void;
    setup(new Promise((_, reject) => { fail = reject; }));
    await screen.findByRole('button', { name: /Category A/ });
    fireEvent.click(screen.getByRole('button', { name: /Thương hiệu 0/ }));
    fireEvent.change(screen.getByLabelText('Tên thương hiệu'), { target: { value: 'Keep brand' } });
    fireEvent.change(screen.getByLabelText('Mã đường dẫn'), { target: { value: 'keep-brand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm thương hiệu' }));
    await act(async () => fail(new ApiError('Slug trùng', 409)));
    expect(await screen.findByRole('alert')).toHaveTextContent('Slug trùng');
    expect(screen.getByLabelText('Tên thương hiệu')).toHaveValue('Keep brand');
    expect(screen.getByLabelText('Mã đường dẫn')).toHaveValue('keep-brand');
    expect(screen.getByRole('button', { name: 'Thêm thương hiệu' })).toBeEnabled();
  });

  it('keeps edit identity/draft and blocks writes after reload failure or missing Category', async () => {
    setup(Promise.resolve({}));
    fireEvent.click(await screen.findByRole('button', { name: /Category A/ }));
    fireEvent.change(screen.getByLabelText('Tên danh mục'), { target: { value: 'Retained draft' } });
    vi.mocked(fetchApi).mockRejectedValueOnce(new Error('Read failed'));
    fireEvent.click(screen.getByRole('button', { name: /Làm mới/ }));
    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'Chỉnh sửa danh mục' })).toBeVisible();
    expect(screen.getByText('Đang sửa #1')).toBeVisible();
    expect(screen.getByLabelText('Tên danh mục')).toHaveValue('Retained draft');
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    vi.mocked(fetchApi).mockImplementation((path) => Promise.resolve(path === '/admin/categories' ? [categories[1]] : []));
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByRole('button', { name: /Category B/ });
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    expect(screen.getByLabelText('Tên danh mục')).toHaveValue('Retained draft');
    expect(vi.mocked(fetchApi).mock.calls.filter(([, opts]) => opts?.method)).toHaveLength(0);
  });
});

describe('Admin product moderation', () => {
  it('requires a successful Store reload after an uncertain write without auto-resending', async () => {
    const stores = [{ id: 8, name: 'Store QA', status: 'PENDING', statusHistory: [] }];
    vi.mocked(fetchApi).mockResolvedValueOnce(stores).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderAdmin('/admin/stores');
    const approve = await screen.findByRole('button', { name: 'Duyệt cửa hàng' });
    fireEvent.change(screen.getByLabelText('Lý do quyết định'), { target: { value: 'Đủ hồ sơ' } });
    fireEvent.click(approve);
    await screen.findByRole('alert');
    expect(approve).toBeDisabled();
    fireEvent.click(approve);
    expect(fetchApi).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Lý do quyết định')).toHaveValue('Đủ hồ sơ');
    vi.mocked(fetchApi).mockResolvedValueOnce(stores);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Duyệt cửa hàng' })).toBeEnabled());
    expect(fetchApi).toHaveBeenLastCalledWith('/admin/stores');
  });

  it('blocks inactive Admin before reading any API', () => {
    auth.user.isActive = false;
    renderAdmin();
    expect(screen.getByRole('alert')).toHaveTextContent('Admin đang hoạt động');
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it('does not show the previous Admin product while the next Admin is loading', async () => {
    vi.mocked(fetchApi).mockResolvedValueOnce(productDetail);
    const view = renderAdmin();
    await screen.findByRole('heading', { name: productDetail.name });
    auth.user = { ...auth.user, id: 2 };
    vi.mocked(fetchApi).mockImplementationOnce(() => new Promise(() => {}));
    view.rerender(<MemoryRouter initialEntries={['/admin/products/45']}><Routes><Route path="/admin/*" element={<AdminDashboardPage />} /></Routes></MemoryRouter>);
    expect(screen.queryByRole('heading', { name: productDetail.name })).not.toBeInTheDocument();
    expect(screen.getByText('Đang tải hồ sơ sản phẩm…')).toBeInTheDocument();
  });

  it('preserves boolean false and numeric zero in Product attributes', async () => {
    vi.mocked(fetchApi).mockResolvedValueOnce({ ...productDetail, attributeValues: [
      { id: 1, attributeDefinition: { name: 'Chống nước' }, textValue: null, numberValue: null, booleanValue: false },
      { id: 2, attributeDefinition: { name: 'Độ trễ' }, textValue: null, numberValue: '0', booleanValue: null },
    ] });
    renderAdmin();
    expect(await screen.findByText('Không')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('connects the existing users route and menu to real Accounts GET, not status writes', async () => {
    vi.mocked(fetchApi).mockResolvedValueOnce({ items: [], nextCursor: null });
    renderAdmin('/admin/users');
    expect(await screen.findByText('Không có tài khoản phù hợp')).toBeVisible();
    expect(screen.getByRole('link', { name: /Tài khoản/ })).toHaveAttribute('href', '/admin/users');
    expect(fetchApi).toHaveBeenCalledWith('/admin/accounts?limit=50', expect.objectContaining({ method: 'GET', retryOnUnauthorized: false }));
    expect(screen.queryByRole('button', { name: /khóa|mở khóa/i })).not.toBeInTheDocument();
  });

  it('clears and blocks Accounts controls when the integrated endpoint denies access', async () => {
    vi.mocked(fetchApi).mockRejectedValueOnce(new ApiError('Private diagnostic', 403));
    renderAdmin('/admin/users');
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền đọc danh sách Admin');
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.queryByText(/Private diagnostic/)).not.toBeInTheDocument();
  });

  it('connects the system-health route to Backend only and labels UNKNOWN honestly', async () => {
    vi.mocked(fetchApi).mockResolvedValueOnce(unknownHealth);
    renderAdmin('/admin/system-health');
    expect(await screen.findByText('Không kết nối được AI service')).toBeVisible();
    expect(screen.getByRole('link', { name: /Sức khỏe hệ thống/ })).toHaveAttribute('href', '/admin/system-health');
    expect(fetchApi).toHaveBeenCalledWith('/admin/system-health', expect.objectContaining({
      method: 'GET', cache: 'no-store', retryOnUnauthorized: false,
    }));
    expect(screen.getByText(/không chứng minh outbox đã đồng bộ hết/i)).toBeVisible();
  });

  it('shows saved attributes, option labels and shipping fields for review', async () => {
    vi.mocked(fetchApi).mockResolvedValueOnce({ ...productDetail,
      attributeValues: [{ id: 1, attributeDefinition: { name: 'Bảo hành' }, textValue: '12 tháng', numberValue: null, booleanValue: null }],
      shippingProfile: { packageWeightGrams: 250, packageLengthCm: '20', packageWidthCm: '15', packageHeightCm: '10' },
    });
    renderAdmin();
    expect(await screen.findByText('12 tháng')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('20 × 15 × 10')).toBeInTheDocument();
  });

  it('blocks double-submit and requires reload after a version conflict, retaining the reason', async () => {
    let reject!: (error: unknown) => void;
    vi.mocked(fetchApi).mockResolvedValueOnce(productDetail).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    renderAdmin();
    await screen.findByText('Tai nghe mẫu');
    fireEvent.change(screen.getByLabelText('Ghi chú / lý do'), { target: { value: 'Cần kiểm tra lại' } });
    const button = screen.getByRole('button', { name: 'Yêu cầu chỉnh sửa' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchApi).toHaveBeenCalledTimes(2);
    reject(new ApiError('Phiên bản đã đổi', 409));
    await screen.findByRole('alert');
    expect(button).toBeDisabled();
    expect(screen.getByLabelText('Ghi chú / lý do')).toHaveValue('Cần kiểm tra lại');
    vi.mocked(fetchApi).mockResolvedValueOnce({ ...productDetail, version: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Phiên bản nội dung: v4');
    expect(screen.getByRole('button', { name: 'Yêu cầu chỉnh sửa' })).toBeEnabled();
  });

  it('honors cancellation without issuing a moderation request', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    vi.mocked(fetchApi).mockResolvedValueOnce(productDetail);
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: /Duyệt sản phẩm/ }));
    expect(fetchApi).toHaveBeenCalledTimes(1);
  });

  it('shows forbidden without a false empty queue', async () => {
    vi.mocked(fetchApi).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    renderAdmin('/admin/products');
    expect(await screen.findByRole('alert')).toHaveTextContent('không có quyền');
    expect(screen.queryByText('Chưa có sản phẩm chờ duyệt')).not.toBeInTheDocument();
  });

  it('requires a reason before rejecting and sends the version shown on screen', async () => {
    vi.mocked(fetchApi).mockResolvedValueOnce(productDetail);
    renderAdmin();

    expect(
      await screen.findByRole('heading', { name: 'Tai nghe mẫu' }),
    ).toBeInTheDocument();
    const rejectButton = screen.getByRole('button', {
      name: 'Yêu cầu chỉnh sửa',
    });
    expect(rejectButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Ghi chú / lý do'), {
      target: { value: 'Thiếu thông tin bảo hành' },
    });
    expect(rejectButton).toBeEnabled();
    vi.mocked(fetchApi).mockResolvedValueOnce({});
    fireEvent.click(rejectButton);

    await waitFor(() =>
      expect(fetchApi).toHaveBeenLastCalledWith('/admin/products/45/reject', {
        method: 'POST',
        body: JSON.stringify({
          version: 3,
          reason: 'Thiếu thông tin bảo hành',
        }),
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Đã yêu cầu chỉnh sửa sản phẩm.',
    );
  });
});
