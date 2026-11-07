import { chatPage } from './chat.controller.js';

describe('Chat strict pagination', () => {
  it('accepts zero as catch-up cursor for a previously empty conversation', () =>
    expect(chatPage('/chat/1/messages?afterSequence=0', true)).toEqual({
      limit: 30,
      afterSequence: 0,
    }));
  it('defaults to bounded latest history', () =>
    expect(chatPage('/chat/1/messages', true)).toEqual({ limit: 30 }));
  it('supports one directional cursor', () =>
    expect(
      chatPage('/chat/1/messages?limit=100&afterSequence=12', true),
    ).toEqual({ limit: 100, afterSequence: 12 }));
  it.each([
    'limit=0',
    'limit=101',
    'limit=01',
    'limit=1e2',
    'limit=1.1',
    'limit=-1',
    'limit=10&limit=20',
    'limit[]=1',
    'senderId=1',
    'beforeSequence=1&afterSequence=1',
    'beforeSequence=0',
    'afterSequence=2147483648',
    'limit=',
    'limit=NaN',
  ])('rejects %s', (query) => {
    expect(() => chatPage('/chat/1/messages?' + query, true)).toThrow(
      'CHAT_VALIDATION_ERROR',
    );
  });
  it('rejects a query on mutation/detail routes', () =>
    expect(() => chatPage('/chat/1?limit=1', false)).toThrow());
});
