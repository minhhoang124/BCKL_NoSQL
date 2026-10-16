// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import { AuthContext, type AuthContextType } from '../../contexts/useAuth';
import { setAccessToken, ApiError } from '../../services/apiClient';
import { orderApi } from '../../services/orderApi';
import { useOrderDetail, useOrderList } from './useOrderRead';
import {
  buyer,
  seller,
  deferred,
  detailFixture,
  summaryFixture,
} from './testFixtures';
import type { OrderDetail, OrderList } from '../../types/order';

let auth: AuthContextType;
function Wrapper({ children }: PropsWithChildren) {
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}
beforeEach(() => {
  setAccessToken('fixture-buyer', buyer.id);
  auth = {
    user: buyer,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
});
afterEach(() => {
  cleanup();
  setAccessToken(null);
  vi.restoreAllMocks();
});
describe('Read hooks — mocked service, not API/PostgreSQL integration', () => {
  it.each(['response', 'error'] as const)(
    'ignores late old-order %s and aborts the old read',
    async (late) => {
      const old = deferred<OrderDetail>(),
        current = deferred<OrderDetail>();
      const read = vi
        .spyOn(orderApi, 'detail')
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const { result, rerender } = renderHook(
        ({ id }) => useOrderDetail('buyer', id),
        { wrapper: Wrapper, initialProps: { id: 19 } },
      );
      expect(result.current.state.status).toBe('loading');
      rerender({ id: 20 });
      expect(read.mock.calls[0][2]?.aborted).toBe(true);
      await act(async () => current.resolve(detailFixture(20)));
      await waitFor(() =>
        expect(result.current.state).toMatchObject({
          status: 'ready',
          data: { id: 20 },
        }),
      );
      await act(async () =>
        late === 'response'
          ? old.resolve(detailFixture(19))
          : old.reject(new Error('late')),
      );
      expect(result.current.state).toMatchObject({
        status: 'ready',
        data: { id: 20 },
      });
    },
  );
  it('clears already-visible personal data immediately when switching Buyer', async () => {
    const next = deferred<OrderDetail>();
    vi.spyOn(orderApi, 'detail')
      .mockResolvedValueOnce(detailFixture())
      .mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(() => useOrderDetail('buyer', 19), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => {
      setAccessToken('buyer-b', 9);
      auth = { ...auth, user: { ...buyer, id: 9 } };
      rerender();
    });
    expect(result.current.state.status).toBe('loading');
    await act(async () => next.reject(new ApiError('safe', 404)));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'error',
        message: expect.stringContaining('Không tìm thấy'),
      }),
    );
    expect('data' in result.current.state).toBe(false);
  });
  it('ignores an outstanding response after logout and does not load for anonymous/wrong role', async () => {
    const pending = deferred<OrderDetail>();
    const read = vi.spyOn(orderApi, 'detail').mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(() => useOrderDetail('buyer', 19), {
      wrapper: Wrapper,
    });
    act(() => {
      setAccessToken(null);
      auth = { ...auth, user: null };
      rerender();
    });
    await act(async () => pending.resolve(detailFixture()));
    expect(result.current.state.status).toBe('idle');
    act(() => {
      auth = { ...auth, user: seller };
      rerender();
    });
    expect(result.current.state.status).toBe('idle');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('uses the seller scope only for an active Seller', async () => {
    auth = { ...auth, user: seller };
    setAccessToken('seller', seller.id);
    const read = vi
      .spyOn(orderApi, 'detail')
      .mockResolvedValue(detailFixture());
    const { result, rerender } = renderHook(
      () => useOrderDetail('seller', 19),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(read.mock.calls[0].slice(0, 2)).toEqual(['seller', 19]);
    act(() => {
      auth = { ...auth, user: { ...seller, isActive: false } };
      rerender();
    });
    expect(result.current.state.status).toBe('idle');
    act(() => {
      auth = { ...auth, user: seller };
      rerender();
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });
  it('retries only GET, hides old data while reloading and aborts on unmount', async () => {
    const read = vi
      .spyOn(orderApi, 'detail')
      .mockRejectedValueOnce(new ApiError('SQL', 429))
      .mockResolvedValueOnce(detailFixture());
    const { result, unmount } = renderHook(() => useOrderDetail('buyer', 19), {
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'error',
        message: expect.stringContaining('quá nhanh'),
      }),
    );
    const key = result.current.readKey;
    act(() => result.current.reload());
    expect(result.current.state.status).toBe('loading');
    expect(result.current.readKey).not.toBe(key);
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    unmount();
    expect(read.mock.calls[1][2]?.aborted).toBe(true);
  });
  it('drops the prior page when cursor/filter changes and ignores out-of-order pages', async () => {
    const old = deferred<OrderList>(),
      next = deferred<OrderList>();
    const read = vi
      .spyOn(orderApi, 'list')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(
      ({ afterId }) => useOrderList('buyer', { afterId, limit: 20 }),
      {
        wrapper: Wrapper,
        initialProps: { afterId: undefined as number | undefined },
      },
    );
    rerender({ afterId: 19 });
    expect(result.current.state.status).toBe('loading');
    await act(async () =>
      next.resolve({ items: [summaryFixture(18)], nextCursor: null }),
    );
    await act(async () =>
      old.resolve({ items: [summaryFixture(19)], nextCursor: 19 }),
    );
    expect(result.current.state).toMatchObject({
      status: 'ready',
      data: { items: [{ id: 18 }] },
    });
    expect(read.mock.calls[1][1]).toMatchObject({ afterId: 19 });
  });
  it('never starts a read while initial authentication is loading', () => {
    auth = { ...auth, loading: true };
    const read = vi.spyOn(orderApi, 'detail');
    const { result } = renderHook(() => useOrderDetail('buyer', 19), {
      wrapper: Wrapper,
    });
    expect(result.current.state.status).toBe('idle');
    expect(read).not.toHaveBeenCalled();
  });
});
