import { describe, it, expect } from 'vitest';
import {
  vnpayAmount,
  vnpayConsent,
  vnpayDate,
  vnpayOrderId,
  vnpayPaidAt,
  vnpayQuery,
  notificationDigest,
} from './vnpay-input.js';
const q = {
  vnp_Amount: '1000000',
  vnp_TxnRef: 'a'.repeat(32),
  vnp_TmnCode: 'TEST0001',
  vnp_TransactionNo: '12345',
  vnp_ResponseCode: '00',
  vnp_TransactionStatus: '00',
  vnp_PayDate: '20261027130000',
  vnp_SecureHash: 'a'.repeat(128),
};
const url = (o: Record<string, string>) =>
  '/payments/vnpay/ipn?' + new URLSearchParams(o);
describe('VNPay boundaries — exact money, duplicate-safe query and GMT+7', () => {
  it('converts whole VND into exact provider minor units without double multiplying', () => {
    expect(vnpayAmount('10000.00')).toEqual({ vnd: 10000, minor: '1000000' });
    expect(vnpayAmount('9999999999.00').minor).toBe('999999999900');
  });
  it.each([
    '0.00',
    '-1.00',
    '1.01',
    '1e4',
    '10000000000.00',
    '010000.00',
    '10000',
    'NaN',
  ])('refuses unsafe amount %s', (s) => expect(() => vnpayAmount(s)).toThrow());
  it('uses canonical GMT+7 and rejects normalized nonexistent dates', () => {
    expect(vnpayDate(new Date('2026-10-27T06:00:00Z'))).toBe('20261027130000');
    expect(vnpayPaidAt(q.vnp_PayDate)?.toISOString()).toBe(
      '2026-10-27T06:00:00.000Z',
    );
    expect(vnpayPaidAt('20260230090000')).toBeNull();
  });
  it('preserves provider strings and ignores field order only for evidence digest', () => {
    expect(vnpayQuery(url(q))).toEqual(q);
    expect(notificationDigest(q)).toBe(
      notificationDigest(Object.fromEntries(Object.entries(q).reverse())),
    );
    expect(notificationDigest({ ...q, vnp_Amount: '1000100' })).not.toBe(
      notificationDigest(q),
    );
  });
  it.each([
    '&vnp_Amount=1000000',
    '&amount=10000',
    '&vnp_Amount[]=1000000',
    '&vnp_OrderInfo=%ZZ',
    '&vnp_BankCode=%00NCB',
  ])('rejects ambiguous query suffix %s', (s) =>
    expect(() => vnpayQuery(url(q) + s)).toThrow(),
  );
  it.each([
    { ...q, vnp_Amount: '1e6' },
    { ...q, vnp_Amount: '01000000' },
    { ...q, vnp_SecureHash: 'short' },
    { ...q, vnp_TxnRef: 'other' },
    { ...q, vnp_ResponseCode: '0' },
  ])('rejects malformed provider fields', (x) =>
    expect(() => vnpayQuery(url(x))).toThrow(),
  );
  it('requires explicit consent, never accepts caller-defined amount/URL', () => {
    vnpayConsent({ confirmed: true });
    for (const x of [
      { confirmed: false },
      { confirmed: true, amount: 1 },
      { confirmed: true, returnUrl: 'https://evil.invalid' },
      [],
      null,
    ])
      expect(() => vnpayConsent(x)).toThrow();
  });
  it.each(['0', '01', '-1', '1.5', '2147483648', '1e2'])(
    'rejects unsafe order identity %s',
    (s) => expect(() => vnpayOrderId(s)).toThrow(),
  );
});
