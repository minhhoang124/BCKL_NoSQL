// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '../types/auth';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';

const serviceMocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  refreshSession: vi.fn(),
  setAccessToken: vi.fn(),
  setOnAuthFailure: vi.fn(),
}));

vi.mock('../services/apiClient', () => serviceMocks);

const session: SessionResponse = {
  accessToken: 'access-token',
  user: {
    id: 1,
    email: 'user@example.com',
    fullName: 'Demo User',
    role: 'USER',
    isActive: true,
  },
};

function AuthConsumer() {
  const { user, logout } = useAuth();

  return (
    <div>
      <span>{user?.email ?? 'guest'}</span>
      <button
        type="button"
        onClick={() => {
          void logout().catch(() => undefined);
        }}
      >
        logout
      </button>
    </div>
  );
}

beforeEach(() => {
  serviceMocks.refreshSession.mockResolvedValue(session);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthProvider logout', () => {
  it('preserves the session when the server cannot revoke it', async () => {
    serviceMocks.fetchApi.mockRejectedValueOnce(new Error('network failure'));

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    expect(await screen.findByText('user@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    expect(await screen.findByText('user@example.com')).toBeInTheDocument();
    expect(serviceMocks.setAccessToken).not.toHaveBeenCalledWith(null);
  });

  it('clears the session after the server confirms logout', async () => {
    serviceMocks.fetchApi.mockResolvedValueOnce(undefined);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    expect(await screen.findByText('user@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    expect(await screen.findByText('guest')).toBeInTheDocument();
    expect(serviceMocks.setAccessToken).toHaveBeenCalledWith(null);
  });
});
