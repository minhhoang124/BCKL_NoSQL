/** Recovery composition calls this adapter; no route/button is mounted. */
import { ApiError, AuthSessionChangedError, fetchApi, getAuthSessionVersion } from './apiClient';
import { validOrderId } from './orderResponse';
import { validateBuyerCancellationReceipt, validateBuyerCompletionReceipt } from './buyerOrderReceipt';
import type { BuyerCancellationReceipt, BuyerCompletionReceipt } from '../types/buyerOrderReceipt';

export type BuyerResolutionIdentity = Readonly<{
  actorId: number; orderId: number; command: 'cancel' | 'complete';
  idempotencyKey: string; hashVersion: 1; requestHash: string; total: string;
  paymentProvider?: 'COD'|'VNPAY'|'MOMO';
}>;
export type PreparedBuyerResolution = BuyerResolutionIdentity & Readonly<{ sessionVersion: number }>;
export type BuyerResolution = Readonly<
  | { outcome: 'COMMITTED'; receipt: BuyerCancellationReceipt | BuyerCompletionReceipt }
  | { outcome: 'CLOSED_WITHOUT_EXECUTION'; resolutionId: number; orderId: number; command: 'cancel' | 'complete'; resolvedAt: string }
>;
const handles = new WeakSet<PreparedBuyerResolution>();
const proofs = new WeakMap<BuyerResolution, PreparedBuyerResolution>();
const fields = ['actorId', 'orderId', 'command', 'idempotencyKey', 'hashVersion', 'requestHash', 'total','paymentProvider'] as const;
function invalid(): never {
  throw new ApiError('Không xác minh được kết quả đối chiếu Buyer.', 502, 'INVALID_BUYER_RESOLUTION');
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
  return value as Record<string, unknown>;
}
function identity(value: BuyerResolutionIdentity) {
  if (!value || !validOrderId(value.actorId) || !validOrderId(value.orderId) ||
    !['cancel', 'complete'].includes(value.command) || value.hashVersion !== 1 ||
    typeof value.requestHash !== 'string' || value.requestHash.length !== 64 || /[^a-f0-9]/.test(value.requestHash) ||
    typeof value.idempotencyKey !== 'string' || value.idempotencyKey.length < 16 || value.idempotencyKey.length > 128 || /[^A-Za-z0-9_-]/.test(value.idempotencyKey) ||
    typeof value.total !== 'string' || /^(0|[1-9][0-9]{0,11})\.00$/.exec(value.total)?.[0] !== value.total) invalid();
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function snapshot(value: BuyerResolutionIdentity): BuyerResolutionIdentity {
  const result = Object.fromEntries(fields.map(key => [key, value[key]])) as BuyerResolutionIdentity;
  identity(result);
  return Object.freeze(result);
}
async function hashInvocation(i: BuyerResolutionIdentity, body: unknown) {
  // #69 v1: do not NFC-normalize, reorder keys or reuse Seller hashing.
  const bytes = new TextEncoder().encode(JSON.stringify({ actorScope: `USER:${i.actorId}`, body, command: i.command, orderId: i.orderId }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
/** Shape/hash validation does not create a proof or clear pending storage. */
export async function validateBuyerResolution(raw: unknown, expected: BuyerResolutionIdentity): Promise<BuyerResolution> {
  const i = snapshot(expected);
  // Detach before any async digest; a caller cannot change the receipt mid-hash.
  let value: unknown;
  try { value = structuredClone(raw); } catch { invalid(); }
  const kind = (value as { outcome?: unknown } | null)?.outcome;
  if (kind === 'COMMITTED') {
    const envelope = exact(value, ['outcome', 'receipt']);
    let receipt: BuyerCancellationReceipt | BuyerCompletionReceipt;
    let body: unknown = {};
    if (i.command === 'cancel') {
      const candidate = envelope.receipt as BuyerCancellationReceipt | null;
      const reason = candidate?.result?.cancellation;
      if (!reason) invalid();
      body = { reasonCode: reason.reasonCode, reasonText: reason.reasonText };
      receipt = validateBuyerCancellationReceipt(envelope.receipt, i, body as { reasonCode: 'OTHER' | 'CHANGED_MIND'; reasonText: string });
    } else receipt = validateBuyerCompletionReceipt(envelope.receipt, i);
    if (!receipt.replayed || await hashInvocation(i, body) !== i.requestHash) invalid();
    return freeze({ outcome: 'COMMITTED', receipt });
  }
  const closed = exact(value, ['outcome', 'resolutionId', 'orderId', 'command', 'resolvedAt']);
  if (closed.outcome !== 'CLOSED_WITHOUT_EXECUTION' || !validOrderId(closed.resolutionId) ||
    closed.orderId !== i.orderId || closed.command !== i.command || typeof closed.resolvedAt !== 'string' ||
    !Number.isFinite(Date.parse(closed.resolvedAt)) || new Date(closed.resolvedAt).toISOString() !== closed.resolvedAt) invalid();
  // A complete fingerprint is reproducible even when execution never arrived.
  if (i.command === 'complete' && await hashInvocation(i, {}) !== i.requestHash) invalid();
  return freeze(closed as unknown as BuyerResolution);
}
export function prepareBuyerResolution(input: BuyerResolutionIdentity): PreparedBuyerResolution {
  const handle = Object.freeze({ ...snapshot(input), sessionVersion: getAuthSessionVersion() });
  handles.add(handle);
  return handle;
}
export async function sendBuyerResolution(handle: PreparedBuyerResolution, external?: AbortSignal): Promise<BuyerResolution> {
  if (!handles.has(handle)) invalid();
  const current = () => { if (handle.sessionVersion !== getAuthSessionVersion()) throw new AuthSessionChangedError(); };
  current();
  try {
    const timeout = AbortSignal.timeout(30_000);
    const raw = await fetchApi<unknown>(`/orders/${handle.orderId}/resolve-command`, {
      method: 'POST', cache: 'no-store', retryOnUnauthorized: false,
      headers: { 'Idempotency-Key': handle.idempotencyKey },
      body: JSON.stringify({ command: handle.command, hashVersion: handle.hashVersion, requestHash: handle.requestHash }),
      signal: external ? AbortSignal.any([external, timeout]) : timeout,
    });
    current();
    const result = await validateBuyerResolution(raw, handle);
    current(); // digest is asynchronous too: a response from an old session cannot settle.
    proofs.set(result, handle);
    return result;
  } catch (error) { current(); throw error; }
}
export function assertBuyerResolutionProof(result: BuyerResolution, expected: BuyerResolutionIdentity): void {
  const invocation = proofs.get(result);
  if (!invocation || invocation.sessionVersion !== getAuthSessionVersion() ||
    fields.some(key => invocation[key] !== expected[key])) invalid();
}
