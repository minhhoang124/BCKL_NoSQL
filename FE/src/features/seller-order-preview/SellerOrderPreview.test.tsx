// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SellerOrderDetailPreviewPage, SellerOrderPreviewLayout, SellerOrdersPreviewPage } from './SellerOrderPreview';

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No transaction API in preview'); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals(); });
function show(path = '/dev/seller-orders') {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/dev/seller-orders" element={<SellerOrderPreviewLayout />}>
      <Route index element={<SellerOrdersPreviewPage />} />
      <Route path=":demoId" element={<SellerOrderDetailPreviewPage />} />
    </Route>
  </Routes></MemoryRouter>);
}
function confirm(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByRole('region', { name: 'Xác nhận thao tác mẫu' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý đổi trạng thái mẫu' }));
}
it('labels list and shows scoped sample orders without API', () => {
  show();
  expect(screen.getByText('SELLER DEMO — KHÔNG XỬ LÝ ĐƠN THẬT')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Xem chi tiết DEMO-SELLER/ })).toHaveLength(3);
});
it('confirms and packs locally, stops at handover and keeps status on navigation', () => {
  show('/dev/seller-orders/seller-demo-pending');
  confirm('Xác nhận đơn mẫu');
  confirm('Bắt đầu đóng gói mẫu');
  confirm('Đã đóng gói mẫu');
  expect(screen.getByRole('heading', { name: 'Sẵn sàng bàn giao' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /đã giao|hoàn tất/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: '← Đơn của Store mẫu' }));
  expect(screen.getAllByText('Sẵn sàng bàn giao').filter((element) => element.tagName === 'SPAN')).toHaveLength(1);
});
it('does not advance before confirmation and lets the seller back out', () => {
  show('/dev/seller-orders/seller-demo-pending');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đơn mẫu' }));
  expect(screen.getByRole('heading', { name: 'Chờ xác nhận' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xác nhận đơn mẫu' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua thao tác mẫu' }));
  expect(screen.getByRole('button', { name: 'Xác nhận đơn mẫu' })).toBeEnabled();
});
it('keeps source status on simulated error and retries without duplicate history', () => {
  show('/dev/seller-orders/seller-demo-pending');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Minh họa lỗi trước thao tác' }));
  confirm('Xác nhận đơn mẫu');
  expect(screen.getByRole('alert')).toHaveTextContent('chưa đổi');
  expect(screen.getByRole('heading', { name: 'Chờ xác nhận' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Minh họa lỗi trước thao tác' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý đổi trạng thái mẫu' }));
  expect(screen.getByRole('heading', { name: 'Đã xác nhận' })).toBeInTheDocument();
  expect(screen.getAllByText('Đã xác nhận · chỉ trong phiên mẫu')).toHaveLength(1);
});
it('recovers empty filter, loading and read errors without commands', () => {
  show();
  fireEvent.change(screen.getByLabelText('Trạng thái Seller'), { target: { value: 'READY_TO_SHIP' } });
  expect(screen.getByRole('status')).toHaveTextContent('Chưa có đơn');
  fireEvent.click(screen.getByRole('button', { name: 'Xem lại dữ liệu Seller mẫu' }));
  fireEvent.change(screen.getByLabelText('Tình huống Seller mẫu'), { target: { value: 'loading' } });
  expect(screen.getByRole('status')).toHaveTextContent('Đang tải');
  fireEvent.change(screen.getByLabelText('Tình huống Seller mẫu'), { target: { value: 'error' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Chưa tải được');
});
it('does not expose commands while loading and handles unknown IDs', () => {
  show('/dev/seller-orders/seller-demo-pending');
  fireEvent.change(screen.getByLabelText('Tình huống Seller mẫu'), { target: { value: 'loading' } });
  expect(screen.queryByRole('button', { name: 'Xác nhận đơn mẫu' })).not.toBeInTheDocument();
  cleanup(); show('/dev/seller-orders/125');
  expect(screen.getByRole('heading', { name: 'Không tìm thấy đơn Seller mẫu' })).toBeInTheDocument();
});
it('blocks seller delivery controls and resets fixture state explicitly', () => {
  show('/dev/seller-orders/seller-demo-pending');
  confirm('Xác nhận đơn mẫu');
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đóng gói mẫu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Khôi phục tất cả đơn mẫu' }));
  expect(screen.getByRole('heading', { name: 'Chờ xác nhận' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Xác nhận thao tác mẫu' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xác nhận đơn mẫu' })).toBeEnabled();
  cleanup(); show('/dev/seller-orders/seller-demo-shipping');
  expect(screen.queryByRole('button', { name: /đánh dấu|hoàn tất/i })).not.toBeInTheDocument();
});
