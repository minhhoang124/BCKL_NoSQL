// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/apiClient';
import { Header } from './Header';

const logoutMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('../../contexts/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      email: 'user@example.com',
      fullName: 'Demo User',
      role: 'USER',
    },
    logout: logoutMock,
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Header logout', () => {
  it('keeps the authenticated UI and shows an error when server logout fails', async () => {
    logoutMock.mockRejectedValueOnce(new ApiError('Máy chủ chưa thể đăng xuất', 503));

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Máy chủ chưa thể đăng xuất');
    expect(screen.getByText(/Tài khoản \(Demo User\)/)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates only after server logout succeeds', async () => {
    logoutMock.mockResolvedValueOnce(undefined);

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
