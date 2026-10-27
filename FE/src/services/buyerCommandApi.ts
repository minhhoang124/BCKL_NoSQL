/** Unmounted Buyer command client. No route/button invokes these writes yet. */
import {
  ApiError,
  AuthSessionChangedError,
  fetchApi,
  getAuthSessionVersion,
} from "./apiClient";
import { validOrderId } from "./orderResponse";
import {
  validateBuyerCancellationReceipt,
  validateBuyerCompletionReceipt,
} from "./buyerOrderReceipt";
import {
  fingerprintBuyerCommand,
  normalizeBuyerCommand,
  type BuyerCommand,
  type BuyerCommandBody,
} from "../features/order-recovery/buyerCommandFingerprint";
import type {
  BuyerCancellationReason,
  BuyerCancellationReceipt,
  BuyerCompletionReceipt,
} from "../types/buyerOrderReceipt";

export type BuyerCommandReceipt =
  BuyerCancellationReceipt | BuyerCompletionReceipt;
export type BuyerExecutionIdentity = Readonly<{
  actorId: number;
  orderId: number;
  command: BuyerCommand;
  idempotencyKey: string;
  hashVersion: 1;
  requestHash: string;
  total: string;
  paymentProvider?: 'COD'|'VNPAY'|'MOMO';
}>;
export type PreparedBuyerCommand = BuyerExecutionIdentity &
  Readonly<{ sessionVersion: number }>;
const bodies = new WeakMap<PreparedBuyerCommand, BuyerCommandBody>();
const proofs = new WeakMap<BuyerCommandReceipt, PreparedBuyerCommand>();
const fields = [
  "actorId",
  "orderId",
  "command",
  "idempotencyKey",
  "hashVersion",
  "requestHash",
  "total",
  "paymentProvider",
] as const;
function invalid(): never {
  throw new ApiError(
    "Không xác minh được yêu cầu Buyer.",
    400,
    "INVALID_BUYER_COMMAND",
  );
}
function current(handle: { sessionVersion: number }) {
  if (handle.sessionVersion !== getAuthSessionVersion())
    throw new AuthSessionChangedError();
}
function snapshot(input: BuyerExecutionIdentity): BuyerExecutionIdentity {
  const i = Object.freeze(
    Object.fromEntries(fields.map((k) => [k, input[k]])),
  ) as BuyerExecutionIdentity;
  if (
    !validOrderId(i.actorId) ||
    !validOrderId(i.orderId) ||
    !["cancel", "complete"].includes(i.command) ||
    i.hashVersion !== 1 ||
    typeof i.idempotencyKey !== "string" ||
    i.idempotencyKey.length < 16 ||
    i.idempotencyKey.length > 128 ||
    /[^A-Za-z0-9_-]/.test(i.idempotencyKey) ||
    typeof i.requestHash !== "string" ||
    i.requestHash.length !== 64 ||
    /[^a-f0-9]/.test(i.requestHash) ||
    typeof i.total !== "string" ||
    (i.paymentProvider!==undefined&&!['COD','VNPAY','MOMO'].includes(i.paymentProvider)) ||
    /^(0|[1-9][0-9]{0,11})\.00$/.exec(i.total)?.[0] !== i.total
  )
    invalid();
  return i;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Original body stays in private RAM only, never journal/storage or public handle.
 * Preparing proves that its normalized body still matches the persisted hash.
 * Does not generate a key, perform HTTP or delete a pending record.
 */
export async function prepareBuyerCommand(
  input: BuyerExecutionIdentity,
  rawBody: unknown,
): Promise<PreparedBuyerCommand> {
  const sessionVersion = getAuthSessionVersion();
  const i = snapshot(input);
  const body = normalizeBuyerCommand(i.command, rawBody);
  const hash = await fingerprintBuyerCommand(
    i.actorId,
    i.orderId,
    i.command,
    body,
  );
  current({ sessionVersion });
  if (hash !== i.requestHash) invalid();
  const handle = Object.freeze({ ...i, sessionVersion });
  bodies.set(handle, body);
  return handle;
}
/** One explicit attempt. Any error retains the caller's original journal; this
 * adapter never refreshes/replays automatically or treats HTTP errors as proof.
 */
export async function sendBuyerCommand(
  handle: PreparedBuyerCommand,
  external?: AbortSignal,
): Promise<BuyerCommandReceipt> {
  const body = bodies.get(handle);
  if (!body) invalid();
  current(handle);
  try {
    const deadline = AbortSignal.timeout(30_000);
    const raw = await fetchApi<unknown>(
      `/orders/${handle.orderId}/${handle.command}`,
      {
        method: "POST",
        cache: "no-store",
        retryOnUnauthorized: false,
        headers: { "Idempotency-Key": handle.idempotencyKey },
        body: JSON.stringify(body),
        signal: external ? AbortSignal.any([external, deadline]) : deadline,
      },
    );
    current(handle);
    // Detach before returning proof-bearing data; no typed object/GET can stand
    // in for a response validated against this invocation's body and identity.
    const detached: unknown = structuredClone(raw);
    const receipt =
      handle.command === "cancel"
        ? validateBuyerCancellationReceipt(
            detached,
            handle,
            body as BuyerCancellationReason,
          )
        : validateBuyerCompletionReceipt(detached, handle);
    current(handle);
    freeze(receipt);
    proofs.set(receipt, handle);
    return receipt;
  } catch (error) {
    current(handle);
    throw error;
  }
}
export function assertBuyerCommandProof(
  receipt: BuyerCommandReceipt,
  expected: BuyerExecutionIdentity,
): void {
  const handle = proofs.get(receipt);
  if (!handle || fields.some((k) => handle[k] !== expected[k])) invalid();
  current(handle);
}
