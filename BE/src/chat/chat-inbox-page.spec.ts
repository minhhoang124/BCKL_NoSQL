import { chatInboxPage, inboxCursor } from './chat-inbox-page.js';

describe('Chat inbox strict keyset cursor', () => {
  it('defaults to 30 and accepts the maximum', () => {
    expect(chatInboxPage('/chat/conversations')).toEqual({ limit: 30 });
    expect(chatInboxPage('/chat/conversations?limit=100')).toEqual({
      limit: 100,
    });
  });
  it.each([null, new Date('2026-10-23T10:00:00.000Z')])(
    'roundtrips %s',
    (lastMessageAt) => {
      const cursor = { lastMessageAt, id: 2147483647 };
      expect(
        chatInboxPage(`/chat/conversations?cursor=${inboxCursor(cursor)}`),
      ).toEqual({ limit: 30, cursor });
    },
  );
  it.each([
    'limit=0',
    'limit=101',
    'limit=01',
    'limit=-1',
    'limit=1.5',
    'limit=',
    'limit=1e2',
    'limit=10&limit=20',
    'limit[]=1',
    'buyerId=1',
    'storeId=1',
    'cursor=',
    'cursor=abc=',
    'cursor=abc&cursor=def',
    'beforeSequence=1',
  ])('rejects %s', (query) => {
    expect(() => chatInboxPage('/chat/conversations?' + query)).toThrow(
      'CHAT_VALIDATION_ERROR',
    );
  });
  it.each(
    [
      [null, 0],
      [null, -1],
      [null, 1.1],
      [null, 2147483648],
      [null, '1'],
      ['bad', 1],
      ['2026-10-23', 1],
      [null, 1, 'extra'],
      { id: 1 },
    ].map((tuple) => [tuple]),
  )('rejects malformed tuple %j', (tuple) => {
    const raw = Buffer.from(JSON.stringify(tuple)).toString('base64url');
    expect(() => chatInboxPage(`/chat/conversations?cursor=${raw}`)).toThrow(
      'CHAT_VALIDATION_ERROR',
    );
  });
});
