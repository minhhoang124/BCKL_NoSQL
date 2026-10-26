import {
  notificationId,
  notificationPage,
  readConsent,
  notificationAudiences,
} from './notification-input.js';
describe('Notification ownership scope, BigInt and strict HTTP parser', () => {
  it.each([
    '0',
    '-1',
    '01',
    '1.5',
    '1e2',
    '+1',
    ' 1',
    '9223372036854775808',
    1,
    null,
    [],
  ])('rejects id %j', (v) => expect(() => notificationId(v)).toThrow());
  it('preserves full positive bigint range without Number coercion', () => {
    expect(notificationId('9223372036854775807')).toBe(9223372036854775807n);
  });
  it.each([
    '?limit=0',
    '?limit=01',
    '?limit=51',
    '?limit=2&limit=3',
    '?unread=1',
    '?unread=True',
    '?recipientId=2',
    '?beforeId[]=1',
    '?beforeId=9223372036854775808',
  ])('rejects query %s', (q) =>
    expect(() => notificationPage('/account/notifications' + q)).toThrow(),
  );
  it('parses canonical cursor/filter and bounded limit', () => {
    expect(
      notificationPage(
        '/account/notifications?limit=50&beforeId=9007199254740993&unread=true',
      ),
    ).toEqual({ limit: 50, beforeId: 9007199254740993n, unread: true });
  });
  it.each([
    null,
    [],
    {},
    true,
    { confirmed: 'true' },
    { confirmed: false },
    { confirmed: true, recipientId: 2 },
  ])('rejects bad consent %j', (x) => expect(() => readConsent(x)).toThrow());
  it('accepts explicit read-state confirmation only', () =>
    expect(() => readConsent({ confirmed: true })).not.toThrow());
  it('role demotion cannot expose old Seller/Admin audience', () => {
    expect(notificationAudiences('USER')).toEqual(['ACCOUNT', 'BUYER']);
    expect(notificationAudiences('SELLER')).toEqual([
      'ACCOUNT',
      'BUYER',
      'SELLER',
    ]);
    expect(notificationAudiences('ADMIN')).toEqual(['ACCOUNT', 'ADMIN']);
    expect(notificationAudiences('bad')).toEqual([]);
  });
});
