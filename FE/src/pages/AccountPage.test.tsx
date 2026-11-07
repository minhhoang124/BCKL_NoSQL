// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AccountPage } from './AccountPage';

const mocks = vi.hoisted(() => ({
  user: {
    id: 9999,
    email: 'buyer.qa.demo@example.invalid',
    fullName: 'Võ Minh Hoàng',
    role: 'USER',
    isActive: true,
  },
}));

vi.mock('../contexts/useAuth', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../features/account-settings/AccountSettings', () => ({
  AccountSettings: () => <div data-testid="account-settings">AccountSettings</div>,
}));

vi.mock('../features/auth-email/EmailRecoveryPages', () => ({
  EmailVerificationSettings: () => <div data-testid="email-verification">EmailVerification</div>,
}));

vi.mock('../features/auth-google/GoogleAuth', () => ({
  GoogleLink: () => <div data-testid="google-link">GoogleLink</div>,
}));

vi.mock('../features/phone-otp/PhoneOtpSettings', () => ({
  PhoneOtpSettings: () => <div data-testid="phone-otp">PhoneOtpSettings</div>,
}));

afterEach(cleanup);

describe('BUY-01: AccountPage customer profile', () => {
  it('hides role USER and internal ID #9999 from customer view', () => {
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    );

    // Verifies full name and masked email are shown
    expect(screen.getAllByText('Võ Minh Hoàng').length).toBeGreaterThan(0);
    expect(screen.getAllByText('bu******@example.invalid').length).toBeGreaterThan(0);

    // CRITICAL: internal role and internal ID must NOT appear in the customer view
    expect(screen.queryByText(/Vai trò/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/USER/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/#9999/)).not.toBeInTheDocument();

    // Verifies account active status is shown
    expect(screen.getByText(/Tài khoản hoạt động bình thường/i)).toBeInTheDocument();
  });
});
