/** Pure domain policy, NOT an HTTP guard. All facts must be read by the server
 * from canonical DB state in the operation transaction, never accepted as DTOs.
 * No persistence, room admission or broadcast is wired by this module. */
export type ChatActor = Readonly<{
  id: number;
  role: 'USER' | 'SELLER' | 'ADMIN';
  isActive: boolean;
}>;
export type ChatStore = Readonly<{
  id: number;
  sellerId: number;
  ownerIsActive: boolean;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'CLOSED';
}>;
export type ChatConversation = Readonly<{
  buyerId: number;
  storeId: number;
}>;
export type ChatPolicyCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONVERSATION_NOT_FOUND'
  | 'CHAT_READ_ONLY'
  | 'CHAT_CANNOT_OPEN';
export class ChatPolicyError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404 | 409,
    public readonly code: ChatPolicyCode,
  ) {
    super(code);
  }
}

function activeActor(actor: ChatActor): void {
  if (!actor.isActive) throw new ChatPolicyError(401, 'UNAUTHORIZED');
  if (actor.role === 'ADMIN') throw new ChatPolicyError(403, 'FORBIDDEN');
}

/** Opening never implies sending a Product-context message. Product visibility
 * and self-chat checks remain server responsibilities before persistence. */
export function assertCanOpenChat(actor: ChatActor, store: ChatStore): void {
  activeActor(actor);
  if (actor.role !== 'USER') throw new ChatPolicyError(403, 'FORBIDDEN');
  if (
    actor.id === store.sellerId ||
    !store.ownerIsActive ||
    store.status !== 'ACTIVE'
  )
    throw new ChatPolicyError(409, 'CHAT_CANNOT_OPEN');
}

export function assertCanReadChat(
  actor: ChatActor,
  store: ChatStore,
  conversation: ChatConversation,
): void {
  activeActor(actor);
  const member =
    conversation.storeId === store.id &&
    actor.id !== store.sellerId &&
    actor.role === 'USER' &&
    conversation.buyerId === actor.id;
  const owner =
    conversation.storeId === store.id &&
    actor.role === 'SELLER' &&
    store.sellerId === actor.id &&
    conversation.buyerId !== actor.id;
  if (!member && !owner)
    throw new ChatPolicyError(404, 'CONVERSATION_NOT_FOUND');
  // An active Buyer can read their history even if the owner is locked.
}

/** Positive evidence is an internal DB-derived fact for THIS Buyer/Store pair.
 * Default is false. Conversation age or a client boolean is not evidence. */
export function assertCanSendChat(
  actor: ChatActor,
  store: ChatStore,
  conversation: ChatConversation,
  hasVerifiedPriorTransaction = false,
): void {
  assertCanReadChat(actor, store, conversation);
  if (
    !store.ownerIsActive ||
    !(
      store.status === 'ACTIVE' ||
      (store.status === 'SUSPENDED' && hasVerifiedPriorTransaction)
    )
  )
    throw new ChatPolicyError(409, 'CHAT_READ_ONLY');
}

/** Pure monotonic cursor decision. Call only AFTER membership and resolving a
 * Message ID to its sequence in the SAME conversation inside the transaction. */
export function advanceChatReadSequence(
  current: number,
  observed: number,
): number {
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    !Number.isSafeInteger(observed) ||
    observed < 1
  )
    throw new RangeError('Invalid conversation sequence');
  return Math.max(current, observed);
}
