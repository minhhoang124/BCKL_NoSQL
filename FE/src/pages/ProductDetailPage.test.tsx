// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { ProductDetailPage } from './ProductDetailPage';
import { marketplaceApi } from '../services/marketplaceApi';
import type { Product } from '../types/marketplace';
import { AuthSessionChangedError } from '../services/apiClient';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const product = (id: number): Product => ({ id, name: `Product ${id}`, description: null, category: { id: 1, name: 'Audio', slug: 'audio' }, brand: null, images: [], variants: [] });
function View() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/products/2')}>Next product</button><Routes><Route path="/products/:id" element={<ProductDetailPage />} /></Routes></>;
}
it('retries only the public GET once when initial auth bootstrap changes its epoch',async()=>{
  const request=vi.spyOn(marketplaceApi,'publicProduct').mockRejectedValueOnce(new AuthSessionChangedError()).mockResolvedValueOnce(product(1));
  render(<MemoryRouter initialEntries={['/products/1']}><View/></MemoryRouter>);
  await screen.findByRole('heading',{name:'Product 1'});expect(request).toHaveBeenCalledTimes(2);
});
it('bounds repeated public session transitions',async()=>{
  const request=vi.spyOn(marketplaceApi,'publicProduct').mockRejectedValue(new AuthSessionChangedError());
  render(<MemoryRouter initialEntries={['/products/1']}><View/></MemoryRouter>);await screen.findByRole('alert');expect(request).toHaveBeenCalledTimes(2);
});
it('does not automatically retry ordinary public network failures',async()=>{
  const request=vi.spyOn(marketplaceApi,'publicProduct').mockRejectedValue(new TypeError('offline'));
  render(<MemoryRouter initialEntries={['/products/1']}><View/></MemoryRouter>);await screen.findByRole('alert');expect(request).toHaveBeenCalledTimes(1);
});
it('ignores stale detail responses and never renders NaN when price is absent', async () => {
  let resolve!: (value: Product) => void;
  vi.spyOn(marketplaceApi, 'publicProduct').mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValueOnce(product(2));
  render(<MemoryRouter initialEntries={['/products/1']}><View /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Next product' }));
  await screen.findByRole('heading', { name: 'Product 2' });
  await act(async () => resolve(product(1)));
  expect(screen.queryByRole('heading', { name: 'Product 1' })).not.toBeInTheDocument();
  expect(screen.getByText('Liên hệ')).toBeInTheDocument();
  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
});
it('recovers from an error when opening another product', async () => {
  vi.spyOn(marketplaceApi, 'publicProduct').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(product(2));
  render(<MemoryRouter initialEntries={['/products/1']}><View /></MemoryRouter>);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Next product' }));
  await screen.findByRole('heading', { name: 'Product 2' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
