import {
  ApiError,
  AuthSessionChangedError,
  fetchApi,
  getAuthSessionVersion,
} from "./apiClient";
import { validOrderId, validateSellerReceipt } from "./orderResponse";
import {
  PREPARATION_COMMANDS,
  type PreparationCommand,
  type SellerCommandReceipt,
} from "../types/order";

export type SellerResolution = Readonly<
  | { outcome: "COMMITTED"; receipt: SellerCommandReceipt }
  | {
      outcome: "CLOSED_WITHOUT_EXECUTION";
      resolutionId: number;
      orderId: number;
      command: PreparationCommand;
      resolvedAt: string;
    }
>;
export type ResolutionIdentity = Readonly<{
  actorId: number;
  orderId: number;
  command: PreparationCommand;
  idempotencyKey: string;
}>;
export type PreparedSellerResolution = ResolutionIdentity &
  Readonly<{ sessionVersion: number }>;
const handles = new WeakSet<PreparedSellerResolution>();
const proofs = new WeakMap<SellerResolution, PreparedSellerResolution>();
function invalid(): never {
  throw new ApiError(
    "Không xác minh được kết quả đối chiếu đơn hàng.",
    502,
    "INVALID_ORDER_RESOLUTION",
  );
}
function exact(raw: unknown, fields: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
  const r = raw as Record<string, unknown>;
  if (
    Reflect.ownKeys(r).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(r, k))
  )
    invalid();
  return r;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Shape validation alone does NOT mint a settlement proof. */
export function validateSellerResolution(
  raw: unknown,
  identity: ResolutionIdentity,
): SellerResolution {
  if (!raw || typeof raw !== "object") invalid();
  if ((raw as { outcome?: unknown }).outcome === "COMMITTED") {
    const r = exact(raw, ["outcome", "receipt"]);
    const receipt = validateSellerReceipt(
      r.receipt,
      identity.orderId,
      identity.command,
      identity.actorId,
    );
    if (receipt.replayed !== true) invalid();
    return freeze({ outcome: "COMMITTED", receipt });
  }
  const r = exact(raw, [
    "outcome",
    "resolutionId",
    "orderId",
    "command",
    "resolvedAt",
  ]);
  if (
    r.outcome !== "CLOSED_WITHOUT_EXECUTION" ||
    !validOrderId(r.resolutionId) ||
    r.orderId !== identity.orderId ||
    r.command !== identity.command ||
    typeof r.resolvedAt !== "string" ||
    !Number.isFinite(Date.parse(r.resolvedAt)) ||
    new Date(r.resolvedAt).toISOString() !== r.resolvedAt
  )
    invalid();
  return freeze(r as unknown as SellerResolution);
}
/** Requires the ORIGINAL key; deliberately no UUID default. Not mounted by routes. */
export function prepareSellerResolution(
  identity: ResolutionIdentity,
): PreparedSellerResolution {
  if (
    !validOrderId(identity.actorId) ||
    !validOrderId(identity.orderId) ||
    !PREPARATION_COMMANDS.includes(identity.command) ||
    typeof identity.idempotencyKey !== "string" ||
    identity.idempotencyKey.length < 16 ||
    identity.idempotencyKey.length > 128 ||
    /[^A-Za-z0-9_-]/.test(identity.idempotencyKey)
  )
    throw new ApiError(
      "Yêu cầu đối chiếu không hợp lệ.",
      400,
      "VALIDATION_ERROR",
    );
  const handle = Object.freeze({
    actorId: identity.actorId,
    orderId: identity.orderId,
    command: identity.command,
    idempotencyKey: identity.idempotencyKey,
    sessionVersion: getAuthSessionVersion(),
  });
  handles.add(handle);
  return handle;
}
export async function sendSellerResolution(
  handle: PreparedSellerResolution,
  external?: AbortSignal,
): Promise<SellerResolution> {
  if (!handles.has(handle)) invalid();
  const current = () => {
    if (handle.sessionVersion !== getAuthSessionVersion())
      throw new AuthSessionChangedError();
  };
  current();
  try {
    const timeout = AbortSignal.timeout(30000);
    const raw = await fetchApi<unknown>(
      `/seller/orders/${handle.orderId}/resolve-command`,
      {
        method: "POST",
        cache: "no-store",
        retryOnUnauthorized: false,
        headers: { "Idempotency-Key": handle.idempotencyKey },
        body: JSON.stringify({ command: handle.command }),
        signal: external ? AbortSignal.any([external, timeout]) : timeout,
      },
    );
    current();
    const result = validateSellerResolution(raw, handle);
    proofs.set(result, handle);
    return result;
  } catch (error) {
    current();
    throw error;
  }
}
/** Cannot accept a JSON clone, GET result, or a proof from an old login/key. */
export function assertSellerResolutionProof(
  result: SellerResolution,
  identity: ResolutionIdentity,
): void {
  const invocation = proofs.get(result);
  if (
    !invocation ||
    invocation.sessionVersion !== getAuthSessionVersion() ||
    invocation.actorId !== identity.actorId ||
    invocation.orderId !== identity.orderId ||
    invocation.command !== identity.command ||
    invocation.idempotencyKey !== identity.idempotencyKey
  )
    invalid();
}
