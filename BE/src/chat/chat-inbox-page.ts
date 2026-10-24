import { ChatMessageRequestError } from './chat-message-request.js';

export type ChatInboxCursor = { lastMessageAt: Date | null; id: number };
export type ChatInboxPage = { limit: number; cursor?: ChatInboxCursor };
const invalid = (): never => {
  throw new ChatMessageRequestError(400, 'CHAT_VALIDATION_ERROR');
};
export function inboxCursor(row: ChatInboxCursor): string {
  return Buffer.from(
    JSON.stringify([row.lastMessageAt?.toISOString() ?? null, row.id]),
  ).toString('base64url');
}
export function chatInboxPage(url: string): ChatInboxPage {
  const params = new URL(url, 'http://local.invalid').searchParams;
  for (const key of params.keys())
    if (!['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1)
      invalid();
  const rawLimit = params.get('limit') ?? '30';
  if (!/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) invalid();
  const limit = Number(rawLimit);
  if (!params.has('cursor')) return { limit };
  const raw = params.get('cursor')!;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(raw)) return invalid();
  try {
    const tuple: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (!Array.isArray(tuple) || tuple.length !== 2) return invalid();
    const [time, id] = tuple;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return invalid();
    if (
      time !== null &&
      (typeof time !== 'string' || !Number.isFinite(Date.parse(time)))
    )
      return invalid();
    const cursor = {
      lastMessageAt: time === null ? null : new Date(time),
      id: id as number,
    };
    // Reject alternative JSON/date/base64 spellings, not merely JSON that parses.
    if (inboxCursor(cursor) !== raw) return invalid();
    return { limit, cursor };
  } catch {
    return invalid();
  }
}
