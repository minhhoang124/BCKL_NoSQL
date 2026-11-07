// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCategoryAttributesLayout } from './AdminCategoryAttributesLayout';
import type { CategoryAttributeExample, LayoutState } from './AdminCategoryAttributesLayout';

const examples: readonly CategoryAttributeExample[] = [
  { sampleKey: 'A', name: 'Kết nối', slug: 'ket-noi', dataType: 'SINGLE_SELECT', isRequired: true, isFilterable: true, allowsCustom: false, isActive: true, sortOrder: 0, revision: 3, usage: 6,
    options: [{ sampleKey: 'O1', value: 'Bluetooth', slug: 'bluetooth', sortOrder: 0, isActive: true, usage: 6 }, { sampleKey: 'O2', value: 'Có dây', slug: 'co-day', sortOrder: 1, isActive: false, usage: 0 }] },
  { sampleKey: 'B', name: 'Công suất', slug: 'cong-suat', dataType: 'NUMBER', isRequired: false, isFilterable: false, allowsCustom: true, isActive: true, sortOrder: 1, revision: 1, usage: 0, options: [] },
  { sampleKey: 'C', name: 'Chống nước', slug: 'chong-nuoc', dataType: 'BOOLEAN', isRequired: false, isFilterable: false, allowsCustom: true, isActive: false, sortOrder: 2, revision: 1, usage: null, options: [] },
];
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const list = () => within(screen.getByRole('region', { name: 'Danh sách thuộc tính minh họa' }));
const editor = () => within(screen.getByRole('region', { name: 'Trình soạn thuộc tính' }));
function select(name: string) { fireEvent.click(list().getByRole('button', { name: new RegExp(name) })); }

