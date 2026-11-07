import { describe, expect, it } from 'vitest';
import {
  advanceChatReadSequence,
  assertCanOpenChat,
  assertCanReadChat,
  assertCanSendChat,
  ChatPolicyError,
  type ChatActor,
  type ChatStore,
} from './chat-policy.js';

const buyer: ChatActor = { id: 1, role: 'USER', isActive: true };
const seller: ChatActor = { id: 2, role: 'SELLER', isActive: true };
const store: ChatStore = {
  id: 10,
  sellerId: 2,
  status: 'ACTIVE',
  ownerIsActive: true,
};
const conversation = { buyerId: 1, storeId: 10 };
function rejects(fn: () => void, status: number, code: string) {
  try {
    fn();
    throw new Error('Expected policy rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(ChatPolicyError);
    expect(error).toMatchObject({ status, code });
  }
}

describe('Chat policy foundation — no DB/transport wiring', () => {
  it('Buyer opens an active Store', () =>
    expect(() => assertCanOpenChat(buyer, store)).not.toThrow());
  it.each(['PENDING', 'REJECTED', 'SUSPENDED', 'CLOSED'] as const)(
    'cannot open %s',
    (status) =>
      rejects(
        () => assertCanOpenChat(buyer, { ...store, status }),
        409,
        'CHAT_CANNOT_OPEN',
      ),
  );
  it('cannot open against a locked owner', () =>
    rejects(
      () => assertCanOpenChat(buyer, { ...store, ownerIsActive: false }),
      409,
      'CHAT_CANNOT_OPEN',
    ));
  it('cannot self-chat even with Buyer role', () =>
    rejects(
      () => assertCanOpenChat({ ...buyer, id: 2 }, store),
      409,
      'CHAT_CANNOT_OPEN',
    ));
  it('Seller cannot create a conversation for a Buyer', () =>
    rejects(() => assertCanOpenChat(seller, store), 403, 'FORBIDDEN'));
  it.each([buyer, seller])('member $role can read/send active', (actor) => {
    expect(() => assertCanReadChat(actor, store, conversation)).not.toThrow();
    expect(() => assertCanSendChat(actor, store, conversation)).not.toThrow();
  });
  it.each([buyer, seller])('locked $role has no read/send access', (actor) => {
    const inactive = { ...actor, isActive: false };
    rejects(
      () => assertCanReadChat(inactive, store, conversation),
      401,
      'UNAUTHORIZED',
    );
    rejects(
      () => assertCanSendChat(inactive, store, conversation, true),
      401,
      'UNAUTHORIZED',
    );
  });
  it('Admin has no default read rights', () =>
    rejects(
      () =>
        assertCanReadChat(
          { id: 3, role: 'ADMIN', isActive: true },
          store,
          conversation,
        ),
      403,
      'FORBIDDEN',
    ));
  it.each([buyer, seller])('unrelated $role gets generic404', (actor) =>
    rejects(
      () => assertCanReadChat({ ...actor, id: 99 }, store, conversation),
      404,
      'CONVERSATION_NOT_FOUND',
    ),
  );
  it('wrong Store nesting is404', () =>
    rejects(
      () => assertCanReadChat(buyer, store, { ...conversation, storeId: 20 }),
      404,
      'CONVERSATION_NOT_FOUND',
    ));
  it('Buyer reads own history when owner is locked but cannot send', () => {
    const locked = { ...store, ownerIsActive: false };
    expect(() => assertCanReadChat(buyer, locked, conversation)).not.toThrow();
    rejects(
      () => assertCanSendChat(buyer, locked, conversation, true),
      409,
      'CHAT_READ_ONLY',
    );
  });
  it.each(['PENDING', 'REJECTED', 'CLOSED'] as const)(
    '%s keeps history read-only even with old purchase',
    (status) => {
      expect(() =>
        assertCanReadChat(buyer, { ...store, status }, conversation),
      ).not.toThrow();
      rejects(
        () =>
          assertCanSendChat(buyer, { ...store, status }, conversation, true),
        409,
        'CHAT_READ_ONLY',
      );
    },
  );
  it.each([buyer, seller])(
    'SUSPENDED $role send needs verified prior transaction',
    (actor) => {
      const suspended = { ...store, status: 'SUSPENDED' as const };
      rejects(
        () => assertCanSendChat(actor, suspended, conversation),
        409,
        'CHAT_READ_ONLY',
      );
      expect(() =>
        assertCanSendChat(actor, suspended, conversation, true),
      ).not.toThrow();
    },
  );
  it('purchase evidence cannot bypass membership', () =>
    rejects(
      () =>
        assertCanSendChat(
          { ...buyer, id: 99 },
          { ...store, status: 'SUSPENDED' },
          conversation,
          true,
        ),
      404,
      'CONVERSATION_NOT_FOUND',
    ));
  it.each([
    [0, 1, 1],
    [4, 2, 4],
    [4, 4, 4],
    [4, 7, 7],
  ])('cursor %s/%s -> %s', (a, b, result) =>
    expect(advanceChatReadSequence(a, b)).toBe(result),
  );
  it.each([
    [-1, 1],
    [0, 0],
    [0, 1.5],
    [NaN, 1],
    [0, Infinity],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ])('rejects invalid sequence %s/%s', (a, b) =>
    expect(() => advanceChatReadSequence(a, b)).toThrow(RangeError),
  );
});
