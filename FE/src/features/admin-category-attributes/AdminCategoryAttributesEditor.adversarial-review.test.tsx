// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminCategoryAttributesEditor } from './AdminCategoryAttributesEditor';
import type { AttributeDefinition, AttributeReadApi } from './attributeReadApi';
import type { AttributeWriteApi } from './attributeWriteApi';
import { ApiError } from '../../services/apiClient';

const row: AttributeDefinition = { id: 7, categoryId: 3, name: 'Màu sắc', slug: 'mau-sac', dataType: 'TEXT', isRequired: false, isFilterable: false, allowsCustom: true, sortOrder: 0, isActive: false, revision: 4, createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', usage: { referencedProductCount: 0 } };
afterEach(cleanup);
it('serializes two write events before React can rerender disabled controls', async () => {
  const reader: AttributeReadApi = { list: vi.fn().mockResolvedValue({ items: [row], nextCursor: null }), detail: vi.fn().mockResolvedValue(row), options: vi.fn() };
  const write: AttributeWriteApi = { createDefinition: vi.fn(), patchDefinition: vi.fn().mockImplementation(() => new Promise(() => {})), createOption: vi.fn(), patchOption: vi.fn() };
  render(<AdminCategoryAttributesEditor categoryId={3} reader={reader} api={write} />);
  fireEvent.click(await screen.findByRole('button', { name: /Màu sắc · v4/ }));
  const save = screen.getByRole('button', { name: 'Lưu thuộc tính' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Changed by QA' } });
  act(() => {
    save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    screen.getByRole('button', { name: /Màu sắc · v4/ }).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    screen.getByRole('button', { name: 'Tải lại danh sách' }).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    screen.getByRole('button', { name: '+ Thuộc tính mới' }).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(write.patchDefinition).toHaveBeenCalledTimes(1);
  expect(reader.detail).toHaveBeenCalledTimes(1);
  expect(reader.list).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Tên')).toHaveValue('Changed by QA');
});

it('serializes two selections in the same tick before either detail read resolves', async () => {
  const rows = [row, { ...row, id: 8, name: 'Chất liệu' }];
  const reader: AttributeReadApi = { list: vi.fn().mockResolvedValue({ items: rows, nextCursor: null }), detail: vi.fn().mockImplementation(() => new Promise(() => {})), options: vi.fn() };
  render(<AdminCategoryAttributesEditor categoryId={3} reader={reader} />);
  const first = await screen.findByRole('button', { name: /Màu sắc · v4/ });
  await waitFor(() => expect(first).toBeEnabled());
  act(() => {
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    screen.getByRole('button', { name: /Chất liệu · v4/ }).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(reader.detail).toHaveBeenCalledExactlyOnceWith(3, 7);
});

it.each([false, true])('releases the activity latch but retains unknown-write lock=%s after list reload', async (unknown) => {
  const reader: AttributeReadApi = { list: vi.fn().mockResolvedValue({ items: [row], nextCursor: null }), detail: vi.fn().mockResolvedValue(row), options: vi.fn() };
  const write: AttributeWriteApi = { createDefinition: vi.fn(), patchDefinition: vi.fn().mockRejectedValue(unknown ? new TypeError('network') : new ApiError('stale version', 409, 'ATTRIBUTE_REVISION_CONFLICT')), createOption: vi.fn(), patchOption: vi.fn() };
  render(<AdminCategoryAttributesEditor categoryId={3} reader={reader} api={write} />);
  fireEvent.click(await screen.findByRole('button', { name: /Màu sắc · v4/ }));
  const save = screen.getByRole('button', { name: 'Lưu thuộc tính' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  if (unknown) await screen.findByText(/Tạm khóa chỉnh sửa để tránh cập nhật trùng/);
  else await screen.findByText(/stale version/);
  const reload = screen.getByRole('button', { name: 'Tải lại danh sách' });
  await waitFor(() => expect(reload).toBeEnabled());
  fireEvent.click(reload);
  await waitFor(() => expect(reader.list).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(reload).toBeEnabled());
  if (unknown) {
    expect(save).toBeDisabled();
    expect(write.patchDefinition).toHaveBeenCalledTimes(1);
  } else {
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(write.patchDefinition).toHaveBeenCalledTimes(2));
  }
});