describe('Category attribute preparation only', () => {
  it('defaults to waiting for API, not a successful empty list', () => {
    render(<AdminCategoryAttributesLayout />);
    expect(screen.getByText('Chờ kết nối dữ liệu thật')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Bản nháp thuộc tính' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tìm thuộc tính minh họa')).toBeDisabled();
    expect(screen.queryByText(/0 sản phẩm/)).not.toBeInTheDocument();
  });
  it('labels all examples and includes inactive definitions/options', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    expect(screen.getByText('Dữ liệu minh họa — không phải cấu hình thật.')).toBeInTheDocument();
    expect(list().getByRole('button', { name: /Chống nước/ })).toHaveTextContent('Tắt');
    expect(editor().getByRole('button', { name: /Có dây/ })).toHaveTextContent('Tắt');
    expect(screen.getByText(/false và 0 vẫn hợp lệ/)).toBeInTheDocument();
  });
  it('filters only samples using Vietnamese names and combines status/type', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.change(screen.getByLabelText('Tìm thuộc tính minh họa'), { target: { value: 'ket noi' } });
    expect(list().getByText('1 / 3 dòng mẫu')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Trạng thái thuộc tính'), { target: { value: 'INACTIVE' } });
    expect(list().getByText('Không có thuộc tính minh họa phù hợp.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    fireEvent.change(screen.getByLabelText('Lọc kiểu dữ liệu'), { target: { value: 'BOOLEAN' } });
    expect(list().getByText('1 / 3 dòng mẫu')).toBeInTheDocument();
  });
  it('locks used identity and distinguishes unknown usage from zero', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    expect(screen.getByLabelText('Slug thuộc tính')).toBeDisabled();
    expect(screen.getByLabelText('Kiểu dữ liệu')).toBeDisabled();
    expect(screen.getByLabelText('Giá trị lựa chọn')).toBeDisabled();
    expect(screen.getByLabelText('Slug lựa chọn')).toBeDisabled();
    select('Công suất');
    expect(screen.getByLabelText('Slug thuộc tính')).toBeEnabled();
    expect(screen.getByLabelText('Kiểu dữ liệu')).toBeEnabled();
    select('Chống nước');
    expect(editor().getByText('Chưa có số liệu sử dụng')).toBeInTheDocument();
    expect(screen.getByLabelText('Slug thuộc tính')).toBeDisabled();
  });
  it('keeps a SELECT type locked when options exist even without product usage', () => {
    render(<AdminCategoryAttributesLayout examples={[{ ...examples[0], usage: 0 }]} />);
    expect(screen.getByLabelText('Kiểu dữ liệu')).toBeDisabled();
    expect(screen.getByLabelText('Slug thuộc tính')).toBeEnabled();
  });
  it('keeps definition drafts when switching and never updates the list as saved', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: 'Kết nối đang sửa' } });
    select('Công suất'); select('Kết nối');
    expect(screen.getByLabelText('Tên thuộc tính')).toHaveValue('Kết nối đang sửa');
    expect(list().getByRole('button', { name: /Kết nối/ })).not.toHaveTextContent('đang sửa');
  });
  it('keeps option drafts across options and across non-SELECT definitions', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.click(editor().getByRole('button', { name: /Có dây/ }));
    fireEvent.change(screen.getByLabelText('Giá trị lựa chọn'), { target: { value: 'Có dây đang sửa' } });
    fireEvent.click(editor().getByRole('button', { name: /Bluetooth/ }));
    fireEvent.click(editor().getByRole('button', { name: /Có dây/ }));
    expect(screen.getByLabelText('Giá trị lựa chọn')).toHaveValue('Có dây đang sửa');
    select('Công suất'); select('Kết nối');
    expect(screen.getByLabelText('Giá trị lựa chọn')).toHaveValue('Có dây đang sửa');
  });
  it('has no options UI for non-SELECT and does not treat custom as another type', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />); select('Công suất');
    expect(screen.queryByRole('region', { name: 'Lựa chọn chuẩn của thuộc tính' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Cho nhập ngoài lựa chọn')).toBeDisabled();
  });
  it('supports a new inactive draft but does not add a row', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    select('Thêm thuộc tính minh họa');
    expect(screen.getByLabelText('Đang bật')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: 'Thuộc tính mới' } });
    fireEvent.change(screen.getByLabelText('Slug thuộc tính'), { target: { value: 'thuoc-tinh-moi' } });
    expect(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Lưu thuộc tính (chưa kết nối)' })).toBeDisabled();
    expect(list().getByText('3 / 3 dòng mẫu')).toBeInTheDocument();
  });
  it('blocks preliminary invalid fields and required SELECT with no active option', () => {
    render(<AdminCategoryAttributesLayout examples={[]} />);
    expect(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: 'Hợp lệ' } });
    fireEvent.change(screen.getByLabelText('Slug thuộc tính'), { target: { value: 'hop-le' } });
    fireEvent.change(screen.getByLabelText('Thứ tự thuộc tính'), { target: { value: '2147483648' } });
    expect(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Thứ tự thuộc tính'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Kiểu dữ liệu'), { target: { value: 'SINGLE_SELECT' } });
    fireEvent.click(screen.getByLabelText('Bắt buộc')); fireEvent.click(screen.getByLabelText('Đang bật')); fireEvent.click(screen.getByLabelText('Cho nhập ngoài lựa chọn'));
    expect(screen.getByRole('alert')).toHaveTextContent('ít nhất một lựa chọn đang bật');
    expect(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' })).toBeDisabled();
  });
  it('opens confirmation with reason and effects but never enables a real write', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.click(screen.getByLabelText('Bắt buộc'));
    const opener = screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' });
    fireEvent.click(opener);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/Nới quy tắc/)).toBeInTheDocument();
    const reason = dialog.getByLabelText('Lý do dự kiến (minh họa)');
    fireEvent.change(reason, { target: { value: 'Lý do kiểm bố cục' } });
    expect(dialog.getByRole('button', { name: 'Xác nhận (chưa kết nối)' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Thuộc tính ngành hàng', hidden: true }).closest('[inert]')).not.toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
  });
  it('traps focus, supports Escape and restores the opener', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.change(screen.getByLabelText('Thứ tự lựa chọn'), { target: { value: '2' } });
    const opener = screen.getByRole('button', { name: 'Xem trước xác nhận lựa chọn' }); fireEvent.click(opener);
    const dialog = screen.getByRole('dialog'); const cancel = within(dialog).getByRole('button', { name: 'Hủy' });
    const reason = within(dialog).getByLabelText('Lý do dự kiến (minh họa)');
    expect(cancel).toHaveFocus(); fireEvent.keyDown(cancel, { key: 'Tab' }); expect(reason).toHaveFocus();
    fireEvent.keyDown(reason, { key: 'Tab', shiftKey: true }); expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
  });
  it.each<LayoutState>(['loading', 'error', 'pending', 'stale', 'unknown'])('labels %s as illustration and locks edits', (state) => {
    render(<AdminCategoryAttributesLayout examples={examples} state={state} />);
    expect(screen.getByLabelText('Tìm thuộc tính minh họa')).toBeDisabled();
    if (state === 'loading' || state === 'error') expect(screen.queryByRole('form', { name: 'Bản nháp thuộc tính' })).not.toBeInTheDocument();
    else expect(screen.getByLabelText('Tên thuộc tính')).toBeDisabled();
    expect(screen.getByRole('complementary', { name: 'Giới hạn bản xem trước' })).toHaveTextContent('Minh họa');
  });
  it('retains drafts through stale/unknown modes without GET-based unlocking', () => {
    const { rerender } = render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: 'Bản nháp giữ lại' } });
    rerender(<AdminCategoryAttributesLayout examples={examples} state="stale" />);
    expect(screen.getByLabelText('Tên thuộc tính')).toHaveValue('Bản nháp giữ lại');
    rerender(<AdminCategoryAttributesLayout examples={examples} state="unknown" />);
    expect(screen.getByLabelText('Tên thuộc tính')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Tải lại/ })).not.toBeInTheDocument();
  });
  it('keeps definition and option drafts when loading/error hides the editor', () => {
    const { rerender } = render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: 'Tên đang sửa' } });
    fireEvent.click(editor().getByRole('button', { name: /Có dây/ }));
    fireEvent.change(screen.getByLabelText('Giá trị lựa chọn'), { target: { value: 'Lựa chọn đang sửa' } });
    rerender(<AdminCategoryAttributesLayout examples={examples} state="loading" />);
    rerender(<AdminCategoryAttributesLayout examples={examples} state="error" />);
    rerender(<AdminCategoryAttributesLayout examples={examples} />);
    expect(screen.getByLabelText('Tên thuộc tính')).toHaveValue('Tên đang sửa');
    expect(screen.getByLabelText('Giá trị lựa chọn')).toHaveValue('Lựa chọn đang sửa');
  });
  it('does not call fetch or persistent storage, including form submission', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const store = vi.spyOn(Storage.prototype, 'setItem');
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.submit(screen.getByRole('form', { name: 'Bản nháp thuộc tính' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Bản nháp lựa chọn' }));
    fireEvent.click(screen.getByLabelText('Bắt buộc'));
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' }));
    fireEvent.change(screen.getByLabelText('Lý do dự kiến (minh họa)'), { target: { value: 'Lý do' } });
    expect(fetch).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled();
  });
  it('does not preview an unchanged definition or option', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    expect(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xem trước xác nhận lựa chọn' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: '  Kết nối  ' } });
    expect(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' })).toBeDisabled();
  });
  it('shows the actual delta and shared revision, with required policy reason', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.click(screen.getByLabelText('Bắt buộc'));
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('list', { name: 'Các thay đổi dự kiến' })).toHaveTextContent('Bắt buộc: Có → Không');
    expect(dialog.getByText(/Phiên bản mẫu đang đối chiếu: 3/)).toBeInTheDocument();
    const reason = dialog.getByLabelText('Lý do dự kiến (minh họa)');
    expect(reason).toHaveAttribute('aria-required', 'true');
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(reason, { target: { value: 'Ngắn' } });
    expect(dialog.getByRole('status')).toHaveTextContent('10–500');
    fireEvent.change(reason, { target: { value: 'Lý do hợp lệ để đổi cấu hình' } });
    expect(reason).toHaveAttribute('aria-invalid', 'false');
    expect(dialog.getByRole('button', { name: 'Xác nhận (chưa kết nối)' })).toBeDisabled();
  });
  it('does not require a policy reason for sortOrder-only but validates provided reasons', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.change(screen.getByLabelText('Thứ tự thuộc tính'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' }));
    const dialog = within(screen.getByRole('dialog'));
    const reason = dialog.getByLabelText('Lý do dự kiến (minh họa)');
    expect(reason).toHaveAttribute('aria-required', 'false');
    expect(reason).toHaveAttribute('aria-invalid', 'false');
    fireEvent.change(reason, { target: { value: 'Ngắn' } });
    expect(reason).toHaveAttribute('aria-invalid', 'true');
  });
  it('warns when disabling the last option, requires reason but does not invent a prohibition', () => {
    render(<AdminCategoryAttributesLayout examples={examples} />);
    fireEvent.click(screen.getByLabelText('Lựa chọn đang bật'));
    expect(screen.getByRole('alert')).toHaveTextContent('lựa chọn đang bật cuối cùng');
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước xác nhận lựa chọn' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Lý do dự kiến (minh họa)')).toHaveAttribute('aria-required', 'true');
    expect(list().getByText('3 / 3 dòng mẫu')).toBeInTheDocument();
  });
  it('reports each invalid field and connects the explanation to its input', () => {
    render(<AdminCategoryAttributesLayout examples={[]} />);
    fireEvent.change(screen.getByLabelText('Slug thuộc tính'), { target: { value: 'Slug SAI' } });
    fireEvent.change(screen.getByLabelText('Thứ tự thuộc tính'), { target: { value: '-1' } });
    for (const label of ['Tên thuộc tính', 'Slug thuộc tính', 'Thứ tự thuộc tính']) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(document.getElementById(input.getAttribute('aria-describedby')!)).toBeInTheDocument();
    }
  });
  it.each([false, true])('requires reason for new required definition only when active=%s', (active) => {
    render(<AdminCategoryAttributesLayout examples={[]} />);
    fireEvent.change(screen.getByLabelText('Tên thuộc tính'), { target: { value: 'Ghi chú' } });
    fireEvent.change(screen.getByLabelText('Slug thuộc tính'), { target: { value: 'ghi-chu' } });
    if (active) fireEvent.click(screen.getByLabelText('Đang bật'));
    fireEvent.click(screen.getByLabelText('Bắt buộc'));
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước xác nhận thuộc tính' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Lý do dự kiến (minh họa)')).toHaveAttribute('aria-required', String(active));
  });
});
