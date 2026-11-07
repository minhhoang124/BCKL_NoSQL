import { describe, expect, it } from 'vitest';
import { phoneOtpRequest, phoneOtpConfirmation } from './phone-otp.input.js';
const id = '8915c6da-233a-4a20-af44-bf78057ea86d',
  request = {
    phoneNumber: '+84900000001',
    expectedVersion: 0,
    confirmed: true,
  };
describe('phone sandbox strict request boundary — not an implemented SMS flow', () => {
  it('accepts canonical phone, explicit consent and version0 for a new contact', () =>
    expect(phoneOtpRequest(request)).toEqual({
      phoneNumber: '+84900000001',
      expectedVersion: 0,
    }));
  it.each([
    '0900000001',
    '+84 900000001',
    ' +84900000001',
    '+84900000001\n',
    '+０８４９０００００００１',
    '+0123456789',
    '+123',
    '+1234567890123456',
  ])('rejects noncanonical phone %s', (phoneNumber) =>
    expect(() => phoneOtpRequest({ ...request, phoneNumber })).toThrow(),
  );
  it.each([-1, 0.5, 2147483648, '0', null])(
    'rejects an invalid revision %s',
    (expectedVersion) =>
      expect(() => phoneOtpRequest({ ...request, expectedVersion })).toThrow(),
  );
  it('rejects missing/false consent, unknown fields and non-object bodies', () => {
    for (const body of [
      { ...request, confirmed: false },
      { ...request, userId: 7 },
      { ...request, role: 'ADMIN' },
      [],
      null,
      Object.assign(Object.create(null), request),
    ])
      expect(() => phoneOtpRequest(body)).toThrow();
  });
  it('preserves leading zeros in a six-digit OTP and canonicalizes its server challenge UUID', () =>
    expect(
      phoneOtpConfirmation({
        challengeId: id.toUpperCase(),
        code: '000001',
        confirmed: true,
      }),
    ).toEqual({ challengeId: id, code: '000001' }));
  it.each(['12345', '1234567', '１２３４５６', 123456, '123456\n', ' 123456'])(
    'rejects invalid OTP representation %s',
    (code) =>
      expect(() =>
        phoneOtpConfirmation({ challengeId: id, code, confirmed: true }),
      ).toThrow(),
  );
  it('rejects arbitrary/cross-protocol challenge IDs and extra fields', () => {
    for (const x of [
      { challengeId: '1', code: '123456', confirmed: true },
      { challengeId: id, code: '123456', confirmed: true, userId: 2 },
      { challengeId: id, code: '123456', confirmed: false },
    ])
      expect(() => phoneOtpConfirmation(x)).toThrow();
  });
});
