// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/apiClient';
import { AdminCategoryAttributesEditor } from './AdminCategoryAttributesEditor';
import type { AttributeDefinition, AttributeReadApi } from './attributeReadApi';
import type { AttributeWriteApi } from './attributeWriteApi';
import { createAttributeWriteApi } from './attributeWriteApi';

const row: AttributeDefinition = { id: 7, categoryId: 3, name: 'Màu sắc', slug: 'mau-sac', dataType: 'TEXT', isRequired: false, isFilterable: false, allowsCustom: true, sortOrder: 0, isActive: false, revision: 4, createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', usage: { referencedProductCount: 0 } };
const reader: AttributeReadApi = { list: vi.fn().mockResolvedValue({ items: [row], nextCursor: null }), detail: vi.fn().mockResolvedValue(row), options: vi.fn() };
const api = (error: unknown): AttributeWriteApi => ({
  createDefinition: vi.fn(), patchDefinition: vi.fn().mockRejectedValue(error), createOption: vi.fn(), patchOption: vi.fn(),
});
afterEach(cleanup);
async function editAndSave(write: AttributeWriteApi, onLockChange = vi.fn()) {
  render(<AdminCategoryAttributesEditor categoryId={3} reader={reader} api={write} onLockChange={onLockChange} />);
  fireEvent.click(await screen.findByRole('button', { name: /Màu sắc · v4/ }));
  await screen.findByDisplayValue('Màu sắc');
  fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Màu sản phẩm' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thuộc tính' }));
  await screen.findByText(error => error.includes('stale') || error.includes('Không nhận được kết quả chắc chắn'));
  return onLockChange;
}
describe('AdminCategoryAttributesEditor write safety', () => {
  it('retains the draft and locks writes when a success response targets a different definition', async () => {
    const request = vi.fn().mockResolvedValue({ definition: { ...row, id: 99 }, option: null, searchReconciliation: null });
    render(<AdminCategoryAttributesEditor categoryId={3} reader={reader} api={createAttributeWriteApi(request)} />);
    fireEvent.click(await screen.findByRole('button', { name: /Màu sắc · v4/ }));
    await screen.findByDisplayValue('Màu sắc');
    fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Draft preserved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thuộc tính' }));
    await screen.findByText(/Tạm khóa chỉnh sửa để tránh cập nhật trùng/);
    expect(screen.getByLabelText('Tên')).toHaveValue('Draft preserved');
    expect(screen.getByRole('button', { name: 'Lưu thuộc tính' })).toBeDisabled();
    expect(screen.queryByText('Đã cập nhật thuộc tính.')).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('releases the form after reload in StrictMode', async () => {
    const list = vi.fn().mockResolvedValue({ items: [row], nextCursor: null });
    render(<StrictMode><AdminCategoryAttributesEditor categoryId={3} reader={{ ...reader, list }} /></StrictMode>);
    const reload = screen.getByRole('button', { name: 'Tải lại danh sách' });
    await waitFor(() => expect(reload).toBeEnabled());
    const calls = list.mock.calls.length;
    fireEvent.click(reload);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(calls + 1));
    await waitFor(() => expect(reload).toBeEnabled());
    expect(screen.getByLabelText('Tên')).toBeEnabled();
  });
  it('keeps the draft editable after a known 409 conflict', async () => {
    await editAndSave(api(new ApiError('stale', 409, 'ATTRIBUTE_REVISION_CONFLICT')));
    expect((screen.getByLabelText('Tên') as HTMLInputElement).value).toBe('Màu sản phẩm');
    expect((screen.getByRole('button', { name: 'Lưu thuộc tính' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps the draft but locks all writes after an unknown outcome', async () => {
    const lock = await editAndSave(api(new TypeError('network')));
    expect((screen.getByLabelText('Tên') as HTMLInputElement).value).toBe('Màu sản phẩm');
    expect((screen.getByRole('button', { name: 'Lưu thuộc tính' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Tạm khóa chỉnh sửa để tránh cập nhật trùng/)).toBeTruthy();
    await waitFor(() => expect(lock).toHaveBeenLastCalledWith(true));
  });
});
