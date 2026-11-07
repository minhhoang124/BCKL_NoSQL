// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { StateCard } from './StateCard';

afterEach(cleanup);

it('renders title, explanation and a link action', () => {
  render(<MemoryRouter><StateCard title="Không tìm thấy trang" action={{ label: 'Quay lại trang chủ', to: '/' }}><p>Mô tả</p></StateCard></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
  expect(screen.getByText('Mô tả')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Quay lại trang chủ' })).toHaveAttribute('href', '/');
});

it('runs a button action once per click and supports a status role', () => {
  const onClick = vi.fn();
  render(<MemoryRouter><StateCard title="Không có kết quả" role="status" action={{ label: 'Xóa bộ lọc', onClick }}><p>x</p></StateCard></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Không có kết quả');
});

it('renders no action when none is given', () => {
  render(<MemoryRouter><StateCard title="Sản phẩm đang hết hàng"><p>x</p></StateCard></MemoryRouter>);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
