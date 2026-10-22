import { getAuthSessionVersion } from "../../services/apiClient";
import { validOrderId } from "../../services/orderResponse";
import { OrderRecoveryBlockedError } from "./orderIntentJournal";
import {
  OrderRecoverySessionChangedError,
  type VerifiedOrderSession,
} from "./orderCommandCoordinator";
import {
  fingerprintBuyerCommand,
  normalizeBuyerCommand,
  type BuyerCommand,
} from "./buyerCommandFingerprint";

export type LegacyBuyerIntent = Readonly<{
  schemaVersion: 1;
  actorId: number;
  role: "USER";
  orderId: number;
  command: "complete";
  idempotencyKey: string;
  createdAt: string;
}>;
export type BuyerIntentV2 = Readonly<{
  schemaVersion: 2;
  actorId: number;
  role: "USER";
  orderId: number;
  command: BuyerCommand;
  idempotencyKey: string;
  createdAt: string;
  hashVersion: 1;
  requestHash: string;
}>;
export type BuyerPendingIntent = LegacyBuyerIntent | BuyerIntentV2;
type StoragePort = Pick<Storage, "getItem" | "setItem">;
const baseFields = [
  "schemaVersion",
  "actorId",
  "role",
  "orderId",
  "command",
  "idempotencyKey",
  "createdAt",
];
const keyFor = (actorId: number) => `bckl-order-command-journal-v1:${actorId}`;
function blocked(): never {
  throw new OrderRecoveryBlockedError();
}
function parse(raw: string, actorId: number): BuyerPendingIntent {
  if (raw.length > 2048) blocked();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    blocked();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) blocked();
  const v = value as Record<string, unknown>,
    v2 = v.schemaVersion === 2;
  const fields = v2
    ? [...baseFields, "hashVersion", "requestHash"]
    : baseFields;
  if (
    Reflect.ownKeys(v).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(v, k)) ||
    (!v2 && v.schemaVersion !== 1) ||
    v.actorId !== actorId ||
    v.role !== "USER" ||
    !validOrderId(v.orderId) ||
    (v2
      ? v.command !== "cancel" && v.command !== "complete"
      : v.command !== "complete") ||
    typeof v.idempotencyKey !== "string" ||
    v.idempotencyKey.length < 16 ||
    v.idempotencyKey.length > 128 ||
    /[^A-Za-z0-9_-]/.test(v.idempotencyKey) ||
    typeof v.createdAt !== "string" ||
    !Number.isFinite(Date.parse(v.createdAt)) ||
    new Date(v.createdAt).toISOString() !== v.createdAt ||
    (v2 &&
      (v.hashVersion !== 1 ||
        typeof v.requestHash !== "string" ||
        v.requestHash.length !== 64 ||
        /[^0-9a-f]/.test(v.requestHash)))
  )
    blocked();
  return Object.freeze(v as unknown as BuyerPendingIntent);
}

/** Preparation only: same physical slot as Seller/v1; NO HTTP, remove, settle,
 * ACK, auto replay or mount. Unresolved v1/v2 always blocks a new execution.
 * Verified Auth/session checks are mandatory before and after async hashing.
 */
export function createBuyerIntentJournal(options: {
  getStorage: () => StoragePort;
  getSession: () => VerifiedOrderSession | null;
  keyFactory?: () => string;
  now?: () => Date;
}) {
  let busy = false;
  function capture(): VerifiedOrderSession {
    const s = options.getSession();
    if (
      !s?.isActive ||
      s.actor.role !== "USER" ||
      !validOrderId(s.actor.id) ||
      !Number.isSafeInteger(s.version) ||
      s.version < 0 ||
      s.version !== getAuthSessionVersion()
    )
      throw new OrderRecoverySessionChangedError();
    return Object.freeze({
      actor: Object.freeze({ ...s.actor }),
      isActive: true,
      version: s.version,
    });
  }
  function current(s: VerifiedOrderSession) {
    const c = capture();
    if (c.actor.id !== s.actor.id || c.version !== s.version)
      throw new OrderRecoverySessionChangedError();
  }
  function read(actorId: number): string | null {
    try {
      const raw = options.getStorage().getItem(keyFor(actorId));
      if (raw !== null && typeof raw !== "string") blocked();
      return raw;
    } catch {
      blocked();
    }
  }
  function pending(): BuyerPendingIntent | null {
    const s = capture(),
      raw = read(s.actor.id);
    current(s);
    return raw === null ? null : parse(raw, s.actor.id);
  }
  function save(
    s: VerifiedOrderSession,
    before: string | null,
    intent: BuyerIntentV2,
  ) {
    current(s);
    // Compare exact raw record before overwrite; never delete a legacy record.
    if (read(s.actor.id) !== before) blocked();
    const raw = JSON.stringify(intent);
    try {
      options.getStorage().setItem(keyFor(s.actor.id), raw);
    } catch {
      blocked();
    }
    current(s);
    if (read(s.actor.id) !== raw) blocked();
    return parse(raw, s.actor.id) as BuyerIntentV2;
  }
  async function prepareNew(input: {
    orderId: number;
    command: BuyerCommand;
    body: unknown;
    confirmed: boolean;
  }): Promise<BuyerIntentV2> {
    // Capture caller-owned values once; never re-read mutable input after await.
    const { orderId, command, body, confirmed } = input;
    if (busy || confirmed !== true) blocked();
    const s = capture();
    busy = true;
    try {
      // Even same Order/body cannot re-enter execute after a reload/pending.
      if (read(s.actor.id) !== null) blocked();
      if (
        !validOrderId(orderId) ||
        (command !== "cancel" && command !== "complete")
      )
        blocked();
      const snapshot = Object.freeze({
        orderId,
        command,
        body: normalizeBuyerCommand(command, body),
      });
      const requestHash = await fingerprintBuyerCommand(
        s.actor.id,
        snapshot.orderId,
        snapshot.command,
        snapshot.body,
      );
      current(s);
      if (read(s.actor.id) !== null) blocked();
      const candidate = parse(
        JSON.stringify({
          schemaVersion: 2,
          actorId: s.actor.id,
          role: "USER",
          orderId: snapshot.orderId,
          command: snapshot.command,
          idempotencyKey: (options.keyFactory ?? (() => crypto.randomUUID()))(),
          createdAt: (options.now ?? (() => new Date()))().toISOString(),
          hashVersion: 1,
          requestHash,
        }),
        s.actor.id,
      ) as BuyerIntentV2;
      return save(s, null, candidate);
    } catch (error) {
      current(s);
      if (error instanceof OrderRecoveryBlockedError) throw error;
      blocked();
    } finally {
      busy = false;
    }
  }
  async function upgradeLegacyComplete(): Promise<BuyerIntentV2> {
    if (busy) blocked();
    const s = capture();
    busy = true;
    try {
      const raw = read(s.actor.id);
      current(s);
      if (raw === null) blocked();
      const old = parse(raw, s.actor.id);
      if (old.schemaVersion === 2) return old; // Does not send/settle anything.
      const requestHash = await fingerprintBuyerCommand(
        old.actorId,
        old.orderId,
        "complete",
        {},
      );
      current(s);
      return save(
        s,
        raw,
        Object.freeze({
          ...old,
          schemaVersion: 2,
          hashVersion: 1,
          requestHash,
        }),
      );
    } catch (error) {
      current(s);
      if (error instanceof OrderRecoveryBlockedError) throw error;
      blocked();
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    pending,
    prepareNew,
    upgradeLegacyComplete,
    isBusy: () => busy,
  });
}
