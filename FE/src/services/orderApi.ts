import {
  fetchApi,
  getAuthSessionVersion,
  AuthSessionChangedError,
  ApiError,
} from './apiClient';
import {
  PREPARATION_COMMANDS,
  ORDER_STATUSES,
  type OrderScope,
  type OrderListQuery,
  type PreparationCommand,
} from '../types/order';
import {
  validateOrderList,
  validateOrderDetail,
  validateSellerReceipt,
  validOrderId,
} from './orderResponse';

function invalid(): never {
  throw new ApiError('Tham số đơn hàng không hợp lệ.', 400, 'VALIDATION_ERROR');
}
function prefix(scope: OrderScope) {
  if (scope !== 'buyer' && scope !== 'seller') invalid();
  return scope === 'buyer' ? '/orders' : '/seller/orders';
}
function signal(external: AbortSignal | undefined, timeoutMs = 15000) {
  return external
    ? AbortSignal.any([external, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}
function queryString(query: OrderListQuery) {
  if (
    Object.keys(query).some(
      (key) => !['limit', 'afterId', 'status'].includes(key),
    )
  )
    invalid();
  if (
    query.limit !== undefined &&
    (!validOrderId(query.limit) || query.limit > 50)
  )
    invalid();
  if (query.afterId !== undefined && !validOrderId(query.afterId)) invalid();
  if (query.status !== undefined && !ORDER_STATUSES.includes(query.status))
    invalid();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  return params.size ? `?${params}` : '';
}
export const orderApi = {
  async list(
    scope: OrderScope,
    query: OrderListQuery = {},
    external?: AbortSignal,
  ) {
    const raw = await fetchApi<unknown>(
      `${prefix(scope)}${queryString(query)}`,
      { cache: 'no-store', signal: signal(external) },
    );
    const result = validateOrderList(raw);
    if (
      result.items.length > (query.limit ?? 20) ||
      result.items.some(
        (item) =>
          (query.afterId !== undefined && item.id >= query.afterId) ||
          (query.status !== undefined && item.status !== query.status),
      )
    )
      throw new ApiError(
        'Trang đơn hàng không đúng bộ lọc.',
        502,
        'INVALID_ORDER_RESPONSE',
      );
    return result;
  },
  async detail(scope: OrderScope, orderId: number, external?: AbortSignal) {
    if (!validOrderId(orderId)) invalid();
    const raw = await fetchApi<unknown>(`${prefix(scope)}/${orderId}`, {
      cache: 'no-store',
      signal: signal(external),
    });
    return validateOrderDetail(raw, orderId);
  },
};
export interface PreparedSellerCommand {
  readonly orderId: number;
  readonly command: PreparationCommand;
  readonly actorId: number;
  readonly idempotencyKey: string;
  readonly sessionVersion: number;
}
const prepared = new WeakSet<PreparedSellerCommand>();
/** Prepare once, retain in memory through unknown outcomes; never create a new key to retry. */
export function prepareSellerCommand(
  orderId: number,
  command: PreparationCommand,
  actorId: number,
  key: string = crypto.randomUUID(),
): PreparedSellerCommand {
  if (
    !validOrderId(orderId) ||
    !validOrderId(actorId) ||
    !PREPARATION_COMMANDS.includes(command) ||
    typeof key !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(key)
  )
    invalid();
  const intent = Object.freeze({
    orderId,
    command,
    actorId,
    idempotencyKey: key,
    sessionVersion: getAuthSessionVersion(),
  });
  prepared.add(intent);
  return intent;
}
/** Not connected to a route/button in this preparation PR. GET detail must follow an acknowledgement. */
export async function sendSellerCommand(
  intent: PreparedSellerCommand,
  external?: AbortSignal,
) {
  if (!prepared.has(intent)) invalid();
  if (intent.sessionVersion !== getAuthSessionVersion())
    throw new AuthSessionChangedError();
  const raw = await fetchApi<unknown>(
    `/seller/orders/${intent.orderId}/${intent.command}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': intent.idempotencyKey },
      body: '{}',
      retryOnUnauthorized: false,
      signal: signal(external, 30000),
    },
  );
  return validateSellerReceipt(
    raw,
    intent.orderId,
    intent.command,
    intent.actorId,
  );
}
