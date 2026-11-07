import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { hasBuyerAccess } from '../../utils/buyerAccess';
import { getAuthSessionVersion } from '../../services/apiClient';
import { orderApi } from '../../services/orderApi';
import type {
  OrderScope,
  OrderListQuery,
  OrderReadState,
} from '../../types/order';
import { orderReadError } from './orderPolicy';

function useRead<T>(
  scope: OrderScope,
  descriptor: string,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const { user, loading } = useAuth();
  const version = getAuthSessionVersion();
  const enabled =
    !loading &&
    Boolean(
      scope === 'buyer' ? hasBuyerAccess(user) : user?.isActive && user.role === 'SELLER',
    );
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify([
    version,
    user?.id,
    enabled,
    scope,
    descriptor,
    nonce,
  ]);
  const [stored, setStored] = useState<{
    key: string;
    state: OrderReadState<T>;
  } | null>(null);
  // Conditional render-time reset prevents old personal data reappearing if access
  // is disabled then restored without a login boundary. No effect-time reset.
  if (stored !== null && stored.key !== key) setStored(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    const current = () =>
      active &&
      !controller.signal.aborted &&
      version === getAuthSessionVersion();
    void load(controller.signal).then(
      (data) => {
        if (current()) setStored({ key, state: { status: 'ready', data } });
      },
      (error: unknown) => {
        if (current())
          setStored({
            key,
            state: { status: 'error', message: orderReadError(error) },
          });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, key, load, version]);
  const state: OrderReadState<T> = !enabled
    ? { status: 'idle' }
    : stored?.key === key
      ? stored.state
      : { status: 'loading' };
  return {
    state,
    readKey: key,
    reload: useCallback(() => setNonce((value) => value + 1), [setNonce]),
  };
}
/** Read-only helpers: route/actor/filter changes clear visible old data immediately. */
export function useOrderList(scope: OrderScope, query: OrderListQuery = {}) {
  const { limit, afterId, status } = query;
  const load = useCallback(
    (signal: AbortSignal) =>
      orderApi.list(scope, { limit, afterId, status }, signal),
    [scope, limit, afterId, status],
  );
  return useRead(scope, JSON.stringify([limit, afterId, status]), load);
}
export function useOrderDetail(scope: OrderScope, orderId: number) {
  const load = useCallback(
    (signal: AbortSignal) => orderApi.detail(scope, orderId, signal),
    [scope, orderId],
  );
  return useRead(scope, String(orderId), load);
}
