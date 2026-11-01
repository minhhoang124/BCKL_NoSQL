// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSettings } from './AccountSettings';
import { ApiError } from '../../services/apiClient';
import { loadBinding } from './passwordChangeBinding';

const BINDING = 'C'.repeat(43);
const mocks = vi.hoisted(() => ({ request: vi.fn(), changePassword: vi.fn() }));
vi.mock('../../contexts/useAuth', () => ({
  useAuth: () => ({
    user: { id: 3, email: 'qa@example.invalid', fullName: 'QA', role: 'USER', isActive: true },
    applyProfile: vi.fn(),
    endSession: vi.fn(),
  }),
}));
vi.mock('../../services/accountSettingsApi', () => ({ updateProfile: vi.fn(), changePassword: mocks.changePassword }));
vi.mock('../../services/passwordChangeEmailApi', async load => ({
  ...(await load<typeof import('../../services/passwordChangeEmailApi')>()),
  passwordChangeMode: () => 'EMAIL',
  requestPasswordChangeEmail: mocks.request,
}));
const future = () => new Date(Date.now() + 15 * 60000).toISOString();
const view = () => render(<MemoryRouter><AccountSettings /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(cleanup);

describe('BUY-02 AccountSettings in EMAIL mode', () => {
  it('replaces the direct form: no new-password fields, consent required', () => {
    view();
    expect(screen.queryByLabelText('Mật khẩu mới')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi email xác nhận' })).toBeDisabled();
  });
  it('stores the binding before announcing the email and never calls the direct endpoint', async () => {
    mocks.request.mockResolvedValue({ email: 'qa***@example.invalid', expiresAt: future(), bindingSecret: BINDING });
    view();
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), { target: { value: 'CurrentPass123!' } });
    fireEvent.click(screen.getByLabelText(/Gửi thư xác nhận/));
    const form = screen.getByRole('button', { name: 'Gửi email xác nhận' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await screen.findByText(/Đã tiếp nhận yêu cầu/)).toBeInTheDocument();
    expect(screen.getByText('qa***@example.invalid')).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(loadBinding(3)).toBe(BINDING);
  });
  it('maps wrong current password and unverified email to clear messages', async () => {
    mocks.request.mockRejectedValueOnce(new ApiError('x', 400, 'CURRENT_PASSWORD_INVALID'));
    view();
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByLabelText(/Gửi thư xác nhận/));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi email xác nhận' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu hiện tại không đúng');
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveValue('');
    mocks.request.mockRejectedValueOnce(new ApiError('x', 409, 'EMAIL_NOT_VERIFIED'));
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), { target: { value: 'CurrentPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi email xác nhận' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('chưa được xác minh');
    expect(loadBinding(3)).toBeNull();
  });
});
