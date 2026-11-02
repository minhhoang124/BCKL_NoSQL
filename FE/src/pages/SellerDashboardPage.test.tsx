// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellerDashboardPage } from './SellerDashboardPage';
import { MemoryRouter } from 'react-router-dom';
import { marketplaceApi } from '../services/marketplaceApi';
import { ApiError } from '../services/apiClient';
import type { Product } from '../types/marketplace';

const products: Product[] = [1, 2].map((id) => ({ id, name: `Product ${id}`, description: `Description ${id}`, category: { id, name: `Category ${id}`, slug: `cat-${id}` }, brand: id === 1 ? { id: 1, name: 'Brand 1', slug: 'brand-1' } : null, images: [], variants: [] }));
beforeEach(() => {
  vi.spyOn(marketplaceApi, 'categoryAttributes').mockResolvedValue({ id: 1, attributeDefinitions: [] });
  vi.spyOn(marketplaceApi, 'myStore').mockResolvedValue({ id: 1, name: 'Store', description: null, status: 'ACTIVE' });
  vi.spyOn(marketplaceApi, 'myProducts').mockResolvedValue(products);
  vi.spyOn(marketplaceApi, 'categories').mockResolvedValue([1, 2].map((id) => ({ id, name: `Category ${id}`, slug: `cat-${id}`, parentId: null, isLeaf: true, children: [] })));
  vi.spyOn(marketplaceApi, 'brands').mockResolvedValue([{ id: 1, name: 'Brand 1', slug: 'brand-1' }]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const backToList = () => fireEvent.click(screen.getByRole('button', { name: '← Danh sách sản phẩm' }));
async function open() {
  render(<MemoryRouter><SellerDashboardPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Sản phẩm (2)' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Chỉnh sửa' })[0]);
}
describe('Seller product editing', () => {
  it('switches A to B without leaking category or brand, then resets after save', async () => {
    const save = vi.spyOn(marketplaceApi, 'updateProduct').mockResolvedValue(products[1]);
    await open();
    expect(screen.getByLabelText('Danh mục')).toHaveValue('1');
    expect(screen.getByLabelText('Thương hiệu')).toHaveValue('1');
    backToList();
    fireEvent.click(screen.getAllByRole('button', { name: 'Chỉnh sửa' })[1]);
    expect(screen.getByLabelText('Tên')).toHaveValue('Product 2');
    expect(screen.getByLabelText('Danh mục')).toHaveValue('2');
    expect(screen.getByLabelText('Thương hiệu')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu sản phẩm' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(2, { name: 'Product 2', description: 'Description 2', categoryId: 2, brandId: null }));
    // A successful edit returns to the product list; the next "add" starts from a clean form.
    expect(await screen.findByRole('heading', { name: 'Sản phẩm của tôi' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Sản phẩm' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm sản phẩm mới' }));
    expect(screen.getByLabelText('Tên')).toHaveValue('');
    expect(screen.getByLabelText('Danh mục')).toHaveValue('');
    expect(marketplaceApi.myProducts).toHaveBeenCalledTimes(2);
  });

  it('preserves selection and edits when the save fails', async () => {
    vi.spyOn(marketplaceApi, 'updateProduct').mockRejectedValue(new ApiError('Save failed', 400));
    await open();
    backToList();
    fireEvent.click(screen.getAllByRole('button', { name: 'Chỉnh sửa' })[1]);
    fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Edited B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu sản phẩm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.getByRole('heading', { name: 'Chỉnh sửa sản phẩm' })).toBeInTheDocument();
    expect(screen.getByText(/Mã #2/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tên')).toHaveValue('Edited B');
    expect(screen.getByLabelText('Danh mục')).toHaveValue('2');
    expect(screen.getByLabelText('Thương hiệu')).toHaveValue('');
  });

  it('blocks duplicate submit and changing selection while a save is pending', async () => {
    let resolve!: (value: Product) => void;
    const save = vi.spyOn(marketplaceApi, 'updateProduct').mockReturnValue(new Promise((done) => { resolve = done; }));
    await open();
    const form = screen.getByRole('form', { name: 'Sản phẩm' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Lưu sản phẩm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '← Danh sách sản phẩm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thêm sản phẩm mới' })).toBeDisabled();
    await act(async () => resolve(products[0]));
    expect(await screen.findByRole('heading', { name: 'Sản phẩm của tôi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm sản phẩm mới' })).toBeEnabled();
  });

  it('clears all fields explicitly when returning to create mode', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo mới / bỏ chỉnh sửa' }));
    for (const label of ['Tên', 'Danh mục', 'Thương hiệu', 'Mô tả']) expect(screen.getByLabelText(label)).toHaveValue('');
  });
  it('keeps the product list and the add/edit form on separate screens', async () => {
    render(<MemoryRouter><SellerDashboardPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Sản phẩm (2)' }));
    expect(screen.getByRole('heading', { name: 'Sản phẩm của tôi' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Soạn sản phẩm' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm sản phẩm mới' }));
    expect(screen.getByRole('heading', { name: 'Thêm sản phẩm mới' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sản phẩm của tôi' })).not.toBeInTheDocument();
    backToList();
    expect(screen.getByRole('heading', { name: 'Sản phẩm của tôi' })).toBeInTheDocument();
  });
  it('reopens the edited product from ?tab=editor&product=', async () => {
    render(<MemoryRouter initialEntries={['/seller?tab=editor&product=2']}><SellerDashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Tên')).toHaveValue('Product 2'));
    expect(screen.getByRole('heading', { name: 'Chỉnh sửa sản phẩm' })).toBeInTheDocument();
  });
  it('blocks later steps until a changed category is saved (attributes follow the saved category)', async () => {
    await open();
    expect(screen.getByRole('button', { name: '3. Phân loại & Giá/Kho' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Danh mục'), { target: { value: '2' } });
    expect(screen.getByRole('button', { name: '3. Phân loại & Giá/Kho' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '5. Gửi duyệt' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Danh mục đã đổi nhưng chưa lưu');
    fireEvent.change(screen.getByLabelText('Danh mục'), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: '3. Phân loại & Giá/Kho' })).toBeEnabled();
  });
  it('renders guided step wizard and allows switching between available steps', async () => {
    await open();
    // In edit mode (product 1 selected), all 5 step tabs should be rendered
    expect(screen.getByRole('button', { name: '1. Thông tin cơ bản' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2. Ảnh sản phẩm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3. Phân loại & Giá/Kho' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4. Kiện hàng' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5. Gửi duyệt' })).toBeInTheDocument();

    // Click step 2
    fireEvent.click(screen.getByRole('button', { name: '2. Ảnh sản phẩm' }));
    expect(screen.getByRole('heading', { name: '2. Ảnh đại diện sản phẩm' })).toBeInTheDocument();

    // Click step 3
    fireEvent.click(screen.getByRole('button', { name: '3. Phân loại & Giá/Kho' }));
    expect(screen.getByRole('heading', { name: '3. Phân loại, Thuộc tính & Giá/Kho SKU' })).toBeInTheDocument();

    // Click step 4
    fireEvent.click(screen.getByRole('button', { name: '4. Kiện hàng' }));
    expect(screen.getByRole('heading', { name: '4. Thông tin kiện hàng & Vận chuyển' })).toBeInTheDocument();

    // Click step 5
    fireEvent.click(screen.getByRole('button', { name: '5. Gửi duyệt' }));
    expect(screen.getByRole('heading', { name: '5. Kiểm tra & gửi duyệt' })).toBeInTheDocument();
  });
});
