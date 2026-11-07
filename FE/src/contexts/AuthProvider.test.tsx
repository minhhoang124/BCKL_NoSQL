// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '../types/auth';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';

const serviceMocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  refreshSession: vi.fn(),
  setAccessToken: vi.fn(),
  setOnAuthFailure: vi.fn(),
  getAuthSessionVersion: vi.fn(),
}));

vi.mock('../services/apiClient', async importOriginal => ({
  ...await importOriginal<typeof import('../services/apiClient')>(),
  ...serviceMocks,
}));

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
  const { user, logout, login, refresh } = useAuth();

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
      <button type="button" onClick={() => login({ ...session, accessToken: 'b-token', user: { ...session.user, id: 2, email: 'b@example.test' } })}>login B</button>
      <button type="button" onClick={() => { void refresh(); }}>refresh</button>
    </div>
  );
}

beforeEach(() => {
  let version = 0;
  serviceMocks.getAuthSessionVersion.mockImplementation(() => version);
  serviceMocks.setAccessToken.mockImplementation(() => { ++version; });
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

  it.each(['success', 'failure'])('does not let stale startup refresh %s replace or clear an explicit login', async outcome => {
    let finish!: (value: SessionResponse) => void;
    let fail!: (error: Error) => void;
    serviceMocks.refreshSession.mockReturnValueOnce(new Promise<SessionResponse>((resolve, reject) => { finish = resolve; fail = reject; }));
    render(<AuthProvider><AuthConsumer /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'login B' }));
    expect(screen.getByText('b@example.test')).toBeInTheDocument();
    await act(async () => { if (outcome === 'success') finish(session); else fail(new Error('old failure')); });
    expect(screen.getByText('b@example.test')).toBeInTheDocument();
    expect(serviceMocks.setAccessToken).toHaveBeenCalledWith('b-token', 2);
    expect(serviceMocks.setAccessToken).not.toHaveBeenCalledWith(null);
  });

  it('does not let manual refresh overwrite B after an account change', async () => {
    render(<AuthProvider><AuthConsumer /></AuthProvider>);
    await screen.findByText('user@example.com');
    let finish!: (value: SessionResponse) => void;
    serviceMocks.refreshSession.mockReturnValueOnce(new Promise<SessionResponse>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'login B' }));
    await act(async () => { finish(session); });
    expect(screen.getByText('b@example.test')).toBeInTheDocument();
    expect(serviceMocks.setAccessToken).not.toHaveBeenCalledWith(null);
  });

  it('does not clear B when a previous logout completes late', async () => {
    render(<AuthProvider><AuthConsumer /></AuthProvider>);
    await screen.findByText('user@example.com');
    let finish!: (value: undefined) => void;
    serviceMocks.fetchApi.mockReturnValueOnce(new Promise<undefined>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));
    fireEvent.click(screen.getByRole('button', { name: 'login B' }));
    await act(async () => { finish(undefined); });
    expect(screen.getByText('b@example.test')).toBeInTheDocument();
    expect(serviceMocks.setAccessToken).not.toHaveBeenCalledWith(null);
  });
});
