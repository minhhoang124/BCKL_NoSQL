import { randomBytes } from 'node:crypto';
import {
  emailConfirmation,
  emailConsent,
  emailRequest,
  emailToken,
} from './email-recovery.input.js';
describe('Auth email input boundaries', () => {
  it('normalizes email exactly like password login', () =>
    expect(emailRequest({ email: ' QA@Example.invalid ' })).toBe(
      'qa@example.invalid',
    ));
  it.each([
    null,
    [],
    {},
    { email: 'x' },
    { email: 'a@example.invalid', role: 'ADMIN' },
    { email: 'a\n@example.invalid' },
    { email: 'a@example.invalid\u0000' },
    { email: 7 },
  ])('rejects malformed/extra email input %s', (v) =>
    expect(() => emailRequest(v)).toThrow(),
  );
  it.each([
    {},
    { confirmed: false },
    { confirmed: 'true' },
    { confirmed: true, role: 'ADMIN' },
  ])('requires exact explicit consent %s', (v) =>
    expect(() => emailConsent(v)).toThrow(),
  );
  it('accepts exact consent', () =>
    expect(() => emailConsent({ confirmed: true })).not.toThrow());
  it('accepts canonical 256-bit token only', () => {
    const token = randomBytes(32).toString('base64url');
    expect(emailToken(token)).toBe(token);
  });
  it.each([
    '',
    'x'.repeat(42),
    'x'.repeat(44),
    'a'.repeat(42) + 'B',
    '../a',
    123,
    null,
  ])('rejects malformed token %s', (v) =>
    expect(() => emailToken(v)).toThrow(),
  );
  const token = 'A'.repeat(43);
  it('keeps password whitespace and exact bytes', () =>
    expect(
      emailConfirmation(
        { token, newPassword: ' leading and trailing ', confirmed: true },
        true,
      ).newPassword,
    ).toBe(' leading and trailing '));
  it.each(['short', '😀'.repeat(19), 'a'.repeat(73), 'longpass\0word'])(
    'rejects password outside policy %s',
    (newPassword) =>
      expect(() =>
        emailConfirmation({ token, newPassword, confirmed: true }, true),
      ).toThrow(),
  );
  it('rejects token body extra keys or missing consent', () => {
    expect(() =>
      emailConfirmation({
        token,
        confirmed: true,
        email: 'other@example.invalid',
      }),
    ).toThrow();
    expect(() => emailConfirmation({ token })).toThrow();
  });
});
