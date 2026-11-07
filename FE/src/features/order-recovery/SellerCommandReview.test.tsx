// @vitest-environment jsdom
// Preparation-only view. No routes, HTTP/DB or command controller integration.
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellerCommandReview, type SellerReviewTarget, type SellerReviewPhase } from './SellerCommandReview';
import type { VerifiedOrderSession } from './orderCommandCoordinator';
import { PREPARATION_COMMANDS } from '../../types/order';

const target: SellerReviewTarget = { actorId: 8, sessionVersion: 2, orderId: 19, orderNumber: 'ORDER-QA-19', command: 'confirm' };
const session: VerifiedOrderSession = { actor: { id: 8, role: 'SELLER' }, version: 2, isActive: true };
const base = { session, target, phase: 'confirm-new' as const, fresh: true };
const transport = vi.fn();
beforeEach(() => { transport.mockClear(); vi.stubGlobal('fetch', transport); });
afterEach(() => { cleanup(); expect(transport).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('Seller confirmation/status view — not connected to Order routes', () => {
  it('defaults to disabled without a dispatcher and carries the preparation label', () => {
    render(<SellerCommandReview {...base} />);
    expect(screen.getByText(/Thao tác đơn hàng hiện chưa khả dụng/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Xác nhận thao tác' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
  it.each(PREPARATION_COMMANDS)('requires a separate confirmation before dispatching %s once', command => {
    const send = vi.fn(); render(<SellerCommandReview {...base} target={{ ...target, command }} onConfirm={send} />);
    const submit = screen.getByRole('button', { name: 'Xác nhận thao tác' });
    expect(submit).toBeDisabled(); fireEvent.click(submit); expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(submit); fireEvent.click(submit);
    expect(send).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledWith({ ...target, command }, false);
    expect(submit).toBeDisabled();
  });
  it('cancel only closes confirmation, without preparing/sending an intent', () => {
    const send = vi.fn(), cancel = vi.fn();
    render(<SellerCommandReview {...base} onConfirm={send} onCancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy xác nhận' }));
    expect(cancel).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
  });
  it('fresh=false blocks a NEW action even after an attempted checkbox change', () => {
    const send = vi.fn(); render(<SellerCommandReview {...base} fresh={false} onConfirm={send} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xác nhận thao tác' })).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  });
  it('unknown outcome offers only explicit SAME-request replay, never clear/cancel or auto send', () => {
    const send = vi.fn(), cancel = vi.fn();
    render(<SellerCommandReview {...base} phase="outcome-unknown" fresh={false} onConfirm={send} onCancel={cancel} />);
    expect(send).not.toHaveBeenCalled(); expect(screen.getByRole('status')).toHaveTextContent(/mã yêu cầu cũ/);
    expect(screen.queryByRole('button', { name: 'Hủy xác nhận' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Gửi lại cùng yêu cầu' }));
    expect(send).toHaveBeenCalledWith(target, true); expect(cancel).not.toHaveBeenCalled();
  });
  it.each(['sending', 'acknowledged-refreshing', 'blocked'] as SellerReviewPhase[])('%s has no dispatch control', phase => {
    const send = vi.fn(); render(<SellerCommandReview {...base} phase={phase} onConfirm={send} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(send).not.toHaveBeenCalled();
  });
  it('receipt-success/GET-failure exposes only a read retry, not a new command', () => {
    const send = vi.fn(), reload = vi.fn();
    render(<SellerCommandReview {...base} phase="acknowledged-refresh-error" onConfirm={send} onReload={reload} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Đã ghi nhận thao tác/);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại đơn' }));
    expect(reload).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...session, isActive: false },
    { ...session, actor: { id: 99, role: 'SELLER' as const } },
    { ...session, version: 3 },
    { ...session, actor: { id: 8, role: 'USER' as const } },
  ])('hides old order identity for an invalid/changed session %j', current => {
    render(<SellerCommandReview {...base} session={current} onConfirm={vi.fn()} />);
    expect(screen.queryByText(/ORDER-QA-19/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('changing the order resets a previous checkbox confirmation', () => {
    const { rerender } = render(<SellerCommandReview {...base} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox')); expect(screen.getByRole('checkbox')).toBeChecked();
    rerender(<SellerCommandReview {...base} target={{ ...target, orderId: 20, orderNumber: 'ORDER-QA-20' }} onConfirm={vi.fn()} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Xác nhận thao tác' })).toBeDisabled();
  });
  it('changing the command requires a new confirmation', () => {
    const { rerender } = render(<SellerCommandReview {...base} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    rerender(<SellerCommandReview {...base} target={{ ...target, command: 'start-packing' }} onConfirm={vi.fn()} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it('callback rejection remains locked/unknown, never offers a fresh submit', async () => {
    const send = vi.fn().mockRejectedValue(new Error('lost response'));
    render(<SellerCommandReview {...base} onConfirm={send} />);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thao tác' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Giữ nguyên yêu cầu cũ/));
    expect(screen.getByRole('button', { name: 'Xác nhận thao tác' })).toBeDisabled(); expect(send).toHaveBeenCalledTimes(1);
  });
});
