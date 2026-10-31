// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { HomePage } from './HomePage';
import { marketplaceApi } from '../services/marketplaceApi';
import type { Product, SearchResponse } from '../types/marketplace';

const session=vi.hoisted(()=>({loading:false}));
vi.mock('../contexts/useAuth',()=>({useAuth:()=>session}));
const product = (id: number): Product => ({ id, name: `Product ${id}`, description: null, category: { id: 2, name: 'Audio', slug: 'audio' }, brand: { id: 3, name: 'Brand', slug: 'brand' }, images: [], variants: [], inStock: true });
beforeEach(() => {
  session.loading=false;
  vi.spyOn(marketplaceApi, 'categories').mockResolvedValue([{ id: 1, name: 'Electronics', slug: 'electronics', parentId: null, isLeaf: false, children: [{ id: 2, name: 'Audio', slug: 'audio', parentId: 1, isLeaf: true, children: [] }] }]);
  vi.spyOn(marketplaceApi, 'brands').mockResolvedValue([{ id: 3, name: 'Brand', slug: 'brand' }]);
});

it('uses the same parent-category subtree filter for listing and keyword search', async () => {
  const list = vi.spyOn(marketplaceApi, 'publicProducts').mockResolvedValue({ items: [], nextCursor: null });
  const search = vi.spyOn(marketplaceApi, 'search').mockResolvedValue({ items: [], responseTimeMs: 1 });
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Tìm kiếm' });

  fireEvent.change(screen.getByLabelText('Danh mục'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ limit: 24, categoryId: 1 }));

  fireEvent.change(screen.getByLabelText('Từ khóa'), { target: { value: 'headphones' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
  await waitFor(() => expect(search).toHaveBeenLastCalledWith({ query: 'headphones', topK: 24, candidateK: 100, categoryIds: [1] }));
  expect(await screen.findByText('Không có kết quả phù hợp. Hãy thử từ khóa khác hoặc bỏ bớt bộ lọc.')).toBeInTheDocument();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each([undefined, 'false', 'true'])('exposes image search only for the explicit enable flag %s', async (flag) => {
  vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', flag);
  vi.spyOn(marketplaceApi, 'publicProducts').mockResolvedValue({ items: [], nextCursor: null });
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Tìm kiếm' });
  const link = screen.queryByRole('link', { name: 'Tìm sản phẩm bằng ảnh' });
  if (flag === 'true') expect(link).toHaveAttribute('href', '/search/image');
  else expect(link).not.toBeInTheDocument();
});

it('sends filters to Backend and follows the cursor even after an empty page', async () => {
  const list = vi.spyOn(marketplaceApi, 'publicProducts')
    .mockResolvedValueOnce({ items: [], nextCursor: null })
    .mockResolvedValueOnce({ items: [], nextCursor: 200 })
    .mockResolvedValueOnce({ items: [product(201)], nextCursor: null });
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Tìm kiếm' });
  fireEvent.change(screen.getByLabelText('Danh mục'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Thương hiệu'), { target: { value: '3' } });
  fireEvent.click(screen.getByLabelText('Còn hàng'));
  fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
  await screen.findByRole('button', { name: 'Tải thêm sản phẩm' });
  expect(list).toHaveBeenLastCalledWith({ limit: 24, categoryId: 2, brandId: 3, inStock: true });
  expect(screen.queryByText('Chưa có sản phẩm phù hợp.')).not.toBeInTheDocument();
  // Changing controls without submitting must not change the applied pagination filters.
  fireEvent.change(screen.getByLabelText('Thương hiệu'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tải thêm sản phẩm' }));
  await screen.findByRole('link', { name: 'Product 201' });
  expect(list).toHaveBeenLastCalledWith({ limit: 24, categoryId: 2, brandId: 3, inStock: true, afterId: 200 });
});

function Navigation() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/?q=new')}>Next query</button><HomePage /></>;
}
it('ignores a late response for the old query after navigation', async () => {
  let resolve!: (value: SearchResponse) => void;
  vi.spyOn(marketplaceApi, 'search')
    .mockReturnValueOnce(new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce({ items: [{ productId: 2, rank: 1, score: 1, product: product(2) }], responseTimeMs: 1 });
  render(<MemoryRouter initialEntries={['/?q=old']}><Navigation /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Next query' }));
  await screen.findByRole('link', { name: 'Product 2' });
  await act(async () => resolve({ items: [{ productId: 1, rank: 1, score: 1, product: product(1) }], responseTimeMs: 1 }));
  expect(screen.queryByRole('link', { name: 'Product 1' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Từ khóa')).toHaveValue('new');
});

it('clears a previous query error when navigation succeeds', async () => {
  vi.spyOn(marketplaceApi, 'search').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], responseTimeMs: 1 });
  render(<MemoryRouter initialEntries={['/?q=old']}><Navigation /></MemoryRouter>);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Next query' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  await screen.findByRole('button', { name: 'Tìm kiếm' });
});

it('waits for initial session bootstrap before public Search/listing calls',async()=>{
  session.loading=true;const list=vi.spyOn(marketplaceApi,'publicProducts').mockResolvedValue({items:[],nextCursor:null});
  const page=render(<MemoryRouter><HomePage/></MemoryRouter>);expect(screen.getByRole('status')).toHaveTextContent('Đang chuẩn bị');expect(list).not.toHaveBeenCalled();expect(marketplaceApi.categories).not.toHaveBeenCalled();
  session.loading=false;page.rerender(<MemoryRouter><HomePage/></MemoryRouter>);await waitFor(()=>expect(list).toHaveBeenCalledOnce());
});
