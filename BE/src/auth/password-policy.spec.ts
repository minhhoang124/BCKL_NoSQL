import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { bcryptPassword, requireBcryptPassword } from './password-policy.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

describe('bcrypt UTF-8 boundary', () => {
  it.each(['a'.repeat(72), 'á'.repeat(36), '😀'.repeat(18), ' password '])(
    'accepts exact bytes without normalization',
    (p) => expect(bcryptPassword(p, 8)).toBe(true),
  );
  it.each([
    'á'.repeat(40) + 'A1!',
    '😀'.repeat(19),
    'a'.repeat(73),
    '1234567\0',
    '12345678\ud800',
  ])('rejects truncation/NUL/invalid Unicode', (p) => {
    expect(bcryptPassword(p)).toBe(false);
    expect(() => requireBcryptPassword(p)).toThrow();
  });
  it('counts minimum codepoints, not bytes', () =>
    expect(bcryptPassword('á'.repeat(4), 8)).toBe(false));
  it('does not normalize canonically equivalent passwords', () => {
    expect(bcryptPassword('é'.repeat(36), 8)).toBe(true);
    expect(bcryptPassword('e\u0301'.repeat(36), 8)).toBe(false);
  });
  it.each([RegisterDto, LoginDto])(
    'rejects >72 bytes at DTO boundary',
    async (Type) => {
      const dto = Object.assign(new Type(), {
        email: 'qa@example.invalid',
        password: 'á'.repeat(40) + 'A1!',
      });
      expect((await validate(dto)).some((e) => e.property === 'password')).toBe(
        true,
      );
    },
  );
});
