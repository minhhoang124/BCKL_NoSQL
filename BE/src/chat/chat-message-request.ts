import { createHash } from 'node:crypto';

export class ChatMessageRequestError extends Error {
  constructor(
    public readonly status: 400 | 409,
    public readonly code:
      'CHAT_VALIDATION_ERROR' | 'MESSAGE_IDEMPOTENCY_CONFLICT',
  ) {
    super(code);
  }
}
type Payload =
  | Readonly<{ type: 'TEXT'; content: string }>
  | Readonly<{ type: 'PRODUCT_CONTEXT'; contextProductId: number }>;
export type PreparedChatMessage = Readonly<{
  conversationId: number;
  senderId: number;
  clientMessageId: string;
  payload: Payload;
  payloadHash: string;
  hashVersion: 1;
}>;
function invalid(): never {
  throw new ChatMessageRequestError(400, 'CHAT_VALIDATION_ERROR');
}
function id(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    invalid();
  return value;
}
function textObject(raw: unknown): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  )
    invalid();
  for (const key of Reflect.ownKeys(raw)) {
    if (
      typeof key !== 'string' ||
      !Object.getOwnPropertyDescriptor(raw, key)?.enumerable ||
      !('value' in Object.getOwnPropertyDescriptor(raw, key)!)
    )
      invalid();
  }
  return raw as Record<string, unknown>;
}

/** Input IDs come from verified actor/path, not body. Validation does NOT grant
 * membership or authorize Product context. One service must serve REST/socket. */
export function prepareChatMessage(
  conversationId: number,
  senderId: number,
  raw: unknown,
): PreparedChatMessage {
  id(conversationId);
  id(senderId);
  const body = textObject(raw);
  if (
    typeof body.clientMessageId !== 'string' ||
    !/^[\x21-\x7e]{1,128}$/.test(body.clientMessageId)
  )
    invalid();
  let payload: Payload;
  const keys = Object.keys(body).sort().join(',');
  if (body.type === 'TEXT') {
    if (
      keys !== 'clientMessageId,content,type' ||
      typeof body.content !== 'string'
    )
      invalid();
    const content = body.content.trim();
    if (
      !content ||
      Array.from(content).length > 2000 ||
      Array.from(content).some((character) => {
        const code = character.codePointAt(0)!;
        return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
      }) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        content,
      )
    )
      invalid();
    payload = Object.freeze({ type: 'TEXT', content });
  } else if (body.type === 'PRODUCT_CONTEXT') {
    if (keys !== 'clientMessageId,contextProductId,type') invalid();
    payload = Object.freeze({
      type: 'PRODUCT_CONTEXT',
      contextProductId: id(body.contextProductId),
    });
  } else invalid();
  const canonical = JSON.stringify({ conversationId, payload, senderId });
  return Object.freeze({
    conversationId,
    senderId,
    clientMessageId: body.clientMessageId,
    payload,
    payloadHash: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    hashVersion: 1,
  });
}

/** Call only AFTER canonical membership checks and DB lookup by the scoped key.
 * Comparison alone neither saves nor emits a Message. */
export function assertChatReplayMatches(
  stored: Pick<
    PreparedChatMessage,
    | 'conversationId'
    | 'senderId'
    | 'clientMessageId'
    | 'payloadHash'
    | 'hashVersion'
  >,
  input: PreparedChatMessage,
): void {
  if (
    stored.conversationId !== input.conversationId ||
    stored.senderId !== input.senderId ||
    stored.clientMessageId !== input.clientMessageId ||
    stored.hashVersion !== input.hashVersion ||
    stored.payloadHash !== input.payloadHash
  )
    throw new ChatMessageRequestError(409, 'MESSAGE_IDEMPOTENCY_CONFLICT');
}
