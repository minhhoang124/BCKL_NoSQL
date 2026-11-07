import { createHash } from 'node:crypto';
import {
  assertOrderCommandActor,
  orderCommandError,
  type OrderCommandActor,
  type PreparedOrderCommandName,
} from './order-command-policy.js';

type CancelReason = 'CHANGED_MIND' | 'OUT_OF_STOCK' | 'CANNOT_FULFIL' | 'OTHER';
type EmptyBody = Readonly<Record<string, never>>;
type CancelBody = Readonly<{ reasonCode: CancelReason; reasonText: string }>;

type PreparedCommand = Readonly<{
  actorId: number;
  actorType: OrderCommandActor;
  actorScope: string;
  orderId: number;
  idempotencyKey: string;
  requestHash: string;
  hashVersion: 1;
}> &
  (
    | Readonly<{ command: 'cancel'; body: CancelBody }>
    | Readonly<{
        command: Exclude<PreparedOrderCommandName, 'cancel'>;
        body: EmptyBody;
      }>
  );

function positiveId(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  ) {
    throw orderCommandError(400, 'VALIDATION_ERROR');
  }
  return value;
}

/** actorType/actorId must come from verified JWT, never request body. */
export function prepareOrderCommand(input: {
  actorId: number;
  actorType: OrderCommandActor;
  orderId: number;
  command: PreparedOrderCommandName;
  idempotencyKey: unknown;
  body: unknown;
}): PreparedCommand {
  assertOrderCommandActor(input.actorType, input.command);
  const actorId = positiveId(input.actorId);
  const orderId = positiveId(input.orderId);
  const key = input.idempotencyKey;
  if (key === undefined || key === null) {
    throw orderCommandError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  if (
    typeof key !== 'string' ||
    key.length < 16 ||
    key.length > 128 ||
    /[^A-Za-z0-9_-]/.test(key)
  ) {
    throw orderCommandError(400, 'VALIDATION_ERROR');
  }
  const raw = input.body;
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    (Object.getPrototypeOf(raw) !== Object.prototype &&
      Object.getPrototypeOf(raw) !== null)
  ) {
    throw orderCommandError(400, 'VALIDATION_ERROR');
  }
  const fields = Reflect.ownKeys(raw);
  const record = raw as Record<string, unknown>;
  let body: EmptyBody | CancelBody;
  if (input.command === 'cancel') {
    if (
      fields.length !== 2 ||
      !fields.includes('reasonCode') ||
      !fields.includes('reasonText')
    ) {
      throw orderCommandError(400, 'VALIDATION_ERROR');
    }
    const allowed =
      input.actorType === 'BUYER'
        ? ['CHANGED_MIND', 'OTHER']
        : ['OUT_OF_STOCK', 'CANNOT_FULFIL', 'OTHER'];
    if (
      typeof record.reasonCode !== 'string' ||
      !allowed.includes(record.reasonCode) ||
      typeof record.reasonText !== 'string'
    ) {
      throw orderCommandError(400, 'VALIDATION_ERROR');
    }
    const reasonText = record.reasonText.trim();
    if (reasonText.length < 1 || reasonText.length > 500) {
      throw orderCommandError(400, 'VALIDATION_ERROR');
    }
    body = Object.freeze({
      reasonCode: record.reasonCode as CancelReason,
      reasonText,
    });
  } else {
    if (fields.length !== 0) {
      throw orderCommandError(400, 'VALIDATION_ERROR');
    }
    body = Object.freeze({});
  }

  const actorScope = `USER:${actorId}`;
  // v1 recursively sorted keys, UTF-8 JSON without whitespace. These DTOs are
  // flat; construct both envelope and body in sorted order explicitly. Never
  // serialize raw input or omit a field with meaningful false/null in future DTOs.
  const canonical = JSON.stringify({
    actorScope,
    body,
    command: input.command,
    orderId,
  });
  const requestHash = createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex');
  const prepared = {
    actorId,
    actorType: input.actorType,
    actorScope,
    orderId,
    idempotencyKey: key,
    requestHash,
    hashVersion: 1 as const,
  };
  if (input.command === 'cancel') {
    return Object.freeze({
      ...prepared,
      command: 'cancel',
      body: body as CancelBody,
    });
  }
  return Object.freeze({
    ...prepared,
    command: input.command,
    body: body as EmptyBody,
  });
}
