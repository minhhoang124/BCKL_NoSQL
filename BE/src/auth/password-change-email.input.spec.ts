import {
  bindingHash,
  passwordChangeConfirm,
  passwordChangeMode,
  passwordChangeRequest,
  passwordChangeVerify,
} from './password-change-email.input.js';

const token = 'A'.repeat(42) + 'A';
const secret = 'b'.repeat(42) + 'Q';

describe('password change mode flag', () => {
  it('defaults to DIRECT and accepts EMAIL', () => {
    expect(passwordChangeMode(undefined)).toBe('DIRECT');
    expect(passwordChangeMode('DIRECT')).toBe('DIRECT');
    expect(passwordChangeMode('EMAIL')).toBe('EMAIL');
  });
  it.each(['', 'email', 'true', 'BOTH'])('fails closed on %j', (raw) => {
    expect(() => passwordChangeMode(raw)).toThrow();
  });
});

describe('password change inputs', () => {
  it('request needs current password and explicit consent, nothing else', () => {
    expect(
      passwordChangeRequest({ currentPassword: 'old pass', confirmed: true }),
    ).toEqual({ currentPassword: 'old pass' });
    for (const bad of [
      { currentPassword: 'x', confirmed: false },
      { currentPassword: '', confirmed: true },
      { currentPassword: 'x'.repeat(73), confirmed: true },
      { currentPassword: 'x', confirmed: true, newPassword: 'y' },
      { currentPassword: 1, confirmed: true },
      null,
      [],
    ])
      expect(() => passwordChangeRequest(bad)).toThrow();
  });
  it('verify needs a 43-char token and binding secret', () => {
    expect(passwordChangeVerify({ token, bindingSecret: secret })).toEqual({
      token,
      bindingSecret: secret,
    });
    for (const bad of [
      { token },
      { token, bindingSecret: 'short' },
      { token: 'bad', bindingSecret: secret },
      { token, bindingSecret: secret, extra: 1 },
      { token, bindingSecret: secret + '=' },
    ])
      expect(() => passwordChangeVerify(bad)).toThrow();
  });
  it('confirm enforces password policy and consent', () => {
    expect(
      passwordChangeConfirm({
        token,
        bindingSecret: secret,
        newPassword: 'new password 1',
        confirmed: true,
      }).newPassword,
    ).toBe('new password 1');
    for (const newPassword of ['short', 'x'.repeat(73), 'abc\0defgh', 12345678])
      expect(() =>
        passwordChangeConfirm({
          token,
          bindingSecret: secret,
          newPassword,
          confirmed: true,
        }),
      ).toThrow();
    expect(() =>
      passwordChangeConfirm({
        token,
        bindingSecret: secret,
        newPassword: 'new password 1',
        confirmed: false,
      }),
    ).toThrow();
  });
  it('binding hash is a stable SHA256 hex digest', () => {
    expect(bindingHash(secret)).toMatch(/^[a-f0-9]{64}$/);
    expect(bindingHash(secret)).toBe(bindingHash(secret));
    expect(bindingHash(secret)).not.toBe(bindingHash(token));
  });
});
