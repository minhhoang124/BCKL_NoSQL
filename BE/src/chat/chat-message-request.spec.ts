import { describe, expect, it } from 'vitest';
import {
  assertChatReplayMatches,
  prepareChatMessage,
} from './chat-message-request.js';
const body = { clientMessageId: 'message-1', type: 'TEXT', content: ' Hello ' };
describe('Chat message request preparation — no persistence or authorization', () => {
  it('trims text, hashes fixed payload and returns immutable data', () => {
    const p = prepareChatMessage(1, 2, body);
    expect(p.payload).toEqual({ type: 'TEXT', content: 'Hello' });
    expect(p.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.payload)).toBe(true);
  });
  it('object field ordering/trim produce same replay identity', () => {
    const a = prepareChatMessage(1, 2, body);
    const b = prepareChatMessage(1, 2, {
      content: 'Hello',
      type: 'TEXT',
      clientMessageId: 'message-1',
    });
    expect(() => assertChatReplayMatches(a, b)).not.toThrow();
  });
  it('same key changed text conflicts', () =>
    expect(() =>
      assertChatReplayMatches(
        prepareChatMessage(1, 2, body),
        prepareChatMessage(1, 2, { ...body, content: 'Other' }),
      ),
    ).toThrow('MESSAGE_IDEMPOTENCY_CONFLICT'));
  it('same key changed type conflicts', () =>
    expect(() =>
      assertChatReplayMatches(
        prepareChatMessage(1, 2, body),
        prepareChatMessage(1, 2, {
          clientMessageId: 'message-1',
          type: 'PRODUCT_CONTEXT',
          contextProductId: 3,
        }),
      ),
    ).toThrow('MESSAGE_IDEMPOTENCY_CONFLICT'));
  it.each([
    'conversationId',
    'senderId',
    'clientMessageId',
    'payloadHash',
    'hashVersion',
  ] as const)('replay validates %s', (field) => {
    const p = prepareChatMessage(1, 2, body);
    expect(() =>
      assertChatReplayMatches(
        {
          ...p,
          [field]:
            field === 'payloadHash'
              ? 'b'.repeat(64)
              : field === 'clientMessageId'
                ? 'other'
                : 99,
        },
        p,
      ),
    ).toThrow('MESSAGE_IDEMPOTENCY_CONFLICT');
  });
  it('prepares Product context but does not pretend to authorize visibility', () =>
    expect(
      prepareChatMessage(1, 2, {
        clientMessageId: 'ctx-1',
        type: 'PRODUCT_CONTEXT',
        contextProductId: 3,
      }).payload,
    ).toEqual({ type: 'PRODUCT_CONTEXT', contextProductId: 3 }));
  it.each([
    null,
    [],
    true,
    'x',
    {},
    { ...body, actorId: 2 },
    { ...body, senderId: 2 },
    { ...body, contextProductId: 3 },
    { ...body, content: null },
    { ...body, content: ' \n\t ' },
    { ...body, content: 'a'.repeat(2001) },
    { ...body, content: 'a\u0000b' },
    { ...body, content: '\ud800' },
    { ...body, clientMessageId: '' },
    { ...body, clientMessageId: 'a b' },
    { ...body, clientMessageId: 'é' },
    { ...body, clientMessageId: 'a'.repeat(129) },
    { ...body, type: 'VIDEO' },
    { clientMessageId: 'c', type: 'PRODUCT_CONTEXT', contextProductId: 0 },
    {
      clientMessageId: 'c',
      type: 'PRODUCT_CONTEXT',
      contextProductId: 3,
      content: 'oops',
    },
  ])('rejects malformed payload %#', (raw) =>
    expect(() => prepareChatMessage(1, 2, raw)).toThrow(
      'CHAT_VALIDATION_ERROR',
    ),
  );
  it.each([0, -1, 1.5, 2147483648, NaN])(
    'rejects invalid internal IDs %s',
    (n) => {
      expect(() => prepareChatMessage(n, 2, body)).toThrow();
      expect(() => prepareChatMessage(1, n, body)).toThrow();
    },
  );
  it('allows 2000 Unicode codepoints and newline/tab', () => {
    expect(() =>
      prepareChatMessage(1, 2, { ...body, content: '😀'.repeat(2000) }),
    ).not.toThrow();
    expect(
      prepareChatMessage(1, 2, { ...body, content: 'a\nb\tc' }).payload,
    ).toEqual({ type: 'TEXT', content: 'a\nb\tc' });
  });
  it.each([
    'message-1\n',
    'message-1\r',
    'message-1\r\n',
    'message-1\u2028',
    'message-1\u2029',
    'a'.repeat(128) + '\n',
  ])(
    'rejects a trailing line terminator in clientMessageId %#',
    (clientMessageId) => {
      expect(() =>
        prepareChatMessage(1, 2, { ...body, clientMessageId }),
      ).toThrow('CHAT_VALIDATION_ERROR');
    },
  );
  it.each(['!', '~', 'a'.repeat(128)])(
    'accepts printable clientMessageId boundary %#',
    (clientMessageId) => {
      expect(
        prepareChatMessage(1, 2, { ...body, clientMessageId }).clientMessageId,
      ).toBe(clientMessageId);
    },
  );
  it('rejects getters without invoking them', () => {
    let called = false;
    const raw = { ...body };
    Object.defineProperty(raw, 'content', {
      enumerable: true,
      get() {
        called = true;
        return 'x';
      },
    });
    expect(() => prepareChatMessage(1, 2, raw)).toThrow();
    expect(called).toBe(false);
  });
});
