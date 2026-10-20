// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAccountsLayout } from './AdminAccountsLayout';
import type { AccountLayoutExample } from './AdminAccountsLayout';

const examples: readonly AccountLayoutExample[] = Object.freeze([
  Object.freeze({ sampleId: 'DEMO-A', fullName: 'Nguyễn Minh An', email: 'buyer@example.test', role: 'USER' as const, isActive: true }),
  Object.freeze({ sampleId: 'DEMO-B', fullName: 'Đạt Minh Họa', email: 'seller@example.test', role: 'SELLER' as const, isActive: false }),
  Object.freeze({ sampleId: 'DEMO-C', fullName: null, email: 'seller-active@example.test', role: 'SELLER' as const, isActive: true }),
]);
const fetchSpy = vi.fn();
beforeEach(() => { fetchSpy.mockReset(); vi.stubGlobal('fetch', fetchSpy); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const openLock = () => {
  const trigger = screen.getByRole('button', { name: 'Xem trước khóa buyer@example.test' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

describe('Admin account layout preparation (not live account management)', () => {
  it('shows missing API rather than inventing empty account totals or fetching data', () => {
    render(<AdminAccountsLayout />);
    expect(screen.getByText('Chưa có API danh sách tài khoản.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Chưa có dữ liệu từ Backend');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Vai trò' })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clearly labels sample rows/counts, never a real system total', () => {
    render(<AdminAccountsLayout examples={examples} />);
    expect(screen.getByText('Dữ liệu minh họa — không phải tài khoản thật.')).toBeVisible();
    expect(screen.getByRole('table')).toHaveAccessibleName('Tài khoản minh họa, không phải dữ liệu hệ thống');
    expect(screen.getByRole('status')).toHaveTextContent('3 / 3 dòng minh họa');
    expect(screen.getByText('Chưa có tên hiển thị')).toBeVisible();
  });

  it.each(['nguyen minh', ' BUYER@EXAMPLE.TEST ', 'DEMO-A'])(
    'filters only supplied examples by normalized name/email/sample ID: %s', (query) => {
      render(<AdminAccountsLayout examples={examples} />);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
      expect(screen.getByRole('status')).toHaveTextContent('1 / 3 dòng minh họa');
      expect(screen.getByText('buyer@example.test')).toBeVisible();
      expect(screen.queryByText('seller@example.test')).not.toBeInTheDocument();
    },
  );

  it('combines role/status/search, then resets all filters', () => {
    render(<AdminAccountsLayout examples={examples} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Vai trò' }), { target: { value: 'SELLER' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Trạng thái' }), { target: { value: 'LOCKED' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'dat' } });
    expect(screen.getByRole('status')).toHaveTextContent('1 / 3 dòng minh họa');
    expect(screen.getByText('seller@example.test')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Vai trò' })).toHaveValue('ALL');
    expect(screen.getByRole('combobox', { name: 'Trạng thái' })).toHaveValue('ALL');
    expect(screen.getByRole('status')).toHaveTextContent('3 / 3 dòng minh họa');
  });

  it('distinguishes unmatched sample filters from missing Backend data', () => {
    render(<AdminAccountsLayout examples={examples} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'không tồn tại' } });
    expect(screen.getByText('Không có dòng minh họa phù hợp')).toBeVisible();
    expect(screen.getByText('Đây không phải kết quả truy vấn tài khoản thật.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại bộ lọc' }));
    expect(screen.getByRole('status')).toHaveTextContent('3 / 3 dòng minh họa');
  });

  it('handles explicitly empty examples without claiming Backend returned an empty list', () => {
    render(<AdminAccountsLayout examples={[]} />);
    expect(screen.getByText('Không có dòng minh họa')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('0 / 0 dòng minh họa');
  });

  it('never enables save, sends requests, persists reason, or changes sample status', () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    render(<AdminAccountsLayout examples={examples} />);
    openLock();
    const dialog = screen.getByRole('dialog', { name: 'Khóa tài khoản' });
    const save = within(dialog).getByRole('button', { name: 'Xác nhận (chưa kết nối)' });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Lý do minh họa' } });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    fireEvent.submit(within(dialog).getByRole('textbox'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(examples[0].isActive).toBe(true);
    storageSpy.mockRestore();
  });

  it.each(['cancel', 'escape'])('closes via %s, restores focus, and clears unsaved reason', (method) => {
    const { container } = render(<AdminAccountsLayout examples={examples} />);
    const trigger = openLock();
    const dialog = screen.getByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: 'Hủy' });
    expect(cancel).toHaveFocus();
    expect(container.querySelector('[inert]')).not.toBeNull();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Không giữ nội dung này' } });
    if (method === 'cancel') fireEvent.click(cancel);
    else fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(container.querySelector('[inert]')).toBeNull();
    fireEvent.click(trigger);
    expect(within(screen.getByRole('dialog')).getByRole('textbox')).toHaveValue('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('traps keyboard focus between reason and cancel, skipping disabled save', () => {
    render(<AdminAccountsLayout examples={examples} />);
    openLock();
    const dialog = screen.getByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: 'Hủy' });
    const reason = within(dialog).getByRole('textbox');
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(reason).toHaveFocus();
    fireEvent.keyDown(reason, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it('restores the clicked opener even when it was not focused before opening', () => {
    render(<AdminAccountsLayout examples={examples} />);
    const trigger = screen.getByRole('button', { name: 'Xem trước khóa buyer@example.test' });
    expect(trigger).not.toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(trigger).toHaveFocus();
  });

  it('previews unlocking a locked sample without changing it', () => {
    render(<AdminAccountsLayout examples={examples} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước mở khóa seller@example.test' }));
    expect(screen.getByRole('dialog', { name: 'Mở khóa tài khoản' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(examples[1].isActive).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
