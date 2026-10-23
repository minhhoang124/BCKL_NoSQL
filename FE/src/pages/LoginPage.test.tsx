// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), login: vi.fn(), version: 1 }));
vi.mock('../contexts/useAuth', () => ({ useAuth: () => ({ login: mocks.login }) }));
vi.mock('../services/apiClient', async load => ({ ...await load<typeof import('../services/apiClient')>(), fetchApi: mocks.fetch, getAuthSessionVersion: () => mocks.version }));
const tree = () => <StrictMode><MemoryRouter><LoginPage /></MemoryRouter></StrictMode>;
const form = () => screen.getByRole('button', { name: 'Đăng nhập' }).closest('form')!;
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { vi.clearAllMocks(); mocks.version = 1; });
afterEach(cleanup);

it('allows only one HTTP login for same-tick submits', async () => {
  const pending = deferred(); mocks.fetch.mockReturnValue(pending.promise); render(tree());
  const target = form(); act(() => { fireEvent.submit(target); fireEvent.submit(target); });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ accessToken: 'synthetic', user: { id: 1 } }));
  expect(mocks.login).toHaveBeenCalledTimes(1);
});

it('aborts on unmount and ignores a late success even if transport ignores abort', async () => {
  const pending = deferred(); mocks.fetch.mockReturnValue(pending.promise); const view = render(tree());
  fireEvent.submit(form()); const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
  view.unmount();
  await act(async () => pending.resolve({ accessToken: 'synthetic', user: { id: 1 } }));
  expect(mocks.login).not.toHaveBeenCalled(); expect(signal.aborted).toBe(true);
});

it('does not apply a response belonging to an earlier session', async () => {
  const pending = deferred(); mocks.fetch.mockReturnValue(pending.promise); render(tree()); fireEvent.submit(form());
  mocks.version = 2;
  await act(async () => pending.resolve({ accessToken: 'synthetic', user: { id: 1 } }));
  expect(mocks.login).not.toHaveBeenCalled();
});

it('permits a deliberate retry after failure without automatically replaying login', async () => {
  mocks.fetch.mockRejectedValueOnce(new Error('network')); render(tree()); fireEvent.submit(form());
  expect(await screen.findByText('Có lỗi không xác định.')).toBeInTheDocument();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  mocks.fetch.mockResolvedValueOnce({ accessToken: 'synthetic', user: { id: 1 } });
  await act(async () => fireEvent.submit(form())); expect(mocks.login).toHaveBeenCalledTimes(1);
});
