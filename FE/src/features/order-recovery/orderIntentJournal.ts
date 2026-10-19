import {
  assertSellerResolutionProof,
  type SellerResolution,
} from "../../services/orderResolutionApi";
import type { PreparationCommand } from "../../types/order";
/** Tab-scoped recovery foundation only. No HTTP, route or command button. */
export type RecoveryActor = Readonly<{ id: number; role: "USER" | "SELLER" }>;
export type RecoverableCommand =
  "confirm" | "start-packing" | "ready-to-ship" | "complete";
export type PendingOrderIntent = Readonly<{
  schemaVersion: 1;
  actorId: number;
  role: RecoveryActor["role"];
  orderId: number;
  command: RecoverableCommand;
  idempotencyKey: string;
  createdAt: string;
}>;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Extract ONLY from a runtime-validated command receipt, never GET detail. */
export type ValidatedCommandAcknowledgement = Readonly<{
  orderId: number;
  command: RecoverableCommand;
  commandId: number;
}>;

export class OrderRecoveryBlockedError extends Error {
  constructor() {
    super("Không thể xác minh yêu cầu Order đang chờ. Chưa được gửi lệnh mới.");
    this.name = "OrderRecoveryBlockedError";
  }
}
const fields = [
  "schemaVersion",
  "actorId",
  "role",
  "orderId",
  "command",
  "idempotencyKey",
  "createdAt",
];
const positiveId = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
function compatible(role: unknown, command: unknown): boolean {
  return (
    typeof command === "string" &&
    (role === "USER"
      ? command === "complete"
      : role === "SELLER" &&
        ["confirm", "start-packing", "ready-to-ship"].includes(command))
  );
}
function blocked(): never {
  throw new OrderRecoveryBlockedError();
}
function namespace(actor: RecoveryActor): string {
  if (!positiveId(actor.id) || !["USER", "SELLER"].includes(actor.role))
    blocked();
  // Role is intentionally NOT part of the key: changed roles must not bypass
  // a pending command for the same account.
  return `bckl-order-command-journal-v1:${actor.id}`;
}
function parse(raw: string, actor: RecoveryActor): PendingOrderIntent {
  if (raw.length > 2048) blocked();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    blocked();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) blocked();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(v, k)) ||
    v.schemaVersion !== 1 ||
    v.actorId !== actor.id ||
    v.role !== actor.role ||
    !positiveId(v.orderId) ||
    !compatible(v.role, v.command) ||
    typeof v.idempotencyKey !== "string" ||
    v.idempotencyKey.length < 16 || v.idempotencyKey.length > 128 ||
    /[^A-Za-z0-9_-]/.test(v.idempotencyKey) ||
    typeof v.createdAt !== "string" ||
    !Number.isFinite(Date.parse(v.createdAt)) ||
    new Date(v.createdAt).toISOString() !== v.createdAt
  )
    blocked();
  return Object.freeze(v as unknown as PendingOrderIntent);
}
function same(a: PendingOrderIntent, b: PendingOrderIntent): boolean {
  return fields.every(
    (k) =>
      a[k as keyof PendingOrderIntent] === b[k as keyof PendingOrderIntent],
  );
}

/** One unresolved command per account per tab. Not a DB lock/security boundary.
 * Caller must authenticate actor and fence requests with the CURRENT session.
 * Persist before HTTP; never automatically resend, expire, or clear on logout.
 */
export function createOrderIntentJournal(
  storage: StoragePort,
  keyFactory: () => string = () => crypto.randomUUID(),
  now: () => Date = () => new Date(),
) {
  function pending(actor: RecoveryActor): PendingOrderIntent | null {
    const key = namespace(actor);
    try {
      const raw = storage.getItem(key);
      return raw === null ? null : parse(raw, actor);
    } catch {
      blocked();
    }
  }
  function prepare(
    actor: RecoveryActor,
    orderId: number,
    command: RecoverableCommand,
  ): PendingOrderIntent {
    if (!positiveId(orderId) || !compatible(actor.role, command)) blocked();
    const old = pending(actor);
    if (old) {
      if (old.orderId !== orderId || old.command !== command) blocked();
      return old; // Same payload/key after reload. Caller still requires confirmation.
    }
    try {
      const intent = parse(
        JSON.stringify({
          schemaVersion: 1,
          actorId: actor.id,
          role: actor.role,
          orderId,
          command,
          idempotencyKey: keyFactory(),
          createdAt: now().toISOString(),
        }),
        actor,
      );
      storage.setItem(namespace(actor), JSON.stringify(intent));
      // Quota/private-mode/non-writing storage must fail BEFORE dispatch.
      const saved = pending(actor);
      if (!saved || !same(saved, intent)) blocked();
      return saved;
    } catch {
      blocked();
    }
  }
  function acknowledge(
    actor: RecoveryActor,
    intent: PendingOrderIntent,
    receipt: ValidatedCommandAcknowledgement,
  ): void {
    const current = pending(actor);
    if (
      !current ||
      !same(current, intent) ||
      !positiveId(receipt.commandId) ||
      receipt.orderId !== current.orderId ||
      receipt.command !== current.command
    )
      blocked();
    try {
      storage.removeItem(namespace(actor));
      if (storage.getItem(namespace(actor)) !== null) blocked();
    } catch {
      blocked();
    }
  }
  function settleClosedIntent(
    actor: RecoveryActor,
    intent: PendingOrderIntent,
    resolution: SellerResolution,
  ): void {
    const current = pending(actor);
    if (
      !current ||
      !same(current, intent) ||
      actor.role !== "SELLER" ||
      resolution.outcome !== "CLOSED_WITHOUT_EXECUTION"
    )
      blocked();
    assertSellerResolutionProof(resolution, {
      actorId: actor.id,
      orderId: current.orderId,
      command: current.command as PreparationCommand,
      idempotencyKey: current.idempotencyKey,
    });
    if (
      resolution.orderId !== current.orderId ||
      resolution.command !== current.command
    )
      blocked();
    // Separate from success acknowledgement: never fabricate commandId.
    try {
      storage.removeItem(namespace(actor));
      if (storage.getItem(namespace(actor)) !== null) blocked();
    } catch {
      blocked();
    }
  }
  return Object.freeze({ pending, prepare, acknowledge, settleClosedIntent });
}
